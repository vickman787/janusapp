import { supabaseAdmin } from "@/lib/supabaseServer";

export interface SplitRecordData {
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
  settledCount: number;
  groupId?: string;
  payers?: Array<{
    address: string;
    paidAt: number;
    txHash: string;
    amount: string;
  }>;
  participants?: Array<{
    address: string;
    name?: string;
  }>;
}

export interface ActivityRecordData {
  id: string;
  from?: string;
  to?: string;
  address: string;
  type: "split_created" | "split_paid" | "send" | "faucet" | "received" | "transfer";
  title: string;
  amount: string;
  timestamp: number;
  isPositive: boolean;
  txHash?: string;
  splitId?: string;
  counterparty?: string;
  status?: string;
}

export interface ProfileRecord {
  walletAddress: string;
  username: string;
  createdAt: number;
}

export interface PaymentDueData {
  splitId: string;
  title: string;
  amountPerPerson: string;
  numPayers: number;
  settledCount: number;
  creator: string;
  organizerUsername?: string;
  createdAt: number;
}

export interface GroupRecord {
  id: string;
  name: string;
  organizerWalletAddress: string;
  createdAt: number;
  members: Array<{ address: string; username?: string }>;
  recentSplits: Array<{ title: string; status: SplitRecordData["status"]; createdAt: number }>;
}

interface SplitRow {
  split_id: string;
  contract_address: string;
  title: string;
  total_amount: string;
  amount_per_person: string;
  num_payers: number;
  creator: string;
  tx_hash: string;
  created_at: number;
  status: SplitRecordData["status"];
  settled_count: number;
  group_id?: string | null;
}

interface PaymentRow {
  payer_address: string;
  paid_at: number;
  tx_hash: string;
  amount: string;
}

interface ParticipantRow {
  wallet_address: string;
  display_name: string | null;
  username_snapshot: string | null;
  status: "pending" | "paid";
}

interface ActivityRow {
  id: string;
  from_address: string | null;
  to_address: string | null;
  address: string;
  type: ActivityRecordData["type"];
  title: string;
  amount: string;
  timestamp: number;
  is_positive: boolean;
  tx_hash: string | null;
  split_id: string | null;
  counterparty: string | null;
  status: string | null;
}

interface GroupRow {
  id: string;
  organizer_wallet_address: string;
  name: string;
  created_at: number;
}

function splitFromRow(row: SplitRow, payments: PaymentRow[], participants: ParticipantRow[] = []): SplitRecordData {
  return {
    splitId: row.split_id,
    contractAddress: row.contract_address,
    title: row.title,
    totalAmount: row.total_amount,
    amountPerPerson: row.amount_per_person,
    numPayers: Number(row.num_payers),
    creator: row.creator,
    txHash: row.tx_hash,
    createdAt: Number(row.created_at),
    status: row.status,
    settledCount: Number(row.settled_count),
    groupId: row.group_id || undefined,
    payers: payments.map((payment) => ({
      address: payment.payer_address,
      paidAt: Number(payment.paid_at),
      txHash: payment.tx_hash,
      amount: payment.amount,
    })),
    participants: participants.map((participant) => ({
      address: participant.wallet_address,
      name: participant.username_snapshot || participant.display_name || undefined,
    })),
  };
}

async function paymentsForSplit(splitId: string): Promise<PaymentRow[]> {
  const { data, error } = await supabaseAdmin
    .from("split_payments")
    .select("payer_address, paid_at, tx_hash, amount")
    .eq("split_id", splitId.toLowerCase())
    .order("paid_at", { ascending: true });
  if (error) throw error;
  return (data || []) as PaymentRow[];
}

async function participantsForSplit(splitId: string): Promise<ParticipantRow[]> {
  const { data, error } = await supabaseAdmin
    .from("split_participants")
    .select("wallet_address, display_name, username_snapshot, status")
    .eq("split_id", splitId.toLowerCase())
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []) as ParticipantRow[];
}

