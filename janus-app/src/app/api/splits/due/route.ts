import { NextResponse } from "next/server";
import { getPaymentsDue } from "@/lib/serverStore";
import { authenticatePrivyRequest, walletBelongsToUser } from "@/lib/serverAuth";
import { rateLimitHeaders, rateLimitRequest, rateLimitSubject } from "@/lib/rateLimit";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export async function GET(req: Request) {
  try {
    const ipLimit = await rateLimitRequest(req, "payments-due-read", 120);
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many payment inbox requests" },
        { status: 429, headers: rateLimitHeaders(ipLimit) }
      );
    }

    const address = new URL(req.url).searchParams.get("address");
    if (!address || !ADDRESS_PATTERN.test(address)) {
      return NextResponse.json({ success: false, error: "Invalid wallet address" }, { status: 400 });
    }

    const user = await authenticatePrivyRequest(req);
    if (!user) return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    if (!walletBelongsToUser(user, address)) {
      return NextResponse.json({ success: false, error: "Wallet access denied" }, { status: 403 });
    }

    const userLimit = await rateLimitSubject("payments-due-read", user.userId, 120);
    if (!userLimit.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many payment inbox requests" },
        { status: 429, headers: rateLimitHeaders(userLimit) }
      );
    }

    return NextResponse.json({ success: true, paymentsDue: await getPaymentsDue(address) });
  } catch (error) {
    console.error("GET /api/splits/due failed:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch payments due" }, { status: 500 });
  }
}
