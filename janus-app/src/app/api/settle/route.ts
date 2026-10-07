import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      success: false,
      error: "Server-signed settlement is disabled. Sign the transaction with your connected wallet.",
    },
    { status: 410 }
  );
}