async function hydrateSplit(row: SplitRow): Promise<SplitRecordData> {
  const [payments, participants] = await Promise.all([
    paymentsForSplit(row.split_id),
    participantsForSplit(row.split_id),
  ]);
  return splitFromRow(row, payments, participants);
}

export async function saveSplit(split: SplitRecordData): Promise<SplitRecordData> {
  const splitId = split.splitId.toLowerCase();
  const existing = await getSplit(splitId);
  if (existing) return existing;

  const splitRow = {
    split_id: splitId,
    contract_address: split.contractAddress?.toLowerCase(),
    title: split.title,
    total_amount: split.totalAmount,
    amount_per_person: split.amountPerPerson,
    num_payers: split.numPayers,
    creator: split.creator.toLowerCase(),
    tx_hash: split.txHash.toLowerCase(),
    created_at: split.createdAt,
    status: split.status,
    settled_count: split.settledCount || 0,
    ...(split.groupId ? { group_id: split.groupId } : {}),
  };
  const { error } = await supabaseAdmin.from("splits").insert(splitRow);
  if (error && error.code !== "23505") throw error;

  if (split.payers?.length) {
    const { error: paymentError } = await supabaseAdmin
      .from("split_payments")
      .upsert(
        split.payers.map((payer) => ({
          split_id: splitId,
          payer_address: payer.address.toLowerCase(),
          paid_at: payer.paidAt,
          tx_hash: payer.txHash.toLowerCase(),
          amount: payer.amount,
        })),
        { onConflict: "split_id,tx_hash", ignoreDuplicates: true }
      );
    if (paymentError) throw paymentError;
  }

  if (split.participants?.length) {
    const { error: participantError } = await supabaseAdmin
      .from("split_participants")
      .upsert(
        split.participants.map((participant) => ({
          split_id: splitId,
          wallet_address: participant.address.toLowerCase(),
          display_name: participant.name || null,
          username_snapshot: participant.name || null,
          status: "pending",
          created_at: Date.now(),
        })),
        { onConflict: "split_id,wallet_address", ignoreDuplicates: true }
      );
    if (participantError) throw participantError;
  }

  const saved = await getSplit(splitId);
  if (!saved) throw new Error("Failed to read saved split from Supabase");
  return saved;
}

export async function getProfile(walletAddress: string): Promise<ProfileRecord | null> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("wallet_address, username, created_at")
    .eq("wallet_address", walletAddress.toLowerCase())
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    walletAddress: data.wallet_address,
    username: data.username,
    createdAt: Number(data.created_at),
  };
}

export async function saveProfile(walletAddress: string, username: string): Promise<ProfileRecord> {
  const normalizedAddress = walletAddress.toLowerCase();
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .insert({ wallet_address: normalizedAddress, username, created_at: Date.now() })
    .select("wallet_address, username, created_at")
    .single();
  if (error) {
    if (error.code === "23505") {
      const current = await getProfile(normalizedAddress);
      if (current?.username === username) return current;
      throw new Error("Username or wallet is already registered");
    }
    throw error;
  }
  return {
    walletAddress: data.wallet_address,
    username: data.username,
    createdAt: Number(data.created_at),
  };
}

export async function findProfileByUsername(username: string): Promise<ProfileRecord | null> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("wallet_address, username, created_at")
    .ilike("username", username)
    .maybeSingle();
  if (error) throw error;
  return data
    ? { walletAddress: data.wallet_address, username: data.username, createdAt: Number(data.created_at) }
    : null;
}

export async function findProfileByWalletAddress(walletAddress: string): Promise<ProfileRecord | null> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("wallet_address, username, created_at")
    .eq("wallet_address", walletAddress.toLowerCase())
    .maybeSingle();
  if (error) throw error;
  return data
    ? { walletAddress: data.wallet_address, username: data.username, createdAt: Number(data.created_at) }
    : null;
}

