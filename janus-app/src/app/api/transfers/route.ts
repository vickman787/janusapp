import { NextResponse } from "next/server";
import { decodeEventLog, formatUnits, parseAbi, type Address, type Hex } from "viem";
import { authenticatePrivyRequest } from "@/lib/serverAuth";
import { findProfileByWalletAddress, saveActivity } from "@/lib/serverStore";
import { AUSD_ADDRESS } from "@/lib/web3";
import { serverPublicClient } from "@/lib/serverRpc";
import { rateLimitHeaders, rateLimitRequest } from "@/lib/rateLimit";

const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const TRANSFER_ABI = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);

export async function POST(req: Request) {
  try {
    const limit = await rateLimitRequest(req, "transfer-index", 20);
    if (!limit.allowed) {
      return NextResponse.json({ success: false, error: "Too many transfer indexing requests" }, { status: 429, headers: rateLimitHeaders(limit) });
    }
    const user = await authenticatePrivyRequest(req);
    if (!user) return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });

    const { txHash } = (await req.json()) as { txHash?: string };
    if (!txHash || !HASH_PATTERN.test(txHash)) {
      return NextResponse.json({ success: false, error: "A valid transaction hash is required" }, { status: 400 });
    }
    const receipt = await serverPublicClient.getTransactionReceipt({ hash: txHash as Hex });
    if (receipt.status !== "success") {
      return NextResponse.json({ success: false, error: "The transfer transaction was not successful" }, { status: 422 });
    }

    let transfer: { from: Address; to: Address; value: bigint } | null = null;
    let logIndex: number | null = null;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== AUSD_ADDRESS.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({ abi: TRANSFER_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName === "Transfer") {
          transfer = decoded.args as { from: Address; to: Address; value: bigint };
          logIndex = Number(log.logIndex);
          break;
        }
      } catch {
        // Ignore unrelated token logs.
      }
    }
    if (!transfer || logIndex === null) {
      return NextResponse.json({ success: false, error: "No AUSD transfer event was found" }, { status: 422 });
    }
    const amount = formatUnits(transfer.value, 6);
    const eventId = `10143:${txHash.toLowerCase()}:${logIndex}`;
    const [senderProfile, recipientProfile] = await Promise.all([
      findProfileByWalletAddress(transfer.from),
      findProfileByWalletAddress(transfer.to),
    ]);
    const senderLabel = senderProfile ? `@${senderProfile.username}` : `${transfer.from.slice(0, 6)}…${transfer.from.slice(-4)}`;
    const recipientLabel = recipientProfile ? `@${recipientProfile.username}` : `${transfer.to.slice(0, 6)}…${transfer.to.slice(-4)}`;
    await saveActivity({
      id: eventId, from: transfer.from, to: transfer.to, address: transfer.from,
      type: "send", title: `Sent to ${recipientLabel}`,
      amount, timestamp: Date.now(), isPositive: false, txHash,
      counterparty: transfer.to, status: "Confirmed",
    });
    await saveActivity({
      id: `received:${eventId}`, from: transfer.from, to: transfer.to, address: transfer.to,
      type: "received", title: `Received from ${senderLabel}`,
      amount, timestamp: Date.now(), isPositive: true, txHash,
      counterparty: transfer.from, status: "Confirmed",
    });
    return NextResponse.json({ success: true, indexed: true });
  } catch (error) {
    console.error("POST /api/transfers failed:", error);
    return NextResponse.json({ success: false, error: "Failed to verify the transfer transaction" }, { status: 500 });
  }
}
