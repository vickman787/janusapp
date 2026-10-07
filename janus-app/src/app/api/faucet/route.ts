import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      success: false,
      error: "The custodial faucet is disabled. Use an authenticated, rate-limited faucet service.",
    },
    { status: 410 }
  );
}
