"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Copy,
  Check,
  QrCode as QrIcon,
  Loader2,
  ExternalLink,
  Users,
  CheckCircle2,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { JanusLogo } from "@/components/JanusLogo";
import { usePrivy, useSendTransaction } from "@privy-io/react-auth";
import { encodeFunctionData, formatUnits, isAddress, keccak256, parseUnits, toHex } from "viem";
import { NEW_SPLIT_CONTRACT_ADDRESS, JANUS_SPLIT_ABI, ensureGas, publicClient } from "@/lib/web3";
import { getServerAuthHeaders, saveLocalSplit, saveLocalActivity } from "@/lib/activityStore";
import { describeError } from "@/lib/errors";
import { currentTimestamp, newSplitSeed } from "@/lib/time";

interface Participant {
  id: string;
  name: string;
  address?: string;
  isOwner?: boolean;
}

export default function SplitPage() {
  const { authenticated, user, login } = usePrivy();
  const { sendTransaction } = useSendTransaction();
  const searchParams = useSearchParams();
  const activeAddress = user?.wallet?.address;
  const groupId = searchParams.get("group");

  // Bill parameters
  const [billTitle, setBillTitle] = useState("Group Dinner");
  const [totalBill, setTotalBill] = useState("120");
  const [splitMode, setSplitMode] = useState<"named" | "open">("named");
  const [openPayerCount, setOpenPayerCount] = useState("2");
  const [participants, setParticipants] = useState<Participant[]>([
    { id: "p-self", name: "You (Organizer)", address: activeAddress || "", isOwner: true },
  ]);
  const [newFriendName, setNewFriendName] = useState("");
  const [isResolvingUsername, setIsResolvingUsername] = useState(false);

  // On-chain creation state
  const [isCreating, setIsCreating] = useState(false);
  const [createdSplitId, setCreatedSplitId] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [showQrModal, setShowQrModal] = useState(false);
  const [indexingError, setIndexingError] = useState<string | null>(null);
  const [isRetryingIndex, setIsRetryingIndex] = useState(false);
  const [copied, setCopied] = useState(false);
  const [groupName, setGroupName] = useState<string | null>(null);
  const [groupLoadError, setGroupLoadError] = useState<string | null>(null);

  async function indexSplit(id: string, hash: string, invited: Array<{ address: string; name: string }>) {
    const response = await fetch("/api/splits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ splitId: id, txHash: hash, participants: invited, groupId: groupId || undefined }),
    });
    const result = await response.json();
    if (!response.ok || !result.success || !result.verified || !result.split) {
      throw new Error(result.error || "Split history has not synced yet");
    }
  }

  async function retrySplitIndex() {
    if (!createdSplitId || !txHash || isRetryingIndex) return;
    setIsRetryingIndex(true);
    try {
      const invited = splitMode === "named"
        ? participants.filter((participant) => !participant.isOwner && participant.address)
            .map((participant) => ({ address: participant.address!, name: participant.name }))
        : [];
      await indexSplit(createdSplitId, txHash, invited);
      setIndexingError(null);
    } catch (error) {
      setIndexingError(error instanceof Error ? error.message : "Split history has not synced yet");
    } finally {
      setIsRetryingIndex(false);
    }
  }

  useEffect(() => {
    if (!groupId || !activeAddress) return;
    let disposed = false;
    async function loadGroup() {
      try {
        const response = await fetch(
          `/api/groups?id=${encodeURIComponent(groupId)}&address=${encodeURIComponent(activeAddress)}`,
          { headers: await getServerAuthHeaders() }
        );
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || "Could not load group");
        if (disposed) return;
        setGroupName(data.group.name);
        setSplitMode("named");
        setParticipants([
          { id: "p-self", name: "You (Organizer)", address: activeAddress, isOwner: true },
          ...data.group.members.map((member: { address: string; username?: string }, index: number) => ({
            id: `group-${index}-${member.address.toLowerCase()}`,
            name: member.username || `${member.address.slice(0, 6)}...${member.address.slice(-4)}`,
            address: member.address,
          })),
        ]);
      } catch (error) {
        if (!disposed) setGroupLoadError(error instanceof Error ? error.message : "Could not load group");
      }
    }
    void loadGroup();
    return () => { disposed = true; };
  }, [groupId, activeAddress]);

  // Dynamic calculations
  const parsedOpenPayerCount = Number(openPayerCount);
  const validOpenPayerCount = Number.isInteger(parsedOpenPayerCount) && parsedOpenPayerCount >= 1;
  const participantCount = splitMode === "open"
    ? 1 + (validOpenPayerCount ? parsedOpenPayerCount : 0)
    : Math.max(participants.length, 1);
  const debtorCount = participants.filter((participant) => !participant.isOwner).length;
  const payerCount = splitMode === "open" ? parsedOpenPayerCount : debtorCount;
  let totalBillBaseUnits = 0n;
  try {
    totalBillBaseUnits = parseUnits(totalBill || "0", 6);
  } catch {
    totalBillBaseUnits = 0n;
  }
  const perPersonBaseUnits = totalBillBaseUnits / BigInt(splitMode === "open" && validOpenPayerCount ? parsedOpenPayerCount : participantCount);
  const totalOwedBaseUnits = splitMode === "open"
    ? totalBillBaseUnits
    : perPersonBaseUnits * BigInt(debtorCount);
  const perPersonAmount = formatUnits(perPersonBaseUnits, 6);

  // Add a participant
  async function handleAddParticipant() {
    const trimmed = newFriendName.trim();
    const username = trimmed.replace(/^@/, "").toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(username)) {
      alert("Enter a valid JANUS username, such as @alice.");
      return;
    }
    setIsResolvingUsername(true);
    try {
      const res = await fetch(`/api/profiles?username=${encodeURIComponent(username)}`);
      const data = await res.json();
      if (!data.profile?.walletAddress || !isAddress(data.profile.walletAddress)) {
        alert("That username is not registered yet.");
        return;
      }
      const organizerAddress = participants.find((participant) => participant.isOwner)?.address;
      if (
        (organizerAddress && data.profile.walletAddress.toLowerCase() === organizerAddress.toLowerCase()) ||
        (activeAddress && data.profile.walletAddress.toLowerCase() === activeAddress.toLowerCase())
      ) {
        alert("You are already the organizer and cannot be added as a participant.");
        return;
      }
      if (participants.some((participant) => participant.address?.toLowerCase() === data.profile.walletAddress.toLowerCase())) {
        alert("That participant is already on this split.");
        return;
      }
      const name = `@${data.profile.username}`;
      const newP: Participant = {
        id: `p-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        address: data.profile.walletAddress,
      };
      setParticipants((current) => [...current, newP]);
      setNewFriendName("");
    } finally {
      setIsResolvingUsername(false);
    }
  }

  // Remove participant
  function handleRemoveParticipant(id: string) {
    setParticipants(participants.filter((p) => p.id !== id));
  }

  // Create on-chain split on Monad Testnet using Privy wallet
  async function handleCreateSplit() {
    if (!authenticated || !activeAddress) {
      login();
      return;
    }

    if (totalBillBaseUnits <= 0n || perPersonBaseUnits <= 0n) {
      alert("Please enter a valid bill amount greater than $0.");
      return;
    }

    if (splitMode === "open" && !validOpenPayerCount) {
      alert("Enter at least 1 payment slot for the open split.");
      return;
    }

    if (splitMode === "named" && debtorCount < 1) {
      alert("Add at least one friend by username before creating the split, or choose Open split.");
      return;
    }

    const missingParticipant = splitMode === "named" && participants.find(
      (participant) => !participant.isOwner && !isAddress(participant.address || "")
    );
    if (missingParticipant) {
      alert(`Add a valid wallet address for ${missingParticipant.name} before creating the split.`);
      return;
    }

    setIsCreating(true);
    setIndexingError(null);

    try {
      const amountBigInt = totalOwedBaseUnits;
      const rawId = newSplitSeed();
      const idBytes32 = keccak256(toHex(rawId));

      // Ensure user has MON gas
      await ensureGas(activeAddress);

      // Encode createSplit call on JanusSplit contract
      const callData = encodeFunctionData({
        abi: JANUS_SPLIT_ABI,
        functionName: "createSplit",
        args: [idBytes32, amountBigInt, BigInt(payerCount), billTitle || "Bill Split"],
      });

      // 🌟 Prompts the USER'S Privy wallet to create the split on-chain! 🌟
      const { hash } = await sendTransaction(
        {
          to: NEW_SPLIT_CONTRACT_ADDRESS,
          data: callData,
          chainId: 10143,
        },
        { address: activeAddress }
      );

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error("Split creation transaction reverted");
      }

      setCreatedSplitId(idBytes32);
      setTxHash(hash);
      setShowQrModal(true);

      // Save split and activity to persistent store immediately
      const newSplitRecord = {
        splitId: idBytes32,
        contractAddress: NEW_SPLIT_CONTRACT_ADDRESS,
        title: billTitle || "Bill Split",
        totalAmount: formatUnits(totalOwedBaseUnits, 6),
        amountPerPerson: perPersonAmount,
        numPayers: payerCount,
        creator: activeAddress,
        txHash: hash,
        createdAt: currentTimestamp(),
        status: "Active" as const,
        settledCount: 0,
        participants: splitMode === "named"
          ? participants
              .filter((participant) => !participant.isOwner && participant.address)
              .map((participant) => ({ address: participant.address!, name: participant.name }))
          : [],
      };
      saveLocalSplit(activeAddress, newSplitRecord);

      // Index only after the creation receipt has been verified on-chain.
      // The API derives the authoritative split fields from SplitCreated.
      try {
        await indexSplit(idBytes32, hash, newSplitRecord.participants);
      } catch (error) {
        setIndexingError(error instanceof Error ? error.message : "Split history has not synced yet");
      }

      saveLocalActivity(activeAddress, {
        id: hash,
        type: "split_created",
        title: `${billTitle || "Bill Split"} (Split Created)`,
        amount: perPersonAmount,
        timestamp: currentTimestamp(),
        date: "Just now",
        isPositive: false,
        isGroup: true,
        txHash: hash,
        splitId: idBytes32,
        status: "Active",
      });
    } catch (err) {
      console.error("Create split error:", err);
      alert(describeError(err, "Failed to create split with your wallet"));
    } finally {
      setIsCreating(false);
    }
  }

  const currentSplitId = createdSplitId || "split-preview";
  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/pay/${currentSplitId}`
      : `/pay/${currentSplitId}`;

  function handleCopy() {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <main className="min-h-screen bg-[#0B0813] text-white px-5 pt-7 pb-12 max-w-md mx-auto relative flex flex-col justify-between">
      <div>
        {/* ── Top Header ── */}
        <header className="flex items-center gap-3.5 mb-5">
          <Link
            href="/"
            className="w-9 h-9 rounded-full bg-[#161224] border border-[#2A2242] flex items-center justify-center hover:border-[#836EF9]/50 transition-colors shadow-sm"
          >
            <ArrowLeft className="w-4 h-4 text-white/80" />
          </Link>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-white tracking-tight">
              Create Split Bill
            </h1>
          </div>
          <JanusLogo size={32} showText={false} />
        </header>

        {groupName && (
          <div className="mb-4 rounded-2xl bg-[#836EF9]/10 border border-[#836EF9]/25 px-4 py-3">
            <p className="text-xs text-[#C4B5FD]">Creating a split for</p>
            <p className="text-sm font-bold text-white mt-0.5">{groupName}</p>
          </div>
        )}
        {groupLoadError && (
          <div className="mb-4 rounded-2xl bg-red-500/10 border border-red-500/25 px-4 py-3 text-xs text-red-200">
            {groupLoadError}
          </div>
        )}

        {/* ── Bill Title & Total Amount Input Card ── */}
        <div className="bg-[#161224]/90 border border-[#2A2242] rounded-3xl p-5 mb-5 shadow-[0_8px_32px_rgba(0,0,0,0.5)] space-y-4">
          <div>
            <label className="text-[11px] font-semibold text-white/50 uppercase tracking-wider block mb-1.5">
              Bill Name / Description
            </label>
            <input
              type="text"
              value={billTitle}
              onChange={(e) => setBillTitle(e.target.value)}
              placeholder="e.g. Dinner, Uber, Groceries, Hotel"
              className="w-full bg-[#0B0813] border border-[#2A2242] rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-white/20 focus:border-[#836EF9] outline-none transition-colors"
            />
          </div>

          <div>
            <label className="text-[11px] font-semibold text-white/50 uppercase tracking-wider block mb-1.5">
              Total Amount (AUSD)
            </label>
            <div className="relative flex items-center">
              <span className="absolute left-3.5 text-lg font-bold text-white/40">$</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={totalBill}
                onChange={(e) => setTotalBill(e.target.value)}
                placeholder="0.00"
                className="w-full bg-[#0B0813] border border-[#2A2242] rounded-xl pl-8 pr-16 py-3 text-2xl font-extrabold text-white placeholder-white/20 focus:border-[#836EF9] outline-none tabular-nums transition-colors"
              />
              <span className="absolute right-3.5 text-xs font-semibold text-[#836EF9] uppercase tracking-wider">
                AUSD
              </span>
            </div>
          </div>
        </div>

        <div className="bg-[#161224]/90 border border-[#2A2242] rounded-2xl p-1.5 mb-5 grid grid-cols-2 gap-1">
          <button
            type="button"
            onClick={() => setSplitMode("named")}
            className={`rounded-xl px-3 py-2.5 text-xs font-semibold transition-colors ${splitMode === "named" ? "bg-[#836EF9] text-white" : "text-white/50 hover:text-white"}`}
          >
            Named split
          </button>
          <button
            type="button"
            onClick={() => setSplitMode("open")}
            className={`rounded-xl px-3 py-2.5 text-xs font-semibold transition-colors ${splitMode === "open" ? "bg-[#836EF9] text-white" : "text-white/50 hover:text-white"}`}
          >
            Open split
          </button>
        </div>

        {splitMode === "open" && (
          <div className="bg-[#161224]/90 border border-[#836EF9]/40 rounded-2xl p-4 mb-5">
            <label className="text-[11px] font-semibold text-white/60 uppercase tracking-wider block mb-1.5">
              Payment slots
            </label>
            <input
              type="number"
              min="1"
              step="1"
              value={openPayerCount}
              onChange={(e) => setOpenPayerCount(e.target.value)}
              className="w-full bg-[#0B0813] border border-[#2A2242] rounded-xl px-3.5 py-2.5 text-lg font-bold text-white focus:border-[#836EF9] outline-none"
            />
            <p className="text-[11px] text-white/45 mt-2">
              Anyone with the payment link can claim one available share. Their wallet will be recorded automatically.
            </p>
          </div>
        )}

        {/* ── Calculation Summary Card ── */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          {/* Total Bill Box */}
          <div className="bg-[#161224]/90 border border-[#2A2242] rounded-2xl p-4 text-center">
            <p className="text-[10px] font-semibold text-white/40 uppercase tracking-wider">
              TOTAL BILL
            </p>
            <p className="text-2xl font-extrabold text-white tabular-nums mt-1">
              ${Number(formatUnits(totalBillBaseUnits, 6)).toFixed(2)}
            </p>
            <p className="text-[10px] text-white/40 mt-0.5">
              {splitMode === "open" ? `${validOpenPayerCount ? parsedOpenPayerCount : 0} payment slots` : `${participantCount} participants`}
            </p>
          </div>

          {/* Per Person Share Box */}
          <div className="bg-gradient-to-br from-[#836EF9]/20 to-[#161224] border border-[#836EF9]/40 rounded-2xl p-4 text-center shadow-[0_0_20px_rgba(131,110,249,0.15)]">
            <p className="text-[10px] font-semibold text-[#836EF9] uppercase tracking-wider">
              PER PERSON SHARE
            </p>
            <p className="text-2xl font-extrabold text-[#C084FC] tabular-nums mt-1">
              ${perPersonAmount}
            </p>
            <p className="text-[10px] text-white/50 mt-0.5">Each pays equally</p>
          </div>
        </div>

        {/* ── Dynamic Participants List ── */}
        <section className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-white/90 tracking-wide flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-[#836EF9]" />
              <span>{splitMode === "open" ? `Payment slots (${validOpenPayerCount ? parsedOpenPayerCount : 0})` : `Participants (${participants.length})`}</span>
            </h2>
              <span className="text-[10px] text-white/40">{splitMode === "open" ? "Anyone can pay" : "Equal Split"}</span>
          </div>

          {splitMode === "named" ? (
            <div className="flex items-center gap-2 mb-3">
              <input
                type="text"
                value={newFriendName}
                onChange={(e) => setNewFriendName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddParticipant();
                  }
                }}
                placeholder="Add @username"
                className="flex-1 bg-[#161224] border border-[#2A2242] rounded-xl px-3 py-2 text-xs text-white placeholder-white/30 focus:border-[#836EF9] outline-none"
              />
              <button
                onClick={handleAddParticipant}
                className="px-3 py-2 rounded-xl bg-[#836EF9]/20 hover:bg-[#836EF9]/30 text-[#836EF9] text-xs font-semibold flex items-center gap-1 transition-colors border border-[#836EF9]/40"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{isResolvingUsername ? "Finding" : "Add"}</span>
              </button>
            </div>
          ) : (
            <div className="mb-3 rounded-xl border border-[#2A2242] bg-[#0B0813]/60 px-3 py-3 text-xs text-white/55">
              No names are required. Share the link and the first {validOpenPayerCount ? parsedOpenPayerCount : "—"} wallets can pay.
            </div>
          )}

          {/* Participants list */}
          <div className="bg-[#161224]/90 border border-[#2A2242] rounded-2xl divide-y divide-[#2A2242]/70 overflow-hidden shadow-sm">
            {participants.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between p-3.5 hover:bg-[#1E1833]/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-[#836EF9] to-[#C084FC] flex items-center justify-center text-xs font-bold text-white shrink-0">
                    {p.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white flex items-center gap-2">
                      <span>{p.name}</span>
                      {p.isOwner && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#10B981]/20 text-[#10B981] font-semibold">
                          Organizer
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-white/40">
                      {p.address ? `${p.address.slice(0, 6)}…${p.address.slice(-4)}` : "Wallet address required"} · ${perPersonAmount} AUSD
                    </p>
                  </div>
                </div>

                {!p.isOwner && (
                  <button
                    onClick={() => handleRemoveParticipant(p.id)}
                    className="p-1.5 text-white/30 hover:text-red-400 transition-colors"
                    title="Remove participant"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ── Confirm & Create Button ── */}
      <div className="pt-4">
        <button
          onClick={handleCreateSplit}
          disabled={isCreating}
          className="w-full py-4 rounded-2xl bg-gradient-to-r from-[#38BDF8] via-[#836EF9] to-[#C084FC] text-white font-bold text-sm tracking-wider uppercase shadow-[0_0_24px_rgba(131,110,249,0.5)] hover:opacity-95 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isCreating ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Broadcasting to Monad Testnet…</span>
            </>
          ) : (
            <>
              <QrIcon className="w-4 h-4" />
              <span>CONFIRM & CREATE SPLIT ON MONAD</span>
            </>
          )}
        </button>
      </div>

      {/* ── Real Deep-link QR & Share Modal ── */}
      {showQrModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#161224] border border-[#2A2242] rounded-3xl max-w-sm w-full p-6 text-center shadow-2xl relative">
            <button
              onClick={() => setShowQrModal(false)}
              className="absolute top-4 right-4 text-white/40 hover:text-white"
            >
              ✕
            </button>

            <div className="w-12 h-12 rounded-full bg-[#10B981]/15 text-[#10B981] flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 className="w-6 h-6" />
            </div>

            <h3 className="text-lg font-bold text-white mb-0.5">{billTitle}</h3>
            <p className="text-xs text-[#836EF9] font-semibold mb-4">
              ${perPersonAmount} AUSD per share · {splitMode === "open" ? `${payerCount} open slots` : `${participantCount} participants`}
            </p>

            {/* Real QR Code linking to payer page */}
            <div className="w-48 h-48 bg-white rounded-2xl p-3 mx-auto mb-4 flex items-center justify-center shadow-[0_0_32px_rgba(131,110,249,0.3)]">
              <QRCodeSVG
                value={shareUrl}
                size={168}
                bgColor="#FFFFFF"
                fgColor="#0B0813"
                level="M"
              />
            </div>

            {txHash && (
              <a
                href={`https://testnet.monadscan.com/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-[#836EF9] hover:underline mb-3"
              >
                <span>View On MonadScan: {txHash.slice(0, 10)}…{txHash.slice(-6)}</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}

            <p className="text-white/40 text-xs mb-3">
              Share payment link or scan QR code with any device
            </p>
            {indexingError && (
              <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-xs text-amber-200">
                <p>Split confirmed on Monad, but JANUS history has not synced it. Retry before sharing the link.</p>
                <p className="mt-1">{indexingError}</p>
                <button onClick={retrySplitIndex} disabled={isRetryingIndex} className="mt-2 underline disabled:opacity-50">
                  {isRetryingIndex ? "Syncing…" : "Retry history sync"}
                </button>
              </div>
            )}

            <div className="flex items-center gap-2 bg-[#0B0813] border border-[#2A2242] rounded-xl p-2.5 mb-4">
              <p className="text-white/60 text-xs font-mono truncate flex-1 text-left">
                {shareUrl}
              </p>
              <button
                onClick={handleCopy}
                className="p-1.5 rounded-lg bg-[#836EF9]/15 text-[#836EF9] hover:bg-[#836EF9]/25 transition-colors shrink-0"
                title="Copy share link"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-[#10B981]" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-2">
              <Link
                href={`/pay/${currentSplitId}`}
                className="py-3 rounded-xl bg-gradient-to-r from-[#836EF9] to-[#A0055D] text-white font-bold text-xs flex items-center justify-center shadow-[0_2px_12px_rgba(131,110,249,0.35)]"
              >
                Test Payer View
              </Link>
              <button
                onClick={() => setShowQrModal(false)}
                className="py-3 rounded-xl bg-[#0B0813] border border-[#2A2242] text-white/70 hover:text-white font-semibold text-xs"
              >
                Close
              </button>
            </div>
            <Link
              href="/"
              className="w-full py-2.5 rounded-xl bg-[#161224] border border-[#2A2242] text-white/90 hover:text-white font-medium text-xs flex items-center justify-center transition-colors hover:border-[#836EF9]/40"
            >
              View in Wallet Activity
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}
