"use client";

import { getAccessToken, getIdentityToken } from "@privy-io/react-auth";

const MAX_ACTIVITY_RECORDS = 50;
const MAX_COMPLETED_SPLITS = 20;
let cachedAuthHeaders: { headers: Record<string, string>; expiresAt: number } | null = null;
let authHeadersRequest: Promise<Record<string, string>> | null = null;
const paymentDueRequests = new Map<string, Promise<PaymentDueItem[]>>();

export async function getServerAuthHeaders(): Promise<Record<string, string>> {
  if (cachedAuthHeaders && cachedAuthHeaders.expiresAt > Date.now()) {
    return cachedAuthHeaders.headers;
  }
  if (authHeadersRequest) return authHeadersRequest;

  authHeadersRequest = (async () => {
    const [accessToken, identityToken] = await Promise.all([
      getAccessToken(),
      getIdentityToken(),
    ]);
    const headers: Record<string, string> = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    if (identityToken) headers["X-Privy-Identity-Token"] = identityToken;
    cachedAuthHeaders = { headers, expiresAt: Date.now() + 30_000 };
    return headers;
  })();

  try {
    return await authHeadersRequest;
  } finally {
    authHeadersRequest = null;
  }
}

export interface ActivityItem {
  id: string;
  from?: string; // Address performing the action (Sender / Payer)
  to?: string;   // Address receiving the action (Recipient / Organizer)
  fromLabel?: string;
  toLabel?: string;
  address?: string;
  counterparty?: string;
  type: "split_created" | "split_paid" | "send" | "faucet" | "received" | "transfer";
  title?: string;
  amount: string;
  timestamp: number;
  date: string;
  isPositive?: boolean;
  isGroup?: boolean;
  txHash?: string;
  splitId?: string;
  status?: string;
}

export interface ResolvedActivity {
  direction: "sent" | "received" | "split_created" | "split_paid" | "faucet";
  badge: "SENT" | "RECEIVED" | "SPLIT" | "PAID" | "FAUCET";
  title: string;
  performerAddress: string;
  performerLabel: string;
  recipientAddress: string;
  recipientLabel: string;
  actionText: string;
  isPositive: boolean;
  amountDisplay: string;
  date: string;
  txHash?: string;
  splitId?: string;
}

export function resolveActivityForViewer(
  item: ActivityItem,
  viewerAddress: string
): ResolvedActivity {
  const viewer = (viewerAddress || "").toLowerCase();
  const from = (item.from || item.address || "").toLowerCase();
  const to = (item.to || item.counterparty || "").toLowerCase();

  const shorten = (addr: string) =>
    addr && addr.length > 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr || "Unknown";

  // 1. Faucet Drip
  if (item.type === "faucet") {
    return {
      direction: "faucet",
      badge: "FAUCET",
      title: "Agora AUSD Faucet Drip",
      performerAddress: "faucet",
      performerLabel: "Agora Faucet",
      recipientAddress: from || viewer,
      recipientLabel: "You",
      actionText: "Claimed from Faucet",
      isPositive: true,
      amountDisplay: `+$${item.amount}`,
      date: item.date,
      txHash: item.txHash,
    };
  }

  // 2. Split Created
  if (item.type === "split_created") {
    const isCreator = from === viewer;
    return {
      direction: "split_created",
      badge: "SPLIT",
      title: item.title || "Bill Split Created",
      performerAddress: from,
      performerLabel: isCreator ? "You" : shorten(from),
      recipientAddress: to || "Group",
      recipientLabel: "Participants",
      actionText: isCreator ? "Created by You" : `Created by ${shorten(from)}`,
      isPositive: false,
      amountDisplay: `$${item.amount}`,
      date: item.date,
      txHash: item.txHash,
      splitId: item.splitId,
    };
  }

  // 3. Split Paid
  if (item.type === "split_paid") {
    const isPayer = from === viewer;
    const payerLabel = item.fromLabel || shorten(from);
    const organizerLabel = item.toLabel || shorten(to);
    if (isPayer) {
      return {
        direction: "split_paid",
        badge: "PAID",
        title: item.title || "Paid Bill Split Share",
        performerAddress: from,
        performerLabel: "You",
        recipientAddress: to,
        recipientLabel: `Organizer (${organizerLabel})`,
        actionText: `Paid by You → ${organizerLabel}`,
        isPositive: false,
        amountDisplay: `-$${item.amount}`,
        date: item.date,
        txHash: item.txHash,
        splitId: item.splitId,
      };
    } else {
      // Viewer is organizer / recipient
      return {
        direction: "received",
        badge: "RECEIVED",
        title: `Share Received for ${item.title || "Bill"}`,
        performerAddress: from,
        performerLabel: payerLabel,
        recipientAddress: to,
        recipientLabel: "You",
        actionText: `Paid by ${payerLabel} → You`,
        isPositive: true,
        amountDisplay: `+$${item.amount}`,
        date: item.date,
        txHash: item.txHash,
        splitId: item.splitId,
      };
    }
  }

  // 4. Transfers (Send / Receive)
  const isSender = from === viewer;
  const titleLabel = item.title?.match(/^(?:Sent to|Received from)\s+(.+)$/)?.[1];
  const counterpartyLabel = titleLabel || shorten(isSender ? to : from);
  if (isSender) {
    return {
      direction: "sent",
      badge: "SENT",
      // Rebuild the direction-specific title instead of trusting an older
      // cached/server label that may have belonged to the recipient row.
      title: `Sent to ${counterpartyLabel}`,
      performerAddress: from,
      performerLabel: "You",
      recipientAddress: to,
      recipientLabel: counterpartyLabel,
      actionText: `Sent by You → ${counterpartyLabel}`,
      isPositive: false,
      amountDisplay: `-$${item.amount}`,
      date: item.date,
      txHash: item.txHash,
    };
  } else {
    return {
      direction: "received",
      badge: "RECEIVED",
      title: `Received from ${counterpartyLabel}`,
      performerAddress: from,
      performerLabel: counterpartyLabel,
      recipientAddress: to || viewer,
      recipientLabel: "You",
      actionText: `Received from ${counterpartyLabel} → You`,
      isPositive: true,
      amountDisplay: `+$${item.amount}`,
      date: item.date,
      txHash: item.txHash,
    };
  }
}

