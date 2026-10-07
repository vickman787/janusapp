import { NextResponse } from "next/server";
import { createUserGroup, getUserGroup, getUserGroups } from "@/lib/serverStore";
import { authenticatePrivyRequest, walletBelongsToUser } from "@/lib/serverAuth";
import { rateLimitHeaders, rateLimitRequest, rateLimitSubject } from "@/lib/rateLimit";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 16_384;

async function authenticatedAddress(req: Request, address: string | null) {
  const user = await authenticatePrivyRequest(req);
  if (!user || !address || !ADDRESS_PATTERN.test(address) || !walletBelongsToUser(user, address)) return null;
  return { user, address: address.toLowerCase() };
}

export async function GET(req: Request) {
  try {
    const ipLimit = await rateLimitRequest(req, "groups-read", 60);
    if (!ipLimit.allowed) {
      return NextResponse.json({ success: false, error: "Too many group requests" }, { status: 429, headers: rateLimitHeaders(ipLimit) });
    }
    const url = new URL(req.url);
    const auth = await authenticatedAddress(req, url.searchParams.get("address"));
    if (!auth) return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    const userLimit = await rateLimitSubject("groups-read", auth.user.userId, 60);
    if (!userLimit.allowed) {
      return NextResponse.json({ success: false, error: "Too many group requests" }, { status: 429, headers: rateLimitHeaders(userLimit) });
    }

    const groupId = url.searchParams.get("id");
    if (groupId) {
      if (!UUID_PATTERN.test(groupId)) return NextResponse.json({ success: false, error: "Invalid group" }, { status: 400 });
      const group = await getUserGroup(groupId, auth.address);
      if (!group) return NextResponse.json({ success: false, error: "Group not found" }, { status: 404 });
      return NextResponse.json({ success: true, group });
    }
    return NextResponse.json({ success: true, groups: await getUserGroups(auth.address) });
  } catch (error) {
    console.error("GET /api/groups failed:", error);
    return NextResponse.json({ success: false, error: "Failed to load groups" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const ipLimit = await rateLimitRequest(req, "groups-write", 20);
    if (!ipLimit.allowed) {
      return NextResponse.json({ success: false, error: "Too many group requests" }, { status: 429, headers: rateLimitHeaders(ipLimit) });
    }
    if (Number(req.headers.get("content-length") || "0") > MAX_BODY_BYTES) {
      return NextResponse.json({ success: false, error: "Request body is too large" }, { status: 413 });
    }
    const body = (await req.json()) as {
      address?: string;
      name?: string;
      members?: Array<{ address?: string; username?: string }>;
    };
    const auth = await authenticatedAddress(req, body.address || null);
    if (!auth) return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    const userLimit = await rateLimitSubject("groups-write", auth.user.userId, 20);
    if (!userLimit.allowed) {
      return NextResponse.json({ success: false, error: "Too many group requests" }, { status: 429, headers: rateLimitHeaders(userLimit) });
    }

    const name = body.name?.trim().replace(/\s+/g, " ") || "";
    if (name.length < 1 || name.length > 80) {
      return NextResponse.json({ success: false, error: "Group name must be 1 to 80 characters" }, { status: 400 });
    }
    const memberMap = new Map<string, { address: string; username?: string }>();
    for (const member of body.members || []) {
      if (!member.address || !ADDRESS_PATTERN.test(member.address)) continue;
      const normalized = member.address.toLowerCase();
      if (normalized === auth.address) continue;
      memberMap.set(normalized, {
        address: member.address,
        username: member.username?.trim().slice(0, 21) || undefined,
      });
    }
    if (memberMap.size > 50) {
      return NextResponse.json({ success: false, error: "A group can have up to 50 members" }, { status: 400 });
    }

    const group = await createUserGroup(auth.address, name, Array.from(memberMap.values()));
    return NextResponse.json({ success: true, group }, { status: 201 });
  } catch (error) {
    console.error("POST /api/groups failed:", error);
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json({ success: false, error: "You already have a group with that name" }, { status: 409 });
    }
    return NextResponse.json({ success: false, error: "Failed to create group" }, { status: 500 });
  }
}
