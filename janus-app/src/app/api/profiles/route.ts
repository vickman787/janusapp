import { NextResponse } from "next/server";
import { getProfile, saveProfile, findProfileByUsername } from "@/lib/serverStore";
import { authenticatePrivyRequest, walletBelongsToUser } from "@/lib/serverAuth";
import { recoverMessageAddress } from "viem";
import { profileProofMessage } from "@/lib/profileProof";
import { rateLimitHeaders, rateLimitRequest } from "@/lib/rateLimit";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

export async function GET(req: Request) {
  try {
    const limit = await rateLimitRequest(req, "profiles-read", 60);
    if (!limit.allowed) return NextResponse.json({ success: false, error: "Too many profile requests" }, { status: 429, headers: rateLimitHeaders(limit) });
    const { searchParams } = new URL(req.url);
    const address = searchParams.get("address") || "";
    const username = searchParams.get("username")?.trim().toLowerCase();
    if (username) {
      if (!USERNAME_PATTERN.test(username)) return NextResponse.json({ success: false, error: "Invalid username" }, { status: 400 });
      return NextResponse.json({ success: true, profile: await findProfileByUsername(username) });
    }
    if (!ADDRESS_PATTERN.test(address)) {
      return NextResponse.json({ success: false, error: "Invalid wallet address" }, { status: 400 });
    }
    // Wallet addresses and their chosen usernames are directory data. Writes remain
    // protected below by a verified Privy session plus wallet signature.
    return NextResponse.json({ success: true, profile: await getProfile(address) });
  } catch (error) {
    console.error("GET /api/profiles failed:", error);
    return NextResponse.json({ success: false, error: "Failed to load profile" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const limit = await rateLimitRequest(req, "profiles-write", 10);
    if (!limit.allowed) return NextResponse.json({ success: false, error: "Too many profile updates" }, { status: 429, headers: rateLimitHeaders(limit) });
    if (Number(req.headers.get("content-length") || "0") > 4_096) {
      return NextResponse.json({ success: false, error: "Request body is too large" }, { status: 413 });
    }
    const user = await authenticatePrivyRequest(req);
    const { address, username, proofTimestamp, proofSignature } = (await req.json()) as {
      address?: string;
      username?: string;
      proofTimestamp?: number;
      proofSignature?: `0x${string}`;
    };
    const normalizedUsername = username?.trim().toLowerCase() || "";
    let walletVerified = Boolean(user && address && walletBelongsToUser(user, address));
    if (!walletVerified && user && address && ADDRESS_PATTERN.test(address) &&
      USERNAME_PATTERN.test(normalizedUsername) && Number.isSafeInteger(proofTimestamp) &&
      Math.abs(Date.now() - proofTimestamp!) <= 5 * 60_000 && proofSignature) {
      try {
        const message = profileProofMessage(user.userId, address, normalizedUsername, proofTimestamp!);
        const recovered = await recoverMessageAddress({ message, signature: proofSignature });
        walletVerified = recovered.toLowerCase() === address.toLowerCase();
      } catch {
        walletVerified = false;
      }
    }
    if (!user || !address || !ADDRESS_PATTERN.test(address) || !walletVerified) {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }
    if (!USERNAME_PATTERN.test(normalizedUsername)) {
      return NextResponse.json({ success: false, error: "Username must be 3–20 lowercase letters, numbers, or underscores" }, { status: 400 });
    }
    const current = await getProfile(address);
    if (current) {
      if (current.username === normalizedUsername) return NextResponse.json({ success: true, profile: current });
      return NextResponse.json({ success: false, error: `This wallet is already registered as @${current.username}` }, { status: 409 });
    }
    const existing = await findProfileByUsername(normalizedUsername);
    if (existing && existing.walletAddress.toLowerCase() !== address.toLowerCase()) {
      return NextResponse.json({ success: false, error: "Username is already taken" }, { status: 409 });
    }
    return NextResponse.json({ success: true, profile: await saveProfile(address, normalizedUsername) });
  } catch (error) {
    console.error("PUT /api/profiles failed:", error);
    if (error instanceof Error && error.message === "Username or wallet is already registered") {
      return NextResponse.json({ success: false, error: "Username or wallet is already registered" }, { status: 409 });
    }
    return NextResponse.json({ success: false, error: "Failed to save profile" }, { status: 500 });
  }
}