export interface SplitItem {
  splitId: string;
  contractAddress?: string;
  title: string;
  totalAmount: string;
  amountPerPerson: string;
  numPayers: number;
  creator: string;
  txHash: string;
  createdAt: number;
  status: "Active" | "Settled" | "Cancelled";
  settledCount?: number;
  payers?: Array<{
    address: string;
    paidAt: number;
    txHash: string;
    amount: string;
    username?: string;
  }>;
  participants?: Array<{
    address: string;
    name?: string;
  }>;
}

export interface PaymentDueItem {
  splitId: string;
  title: string;
  amountPerPerson: string;
  numPayers: number;
  settledCount: number;
  creator: string;
  organizerUsername?: string;
  createdAt: number;
}

function limitStoredSplits(splits: SplitItem[]): SplitItem[] {
  const sorted = [...splits].sort((a, b) => b.createdAt - a.createdAt);
  const active = sorted.filter((split) => split.status === "Active");
  const completed = sorted
    .filter((split) => split.status === "Settled" || split.status === "Cancelled")
    .slice(0, MAX_COMPLETED_SPLITS);
  return [...active, ...completed].sort((a, b) => b.createdAt - a.createdAt);
}

export function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return "Just now";
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - timestamp) / 1000));

  if (diffSec < 30) return "Just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  const d = new Date(timestamp);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function getLocalActivities(address: string): ActivityItem[] {
  if (typeof window === "undefined" || !address) return [];
  try {
    const raw = localStorage.getItem(`janus_activity_${address.toLowerCase()}`);
    if (!raw) return [];
    const parsed: ActivityItem[] = JSON.parse(raw);
    const limited = parsed
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, MAX_ACTIVITY_RECORDS);
    if (limited.length !== parsed.length) {
      localStorage.setItem(`janus_activity_${address.toLowerCase()}`, JSON.stringify(limited));
    }
    return limited.map((item) => ({
      ...item,
      date: formatRelativeTime(item.timestamp),
    }));
  } catch {
    return [];
  }
}

export function saveLocalActivity(address: string, item: ActivityItem) {
  if (typeof window === "undefined" || !address) return;
  const normalized: ActivityItem = {
    ...item,
    from: item.from || address,
    to: item.to || item.counterparty,
  };
  try {
    const existing = getLocalActivities(address);
    const updated = [
      normalized,
      ...existing.filter((x) => x.id !== normalized.id && x.txHash !== normalized.txHash),
    ].slice(0, MAX_ACTIVITY_RECORDS);
    localStorage.setItem(
      `janus_activity_${address.toLowerCase()}`,
      JSON.stringify(updated)
    );
  } catch (e) {
    console.warn("Failed to save local activity:", e);
  }

  // Server activity is indexed from verified on-chain events.
}