async function hydrateGroups(rows: GroupRow[]): Promise<GroupRecord[]> {
  if (rows.length === 0) return [];
  const groupIds = rows.map((row) => row.id);
  const [membersResult, splitsResult] = await Promise.all([
    supabaseAdmin
      .from("group_members")
      .select("group_id, wallet_address, username_snapshot")
      .in("group_id", groupIds)
      .order("created_at", { ascending: true }),
    supabaseAdmin
      .from("splits")
      .select("group_id, title, status, created_at")
      .in("group_id", groupIds)
      .order("created_at", { ascending: false }),
  ]);
  if (membersResult.error) throw membersResult.error;
  if (splitsResult.error) throw splitsResult.error;

  const membersByGroup = new Map<string, GroupRecord["members"]>();
  for (const member of membersResult.data || []) {
    const members = membersByGroup.get(member.group_id) || [];
    members.push({ address: member.wallet_address, username: member.username_snapshot || undefined });
    membersByGroup.set(member.group_id, members);
  }
  const splitsByGroup = new Map<string, GroupRecord["recentSplits"]>();
  for (const split of splitsResult.data || []) {
    if (!split.group_id) continue;
    const splits = splitsByGroup.get(split.group_id) || [];
    if (splits.length < 5) {
      splits.push({
        title: split.title,
        status: split.status as SplitRecordData["status"],
        createdAt: Number(split.created_at),
      });
    }
    splitsByGroup.set(split.group_id, splits);
  }

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    organizerWalletAddress: row.organizer_wallet_address,
    createdAt: Number(row.created_at),
    members: membersByGroup.get(row.id) || [],
    recentSplits: splitsByGroup.get(row.id) || [],
  }));
}

export async function getUserGroups(address: string): Promise<GroupRecord[]> {
  const { data, error } = await supabaseAdmin
    .from("groups")
    .select("id, organizer_wallet_address, name, created_at")
    .eq("organizer_wallet_address", address.toLowerCase())
    .order("created_at", { ascending: false });
  if (error) throw error;
  return hydrateGroups((data || []) as GroupRow[]);
}

export async function getUserGroup(groupId: string, organizerAddress: string): Promise<GroupRecord | null> {
  const { data, error } = await supabaseAdmin
    .from("groups")
    .select("id, organizer_wallet_address, name, created_at")
    .eq("id", groupId)
    .eq("organizer_wallet_address", organizerAddress.toLowerCase())
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return (await hydrateGroups([data as GroupRow]))[0] || null;
}

export async function createUserGroup(
  organizerAddress: string,
  name: string,
  members: Array<{ address: string; username?: string }>
): Promise<GroupRecord> {
  const now = Date.now();
  const { data, error } = await supabaseAdmin
    .from("groups")
    .insert({
      organizer_wallet_address: organizerAddress.toLowerCase(),
      name,
      created_at: now,
      updated_at: now,
    })
    .select("id, organizer_wallet_address, name, created_at")
    .single();
  if (error) throw error;

  if (members.length > 0) {
    const { error: memberError } = await supabaseAdmin.from("group_members").insert(
      members.map((member) => ({
        group_id: data.id,
        wallet_address: member.address.toLowerCase(),
        username_snapshot: member.username || null,
        created_at: now,
      }))
    );
    if (memberError) throw memberError;
  }

  const group = await getUserGroup(data.id, organizerAddress);
  if (!group) throw new Error("Failed to read saved group");
  return group;
}

export async function getSplit(splitId: string): Promise<SplitRecordData | null> {
  const { data, error } = await supabaseAdmin
    .from("splits")
    .select("*")
    .eq("split_id", splitId.toLowerCase())
    .maybeSingle();
  if (error) throw error;
  return data ? hydrateSplit(data as SplitRow) : null;
}

export async function cancelStoredSplit(splitId: string): Promise<SplitRecordData | null> {
  const { data, error } = await supabaseAdmin
    .from("splits")
    .update({ status: "Cancelled" })
    .eq("split_id", splitId.toLowerCase())
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data ? hydrateSplit(data as SplitRow) : null;
}

