import { NextResponse } from "next/server";
import { decodeEventLog, type Address, type Hex } from "viem";
import { cancelStoredSplit, getSplit } from "@/lib/serverStore";
import { authenticatePrivyRequest, walletBelongsToUser } from "@/lib/serverAuth";
import { JANUS_SPLIT_ABI, JANUS_SPLIT_ADDRESS, JANUS_SPLIT_V2_ADDRESS } from "@/lib/web3";
import { serverPublicClient } from "@/lib/serverRpc";
import { rateLimitHeaders, rateLimitRequest, rateLimitSubject } from "@/lib/rateLimit";

const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const MAX_BODY_BYTES = 8_192;

interface SplitCancelledArgs {
  splitId: Hex;
  requester: Address;
}

export async function POST(req: Request) {
  try {
    const ipLimit = await rateLimitRequest(req, "split-cancel-index", 10);
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many cancellation requests" },
        { status: 429, headers: rateLimitHeaders(ipLimit) }
      );
    }

    if (Number(req.headers.get("content-length") || "0") > MAX_BODY_BYTES) {
      return NextResponse.json({ success: false, error: "Request body is too large" }, { status: 413 });
    }

    const { splitId, txHash, address } = (await req.json()) as {
      splitId?: string;
      txHash?: string;
      address?: string;
    };
    if (!splitId || !HASH_PATTERN.test(splitId) || !txHash || !HASH_PATTERN.test(txHash) || !address) {
      return NextResponse.json({ success: false, error: "Invalid cancellation details" }, { status: 400 });
    }

    const user = await authenticatePrivyRequest(req);
    if (!user) return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    if (!walletBelongsToUser(user, address)) {
      return NextResponse.json({ success: false, error: "Wallet access denied" }, { status: 403 });
    }
    const userLimit = await rateLimitSubject("split-cancel-index", user.userId, 10);
    if (!userLimit.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many cancellation requests" },
        { status: 429, headers: rateLimitHeaders(userLimit) }
      );
    }

    const storedSplit = await getSplit(splitId);
    if (!storedSplit || storedSplit.creator.toLowerCase() !== address.toLowerCase()) {
      return NextResponse.json({ success: false, error: "Only the split organizer can cancel it" }, { status: 403 });
    }
    const contractAddress = storedSplit.contractAddress || JANUS_SPLIT_ADDRESS;
    const allowedAddresses = [JANUS_SPLIT_ADDRESS, JANUS_SPLIT_V2_ADDRESS]
      .filter(Boolean)
      .map((value) => value.toLowerCase());
    if (!allowedAddresses.includes(contractAddress.toLowerCase())) {
      return NextResponse.json({ success: false, error: "The split uses an unsupported contract" }, { status: 422 });
    }

    const receipt = await serverPublicClient.getTransactionReceipt({ hash: txHash as Hex });
    if (receipt.status !== "success") {
      return NextResponse.json({ success: false, error: "The cancellation transaction was not successful" }, { status: 422 });
    }

    let verified = false;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== contractAddress.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({ abi: JANUS_SPLIT_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName !== "SplitCancelled") continue;
        const args = decoded.args as unknown as SplitCancelledArgs;
        if (
          args.splitId.toLowerCase() === splitId.toLowerCase() &&
          args.requester.toLowerCase() === address.toLowerCase()
        ) {
          verified = true;
          break;
        }
      } catch {
        // Ignore other contract logs in the receipt.
      }
    }
    if (!verified) {
      return NextResponse.json({ success: false, error: "No matching split cancellation event was found" }, { status: 422 });
    }

    const split = await cancelStoredSplit(splitId);
    return NextResponse.json({ success: true, verified: true, split });
  } catch (error) {
    console.error("POST /api/splits/cancel failed:", error);
    return NextResponse.json({ success: false, error: "Failed to verify split cancellation" }, { status: 500 });
  }
}
