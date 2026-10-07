import { NextResponse } from "next/server";
import { rateLimitHeaders, rateLimitRequest } from "@/lib/rateLimit";
import { rpcUrl } from "@/lib/serverRpc";
import { AUSD_ADDRESS, JANUS_SPLIT_ADDRESS, JANUS_SPLIT_V2_ADDRESS } from "@/lib/web3";

const allowedMethods = new Set([
  "eth_call", "eth_getBalance", "eth_getTransactionReceipt", "eth_getLogs",
  "eth_blockNumber", "eth_chainId", "eth_getBlockByNumber", "eth_gasPrice",
  "eth_feeHistory", "eth_maxPriorityFeePerGas", "eth_estimateGas",
  "eth_getTransactionCount", "eth_getCode", "eth_getTransactionByHash",
  // This only relays a transaction that has already been signed in Privy. It
  // cannot move funds without the wallet owner's approval in that modal.
  "eth_sendRawTransaction",
]);

// Privy's approval sheet runs in an isolated frame. It must be able to make
// the same RPC calls as the JANUS page in order to estimate gas and submit a
// transaction the user has already signed. The proxy still restricts methods,
// targets, request size, and rate limits below.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "600",
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(req: Request) {
  const limit = await rateLimitRequest(req, "rpc-read", 120);
  if (!limit.allowed) return NextResponse.json({ error: "RPC rate limit reached" }, { status: 429, headers: { ...corsHeaders, ...rateLimitHeaders(limit) } });
  let body: { jsonrpc?: string; id?: string | number; method?: string; params?: unknown[] };
  try {
    const raw = await req.text();
    if (raw.length > 16_384) return NextResponse.json({ error: "RPC request is too large" }, { status: 413, headers: corsHeaders });
    body = JSON.parse(raw);
    if (!body || Array.isArray(body) || body.jsonrpc !== "2.0" ||
      !body.method || !allowedMethods.has(body.method) || !Array.isArray(body.params)) {
      return NextResponse.json({ error: "Unsupported RPC method" }, { status: 400, headers: corsHeaders });
    }
    if (body.method === "eth_sendRawTransaction") {
      const rawTransaction = body.params[0];
      if (body.params.length !== 1 || typeof rawTransaction !== "string" ||
        !/^0x[0-9a-f]+$/i.test(rawTransaction) || rawTransaction.length > 16_384) {
        return NextResponse.json({ error: "Invalid signed transaction" }, { status: 400, headers: corsHeaders });
      }
      const broadcastLimit = await rateLimitRequest(req, "rpc-broadcast", 20);
      if (!broadcastLimit.allowed) {
        return NextResponse.json({ error: "Transaction broadcast rate limit reached" }, { status: 429, headers: { ...corsHeaders, ...rateLimitHeaders(broadcastLimit) } });
      }
    }
    if (body.method === "eth_getLogs") {
      const filter = body.params[0] as { address?: string; fromBlock?: string; toBlock?: string } | undefined;
      const contracts = [JANUS_SPLIT_ADDRESS, JANUS_SPLIT_V2_ADDRESS].filter(Boolean).map((address) => address.toLowerCase());
      if (!filter?.fromBlock || !filter?.toBlock ||
        !filter.address || !contracts.includes(filter.address.toLowerCase()) ||
        !/^0x[0-9a-f]+$/i.test(filter.fromBlock) || !/^0x[0-9a-f]+$/i.test(filter.toBlock) ||
        BigInt(filter.toBlock) < BigInt(filter.fromBlock) ||
        BigInt(filter.toBlock) - BigInt(filter.fromBlock) > 500n) {
        return NextResponse.json({ error: "Log range must be at most 500 blocks" }, { status: 400, headers: corsHeaders });
      }
    }
    if (body.method === "eth_call" || body.method === "eth_estimateGas") {
      const call = body.params[0] as { to?: string } | undefined;
      const contracts = [AUSD_ADDRESS, JANUS_SPLIT_ADDRESS, JANUS_SPLIT_V2_ADDRESS].filter(Boolean).map((address) => address.toLowerCase());
      if (!call?.to || !contracts.includes(call.to.toLowerCase())) {
        return NextResponse.json({ error: "Unsupported RPC target" }, { status: 400, headers: corsHeaders });
      }
    }
  } catch {
    return NextResponse.json({ error: "Invalid RPC request" }, { status: 400, headers: corsHeaders });
  }
  try {
    const upstream = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    const response = await upstream.text();
    return new Response(response, {
      status: upstream.ok ? 200 : 502,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders },
    });
  } catch {
    return NextResponse.json({ error: "RPC is temporarily unavailable" }, { status: 502, headers: corsHeaders });
  }
}
