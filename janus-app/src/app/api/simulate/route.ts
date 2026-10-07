import { NextResponse } from "next/server";
import { rateLimitHeaders, rateLimitRequest } from "@/lib/rateLimit";
import { isAddress, isHex } from "viem";

export async function POST(req: Request) {
  try {
    const limit = await rateLimitRequest(req, "simulation", 20);
    if (!limit.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many simulation requests" },
        { status: 429, headers: rateLimitHeaders(limit) }
      );
    }
    const { from, to, data, value } = await req.json();

    if (!to || !isAddress(to) || (from && !isAddress(from)) || (data && !isHex(data))) {
      return NextResponse.json(
        { success: false, simulated: false, error: "Invalid simulation parameters" },
        { status: 400 }
      );
    }

    const accessKey = process.env.TENDERLY_ACCESS_KEY;
    const accountSlug = process.env.TENDERLY_ACCOUNT_SLUG;
    const projectSlug = process.env.TENDERLY_PROJECT_SLUG || "janus-monad";

    // Graceful fallback when Tenderly keys are not yet configured (Section 8.4)
    if (!accessKey || !accountSlug) {
      return NextResponse.json(
        {
          success: false,
          simulated: false,
          provider: "unavailable",
          error: "Transaction simulation is not configured",
        },
        { status: 503 }
      );
    }

    const response = await fetch(
      `https://api.tenderly.co/api/v1/account/${accountSlug}/project/${projectSlug}/simulate`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Access-Key": accessKey,
        },
        body: JSON.stringify({
          network_id: "10143",
          from: from || "0x0000000000000000000000000000000000000000",
          to,
          input: data || "0x",
          value: value || "0",
          save: true,
        }),
      }
    );

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          simulated: false,
          provider: "tenderly",
          error: "The simulation provider rejected the request",
        },
        { status: 502 }
      );
    }

    const simulation = await response.json();
    const isSuccess = simulation.transaction?.status ?? true;

    return NextResponse.json({
      success: isSuccess,
      gasUsed: simulation.transaction?.gas_used || 0,
      provider: "tenderly-pro",
      error: isSuccess
        ? null
        : simulation.transaction?.error_message || "Transaction simulated revert",
    });
  } catch (error) {
    console.error("Transaction simulation failed:", error);
    return NextResponse.json(
      {
        success: false,
        simulated: false,
        provider: "unavailable",
        error: "Transaction simulation failed",
      },
      { status: 502 }
    );
  }
}
