import { NextResponse } from "next/server";
import { decodeEventLog, formatUnits, type Address, type Hex } from "viem";
import { getSplit, settleSplitPayment, saveActivity } from "@/lib/serverStore";
import {
  JANUS_SPLIT_ABI,
  JANUS_SPLIT_ADDRESS,
  JANUS_SPLIT_V2_ADDRESS,
} from "@/lib/web3";
import { serverPublicClient } from "@/lib/serverRpc";
import { rateLimitHeaders, rateLimitRequest } from "@/lib/rateLimit";

const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const MAX_BODY_BYTES = 8_192;

interface PaymentSettledArgs {
  splitId: Hex;
  payer: Address;
  recipient: Address;
  amount: bigint;
  memo: string;
}

export async function POST(req: Request) {
  try {
    const limit = await rateLimitRequest(req, "payment-index", 10);
    if (!limit.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many payment indexing requests" },
        { status: 429, headers: rateLimitHeaders(limit) }
      );
    }
    const contentLength = Number(req.headers.get("content-length") || "0");
    if (contentLength > MAX_BODY_BYTES) {
      return NextResponse.json(
        { success: false, error: "Request body is too large" },
        { status: 413 }
      );
    }

    const { splitId, txHash } = (await req.json()) as {
      splitId?: string;
      txHash?: string;
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
        { success: false, error: "The settlement transaction was not successful" },
        { status: 422 }
      );
    }

    const storedSplit = await getSplit(splitId);
    const contractAddress = storedSplit?.contractAddress || JANUS_SPLIT_ADDRESS;
    const allowedAddresses = [JANUS_SPLIT_ADDRESS, JANUS_SPLIT_V2_ADDRESS]
      .filter(Boolean)
      .map((address) => address.toLowerCase());
    if (!allowedAddresses.includes(contractAddress.toLowerCase())) {
      return NextResponse.json(
        { success: false, error: "The split uses an unsupported contract" },
        { status: 422 }
      );
    }

    let payment: PaymentSettledArgs | null = null;
    let paymentLogIndex: number | null = null;

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== contractAddress.toLowerCase()) continue;

      try {
        const decoded = decodeEventLog({
          abi: JANUS_SPLIT_ABI,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName !== "PaymentSettled") continue;

        const args = decoded.args as unknown as PaymentSettledArgs;
        if (args.splitId.toLowerCase() !== splitId.toLowerCase()) continue;

        payment = args;
        paymentLogIndex = Number(log.logIndex);
        break;
      } catch {
        // This contract log belongs to a different event in the ABI.
      }
    }

    if (!payment || paymentLogIndex === null) {
      return NextResponse.json(
        { success: false, error: "No matching settlement event was found" },
        { status: 422 }
      );
    }

    const amount = formatUnits(payment.amount, 6);
    const eventId = `10143:${txHash.toLowerCase()}:${paymentLogIndex}`;
    const updatedSplit = await settleSplitPayment(
      payment.splitId,
      payment.payer,
      txHash,
      amount
    );

    await saveActivity({
      id: eventId,
      from: payment.payer,
      to: payment.recipient,
      address: payment.payer,
      type: "split_paid",
      title: `Paid split: ${payment.memo || updatedSplit?.title || "Bill Split"}`,
      amount,
      timestamp: Date.now(),
      isPositive: false,
      txHash,
      splitId: payment.splitId,
      counterparty: payment.recipient,
      status: "Settled",
    });

    await saveActivity({
      id: `received:${eventId}`,
      from: payment.payer,
      to: payment.recipient,
      address: payment.recipient,
      type: "received",
      title: `Payment received for ${payment.memo || updatedSplit?.title || "Bill Split"}`,
      amount,
      timestamp: Date.now(),
      isPositive: true,
      txHash,
      splitId: payment.splitId,
      counterparty: payment.payer,
      status: "Settled",
    });

    return NextResponse.json({ success: true, verified: true, split: updatedSplit });
  } catch (error) {
    console.error("POST /api/splits/pay verification failed:", error);
    if (error instanceof Error && error.message.includes("database migration 006")) {
      return NextResponse.json({ success: false, error: "Payment confirmed on Monad, but split history needs a database update. Please retry indexing after migration 006." }, { status: 503 });
    }
    return NextResponse.json(
      { success: false, error: "Failed to verify the settlement transaction" },
      { status: 500 }
    );
  }
}