export async function reconcileStoredSplit(
  splitId: string,
  settledCount: number,
  status: SplitRecordData["status"]
): Promise<SplitRecordData | null> {
  const { error } = await supabaseAdmin
    .from("splits")
    .update({ settled_count: settledCount, status })
    .eq("split_id", splitId.toLowerCase());
  if (error) throw error;
  return getSplit(splitId);
}

export async function getUserSplits(address: string): Promise<SplitRecordData[]> {
  const lowerAddress = address.toLowerCase();
  const [activeResult, completedResult] = await Promise.all([
    supabaseAdmin
      .from("splits")
      .select("*")
      .eq("creator", lowerAddress)
      .eq("status", "Active")
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("splits")
      .select("*")
      .eq("creator", lowerAddress)
      .in("status", ["Settled", "Cancelled"])
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  if (activeResult.error) throw activeResult.error;
  if (completedResult.error) throw completedResult.error;

  const rows = new Map<string, SplitRow>();
  const returnedRows = [...(activeResult.data || []), ...(completedResult.data || [])] as SplitRow[];
  for (const row of returnedRows) {
    rows.set(row.split_id, row);
  }

  return Promise.all(
    Array.from(rows.values()).map(async (row) => {
      const [payments, participants] = await Promise.all([
        paymentsForSplit(row.split_id),
        participantsForSplit(row.split_id),
      ]);
      return splitFromRow(row, payments, participants);
    })
  );
}

export async function getPaymentsDue(address: string): Promise<PaymentDueData[]> {
  const participantAddress = address.toLowerCase();
  const { data: invitations, error: invitationError } = await supabaseAdmin
    .from("split_participants")
    .select("split_id")
    .eq("wallet_address", participantAddress)
    .eq("status", "pending");
  if (invitationError) throw invitationError;

  const splitIds = (invitations || []).map((invitation) => invitation.split_id);
  if (splitIds.length === 0) return [];

  const { data: splitRows, error: splitError } = await supabaseAdmin
    .from("splits")
    .select("split_id, title, amount_per_person, num_payers, settled_count, creator, created_at")
    .in("split_id", splitIds)
    .eq("status", "Active")
    .order("created_at", { ascending: false });
  if (splitError) throw splitError;

  const rows = (splitRows || []) as Array<Pick<
    SplitRow,
    "split_id" | "title" | "amount_per_person" | "num_payers" | "settled_count" | "creator" | "created_at"
  >>;
  const creators = [...new Set(rows.map((row) => row.creator.toLowerCase()))];
  const usernames = new Map<string, string>();
  if (creators.length > 0) {
    const { data: profiles, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("wallet_address, username")
      .in("wallet_address", creators);
    if (profileError) throw profileError;
    for (const profile of profiles || []) {
      usernames.set(profile.wallet_address.toLowerCase(), profile.username);
    }
  }

  return rows.map((row) => ({
    splitId: row.split_id,
    title: row.title,
    amountPerPerson: row.amount_per_person,
    numPayers: Number(row.num_payers),
    settledCount: Number(row.settled_count),
    creator: row.creator,
    organizerUsername: usernames.get(row.creator.toLowerCase()),
    createdAt: Number(row.created_at),
  }));
}

export async function settleSplitPayment(
  splitId: string,
  payerAddress: string,
  txHash: string,
  amount: string
): Promise<SplitRecordData | null> {
  const normalizedSplitId = splitId.toLowerCase();
  const existing = await getSplit(normalizedSplitId);
  if (!existing) return null;

  const { error: paymentError } = await supabaseAdmin
    .from("split_payments")
    .insert({
      split_id: normalizedSplitId,
      payer_address: payerAddress.toLowerCase(),
      paid_at: Date.now(),
      tx_hash: txHash.toLowerCase(),
      amount,
    });
  if (paymentError) {
    if (paymentError.code !== "23505") throw paymentError;
    // A repeated receipt is safe; a second transaction by the same payer is
    // not. The latter means migration 006 is missing and must be surfaced.
    const { data: indexed, error: lookupError } = await supabaseAdmin
      .from("split_payments")
      .select("tx_hash")
      .eq("split_id", normalizedSplitId)
      .eq("tx_hash", txHash.toLowerCase())
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!indexed) {
      throw new Error("This confirmed payment needs database migration 006 before it can be indexed");
    }
  }

  const payments = await paymentsForSplit(normalizedSplitId);
  const { error: participantUpdateError } = await supabaseAdmin
    .from("split_participants")
    .update({ status: "paid", tx_hash: txHash.toLowerCase() })
    .eq("split_id", normalizedSplitId)
    .eq("wallet_address", payerAddress.toLowerCase());
  if (participantUpdateError && participantUpdateError.code !== "PGRST205") throw participantUpdateError;
  const settledCount = payments.length;
  const { error: updateError } = await supabaseAdmin
    .from("splits")
    .update({
      settled_count: settledCount,
      status: settledCount >= existing.numPayers ? "Settled" : existing.status,
    })
    .eq("split_id", normalizedSplitId);
  if (updateError) throw updateError;

  return getSplit(normalizedSplitId);
}

export async function saveActivity(item: ActivityRecordData): Promise<ActivityRecordData> {
  const normalized: ActivityRecordData = {
    ...item,
    from: item.from || item.address,
    to: item.to || item.counterparty,
  };
  const { error } = await supabaseAdmin.from("activities").upsert(
    {
      id: normalized.id,
      from_address: normalized.from?.toLowerCase() || null,
      to_address: normalized.to?.toLowerCase() || null,
      address: normalized.address.toLowerCase(),
      type: normalized.type,
      title: normalized.title,
      amount: normalized.amount,
      timestamp: normalized.timestamp,
      is_positive: normalized.isPositive,
      tx_hash: normalized.txHash?.toLowerCase() || null,
      split_id: normalized.splitId?.toLowerCase() || null,
      counterparty: normalized.counterparty?.toLowerCase() || null,
      status: normalized.status || null,
    },
    { onConflict: "id" }
  );
  if (error) throw error;
  return normalized;
}

export async function getUserActivity(address: string): Promise<ActivityRecordData[]> {
  const lowerAddress = address.toLowerCase();
  const { data, error } = await supabaseAdmin
    .from("activities")
    .select("*")
    // Each activity row is stored under the wallet that owns that view of
    // the activity. Do not match from/to/counterparty here: a transfer has
    // one sender row and one recipient row with the same transaction hash,
    // and returning both lets the client deduplicate the wrong side.
    .eq("address", lowerAddress)
    .order("timestamp", { ascending: false })
    .limit(50);
  if (error) throw error;

  return ((data || []) as ActivityRow[]).map((row) => ({
    id: row.id,
    from: row.from_address || undefined,
    to: row.to_address || undefined,
    address: row.address,
    type: row.type,
    title: row.title,
    amount: row.amount,
    timestamp: Number(row.timestamp),
    isPositive: row.is_positive,
    txHash: row.tx_hash || undefined,
    splitId: row.split_id || undefined,
    counterparty: row.counterparty || undefined,
    status: row.status || undefined,
  }));
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

export async function consumeRateLimit(
  bucketKey: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
  const resetAt = windowStart + windowMs;
  const { data, error } = await supabaseAdmin.rpc("consume_rate_limit", {
    p_bucket_key: bucketKey,
    p_limit: limit,
    p_window_start: windowStart,
    p_reset_at: resetAt,
  });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  if (!result) throw new Error("Supabase rate-limit function returned no result");
  return {
    allowed: Boolean(result.allowed),
    limit: Number(result.limit_value),
    remaining: Number(result.remaining),
    resetAt: Number(result.reset_at),
  };
}