export async function indexConfirmedTransfer(txHash: string): Promise<boolean> {
  try {
    const res = await fetch("/api/transfers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await getServerAuthHeaders()),
      },
      body: JSON.stringify({ txHash }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchUserActivities(
  address: string
): Promise<ActivityItem[]> {
  if (!address) return [];
  const local = getLocalActivities(address);

  try {
    const res = await fetch(`/api/activity?address=${encodeURIComponent(address)}`, {
      headers: await getServerAuthHeaders(),
    });
    if (!res.ok) return local;
    const data = await res.json();
    if (!data.success || !Array.isArray(data.activities)) return local;

    const serverItems: ActivityItem[] = data.activities.map((a: ActivityItem) => ({
      ...a,
      date: formatRelativeTime(a.timestamp),
    }));

    // Merge & deduplicate by ID or txHash
    const mergedMap = new Map<string, ActivityItem>();
    for (const item of [...serverItems, ...local]) {
      const key = item.txHash || item.id;
      if (!mergedMap.has(key)) {
        mergedMap.set(key, item);
      }
    }

    const merged = Array.from(mergedMap.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, MAX_ACTIVITY_RECORDS);

    // Resolve current usernames for historical rows that were originally
    // stored with shortened wallet labels.
    const counterparties = Array.from(
      new Set(
        merged
          .flatMap((item) => {
            if (item.type === "send") return [item.to || item.counterparty || ""];
            if (item.type === "received") return [item.from || ""];
            if (item.type === "split_paid") return [item.from || item.address || "", item.to || item.counterparty || ""];
            return [];
          })
          .map((address) => address.toLowerCase())
          .filter(Boolean)
      )
    );
    const labels = new Map<string, string>();
    await Promise.all(
      counterparties.map(async (walletAddress) => {
        try {
          const response = await fetch(`/api/profiles?address=${encodeURIComponent(walletAddress)}`);
          if (!response.ok) return;
          const profile = (await response.json()).profile;
          if (profile?.username) labels.set(walletAddress, `@${profile.username}`);
        } catch {
          // Keep the shortened address when profile lookup is unavailable.
        }
      })
    );
    for (const item of merged) {
      item.fromLabel = labels.get((item.from || item.address || "").toLowerCase());
      item.toLabel = labels.get((item.to || item.counterparty || "").toLowerCase());
      if (item.type === "send") {
        const label = labels.get((item.to || item.counterparty || "").toLowerCase());
        if (label) item.title = `Sent to ${label}`;
      } else if (item.type === "received") {
        const label = labels.get((item.from || "").toLowerCase());
        if (label) item.title = `Received from ${label}`;
      }
    }

    if (typeof window !== "undefined") {
      localStorage.setItem(
        `janus_activity_${address.toLowerCase()}`,
        JSON.stringify(merged)
      );
    }

    return merged;
  } catch {
    return local;
  }
}

export function getLocalSplits(address: string): SplitItem[] {
  if (typeof window === "undefined" || !address) return [];
  try {
    const raw = localStorage.getItem(`janus_splits_${address.toLowerCase()}`);
    const stored: SplitItem[] = raw ? JSON.parse(raw) : [];
    const limited = limitStoredSplits(
      stored.filter((split) => split.creator?.toLowerCase() === address.toLowerCase())
    );
    if (limited.length !== stored.length) {
      localStorage.setItem(`janus_splits_${address.toLowerCase()}`, JSON.stringify(limited));
    }
    return limited;
  } catch {
    return [];
  }
}

export function saveLocalSplit(address: string, split: SplitItem) {
  if (typeof window === "undefined" || !address || split.creator.toLowerCase() !== address.toLowerCase()) return;
  try {
    const existing = getLocalSplits(address);
    const updated = limitStoredSplits([
      split,
      ...existing.filter((s) => s.splitId.toLowerCase() !== split.splitId.toLowerCase()),
    ]);
    localStorage.setItem(
      `janus_splits_${address.toLowerCase()}`,
      JSON.stringify(updated)
    );
  } catch (e) {
    console.warn("Failed to save local split:", e);
  }

  // Server indexing is performed by the split-creation flow after it has
  // verified the creation receipt. Do not send client-authored split data.
}

export async function fetchUserSplits(address: string): Promise<SplitItem[]> {
  if (!address) return [];
  const local = getLocalSplits(address);

  try {
    const res = await fetch(`/api/splits?address=${encodeURIComponent(address)}`, {
      headers: await getServerAuthHeaders(),
    });
    if (!res.ok) return local;
    const data = await res.json();
    if (!data.success || !Array.isArray(data.splits)) return local;

    // Retain older creator-owned splits that exist only in this browser while
    // letting the server replace a local record once it has indexed it.
    // The creator filter keeps participant cards out of the dashboard.
    const map = new Map<string, SplitItem>();
    for (const split of local) {
      map.set(split.splitId.toLowerCase(), split);
    }
    for (const split of data.splits as SplitItem[]) {
      map.set(split.splitId.toLowerCase(), split);
    }
    const merged = limitStoredSplits(
      Array.from(map.values()).filter(
        (split) => split.creator?.toLowerCase() === address.toLowerCase()
      )
    );

    if (typeof window !== "undefined") {
      localStorage.setItem(
        `janus_splits_${address.toLowerCase()}`,
        JSON.stringify(merged)
      );
    }
    return merged;
  } catch {
    return local;
  }
}

export async function fetchPaymentsDue(address: string): Promise<PaymentDueItem[]> {
  if (!address) return [];
  const key = address.toLowerCase();
  const existingRequest = paymentDueRequests.get(key);
  if (existingRequest) return existingRequest;

  const request = (async () => {
    const res = await fetch(`/api/splits/due?address=${encodeURIComponent(address)}`, {
      headers: await getServerAuthHeaders(),
    });
    if (!res.ok) throw new Error("Could not refresh payment inbox");
    const data = await res.json();
    if (!data.success || !Array.isArray(data.paymentsDue)) {
      throw new Error("Could not refresh payment inbox");
    }
    return data.paymentsDue;
  })();
  paymentDueRequests.set(key, request);
  try {
    return await request;
  } finally {
    paymentDueRequests.delete(key);
  }
}
