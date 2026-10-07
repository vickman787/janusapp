import { NextResponse } from "next/server";
import { decodeEventLog, formatUnits, type Address, type Hex } from "viem";
import {
  saveSplit,
  getSplit,
  getUserSplits,
  getUserGroup,
  saveActivity,
} from "@/lib/serverStore";
import {
  JANUS_SPLIT_ABI,
  JANUS_SPLIT_ADDRESS,
  JANUS_SPLIT_V2_ADDRESS,
} from "@/lib/web3";
import { serverPublicClient } from "@/lib/serverRpc";
import { authenticatePrivyRequest, walletBelongsToUser } from "@/lib/serverAuth";
import { rateLimitHeaders, rateLimitRequest, rateLimitSubject } from "@/lib/rateLimit";

const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 8_192;

interface SplitCreatedArgs {
  splitId: Hex;
  requester: Address;
  totalAmount: bigint;
  numPayers: bigint;
  memo: string;
}

export async function GET(req: Request) {
  try {
    const ipLimit = await rateLimitRequest(req, "splits-read", 120);
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many split requests" },
        { status: 429, headers: rateLimitHeaders(ipLimit) }
      );
    }
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const address = searchParams.get("address");

    if (id) {
      if (!HASH_PATTERN.test(id)) {
        return NextResponse.json({ success: false, error: "Invalid split ID" }, { status: 400 });
      }
      return NextResponse.json({ success: true, split: await getSplit(id) });
    }

    if (address) {
      if (!ADDRESS_PATTERN.test(address)) {
        return NextResponse.json({ success: false, error: "Invalid wallet address" }, { status: 400 });
      }
      const user = await authenticatePrivyRequest(req);
      if (!user) {
        return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
      }
      if (!walletBelongsToUser(user, address)) {
        return NextResponse.json({ success: false, error: "Wallet access denied" }, { status: 403 });
      }
      const userLimit = await rateLimitSubject("splits-read", user.userId, 120);
      if (!userLimit.allowed) {
        return NextResponse.json(
          { success: false, error: "Too many split requests" },
          { status: 429, headers: rateLimitHeaders(userLimit) }
        );
      }
      return NextResponse.json({ success: true, splits: await getUserSplits(address) });
    }

    return NextResponse.json(
      { success: false, error: "Provide either id or address" },
      { status: 400 }
    );
  } catch (error) {
    console.error("GET /api/splits failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch splits" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const limit = await rateLimitRequest(req, "splits-write", 10);
    if (!limit.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many split indexing requests" },
        { status: 429, headers: rateLimitHeaders(limit) }
      );
    }
    const contentLength = Number(req.headers.get("content-length") || "0");
    if (contentLength > MAX_BODY_BYTES) {
      return NextResponse.json({ success: false, error: "Request body is too large" }, { status: 413 });
    }

    const { splitId, txHash, participants, groupId } = (await req.json()) as {
      splitId?: string;
      txHash?: string;
      participants?: Array<{ address?: string; name?: string }>;
      groupId?: string;
    };
    if (!splitId || !HASH_PATTERN.test(splitId) || !txHash || !HASH_PATTERN.test(txHash)) {
      return NextResponse.json(
        { success: false, error: "A valid splitId and transaction hash are required" },
        { status: 400 }
      );
    }

    const receipt = await serverPublicClient.getTransactionReceipt({ hash: txHash as Hex });
    if (receipt.status !== "success") {
      return NextResponse.json(
        { success: false, error: "The split creation transaction was not successful" },
        { status: 422 }
      );
    }

    let created: SplitCreatedArgs | null = null;
    let createdContractAddress: Address | null = null;
    for (const log of receipt.logs) {
      const logAddress = log.address.toLowerCase();
      const allowedAddresses = [JANUS_SPLIT_ADDRESS, JANUS_SPLIT_V2_ADDRESS]
        .filter(Boolean)
        .map((address) => address.toLowerCase());
      if (!allowedAddresses.includes(logAddress)) continue;
      try {
        const decoded = decodeEventLog({
          abi: JANUS_SPLIT_ABI,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName !== "SplitCreated") continue;
        const args = decoded.args as unknown as SplitCreatedArgs;
        if (args.splitId.toLowerCase() !== splitId.toLowerCase()) continue;
        created = args;
        createdContractAddress = log.address;
        break;
      } catch {
        // This contract log belongs to a different event in the ABI.
      }
    }

    if (!created) {
      return NextResponse.json(
        { success: false, error: "No matching split creation event was found" },
        { status: 422 }
      );
    }

    const totalAmount = formatUnits(created.totalAmount, 6);
    const amountPerPerson = formatUnits(created.totalAmount / created.numPayers, 6);
    const group = groupId && UUID_PATTERN.test(groupId)
      ? await getUserGroup(groupId, created.requester)
      : null;
    const saved = await saveSplit({
      splitId: created.splitId,
      title: created.memo || "Bill Split",
      totalAmount,
      amountPerPerson,
      numPayers: Number(created.numPayers),
      creator: created.requester,
      contractAddress: createdContractAddress || JANUS_SPLIT_ADDRESS,
      txHash,
      createdAt: Date.now(),
      status: "Active",
      settledCount: 0,
      groupId: group?.id,
      payers: [],
      participants: Array.from(
        new Map(
          (participants || [])
            .filter(
              (participant) =>
                participant.address &&
                ADDRESS_PATTERN.test(participant.address) &&
                participant.address.toLowerCase() !== created.requester.toLowerCase()
            )
            .map((participant) => [
              participant.address!.toLowerCase(),
              { address: participant.address!, name: participant.name },
            ])
        ).values()
      ),
    });

    await saveActivity({
      id: `10143:${txHash.toLowerCase()}:created`,
      address: created.requester,
      type: "split_created",
      title: `${created.memo || "Bill Split"} (Created)`,
      amount: amountPerPerson,
      timestamp: Date.now(),
      isPositive: false,
      txHash,
      splitId: created.splitId,
      status: "Active",
    });

    return NextResponse.json({ success: true, verified: true, split: saved });
  } catch (error) {
    console.error("POST /api/splits verification failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to verify the split creation transaction" },
      { status: 500 }
    );
  }
}
