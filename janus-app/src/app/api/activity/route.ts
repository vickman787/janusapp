import { NextResponse } from "next/server";
import { getUserActivity } from "@/lib/serverStore";
import { authenticatePrivyRequest, walletBelongsToUser } from "@/lib/serverAuth";
import { rateLimitHeaders, rateLimitRequest, rateLimitSubject } from "@/lib/rateLimit";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export async function GET(req: Request) {
  try {
    const ipLimit = await rateLimitRequest(req, "activity-read", 60);
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many activity requests" },
        { status: 429, headers: rateLimitHeaders(ipLimit) }
      );
    }
    const { searchParams } = new URL(req.url);
    const address = searchParams.get("address");

    if (!address || !ADDRESS_PATTERN.test(address)) {
      return NextResponse.json(
        { success: false, error: "A valid address query parameter is required" },
        { status: 400 }
      );
    }

    const user = await authenticatePrivyRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }
    if (!walletBelongsToUser(user, address)) {
      return NextResponse.json({ success: false, error: "Wallet access denied" }, { status: 403 });
    }
    const userLimit = await rateLimitSubject("activity-read", user.userId, 60);
    if (!userLimit.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many activity requests" },
        { status: 429, headers: rateLimitHeaders(userLimit) }
      );
    }

    const activities = await getUserActivity(address);

    return NextResponse.json({
      success: true,
      activities,
    });
  } catch (error) {
    console.error("GET /api/activity error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch activities" },
      { status: 500 }
    );
  }
}

export async function POST() {
  return NextResponse.json(
    {
      success: false,
      error: "Client-authored activity is disabled; activity is derived from verified chain events.",
    },
    { status: 410 }
  );
}
