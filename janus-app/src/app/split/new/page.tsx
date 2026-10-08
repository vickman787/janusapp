"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Copy,
  Check,
  Loader2,
  ExternalLink,
  CheckCircle2,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { JanusLogo } from "@/components/JanusLogo";
import { usePrivy, useSendTransaction } from "@privy-io/react-auth";
import { encodeFunctionData, formatUnits, isAddress, keccak256, parseUnits, toHex } from "viem";
import { NEW_SPLIT_CONTRACT_ADDRESS, JANUS_SPLIT_ABI, ensureGas, MON_GAS_REQUIRED_MESSAGE, publicClient } from "@/lib/web3";
import { getServerAuthHeaders, saveLocalSplit, saveLocalActivity } from "@/lib/activityStore";
import { describeError } from "@/lib/errors";
import { currentTimestamp, newSplitSeed } from "@/lib/time";

interface Participant {
  id: string;
  name: string;
  address?: string;
  isOwner?: boolean;
}

function SplitPageContent() {
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
    const requestedGroupId = groupId;
    const organizerAddress = activeAddress;
    let disposed = false;
    async function loadGroup() {
      try {
        const response = await fetch(
          `/api/groups?id=${encodeURIComponent(requestedGroupId)}&address=${encodeURIComponent(organizerAddress)}`,
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
      if (!(await ensureGas(activeAddress))) throw new Error(MON_GAS_REQUIRED_MESSAGE);

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
  const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  const shareBaseUrl = configuredAppUrl || (typeof window !== "undefined" ? window.location.origin : "");
  const shareUrl = `${shareBaseUrl}/pay/${currentSplitId}`;
  const isLocalShareUrl = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(shareUrl);

  function handleCopy() {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <main className="min-h-screen bg-[#0B0813] text-white px-5 pt-7 pb-16 max-w-xl mx-auto relative flex flex-col justify-between">
      <div>
        {/* ── Top Header ── */}
        <header className="flex items-center gap-4 border-b border-white/10 pb-5 mb-7">
          <Link
            href="/wallet"
            className="inline-flex items-center gap-2 py-2 text-sm text-white/55 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4 text-white/80" />
            <span>Wallet</span>
          </Link>
          <div className="flex-1">
            <h1 className="text-lg font-semibold text-white tracking-tight">
              Create a split
            </h1>
          </div>
          <JanusLogo size={32} showText={false} />
        </header>

        {groupName && (
          <div className="mb-5 border-l-2 border-[#836EF9] pl-3 py-1">
            <p className="text-xs text-[#C4B5FD]">Creating a split for</p>
            <p className="text-sm font-bold text-white mt-0.5">{groupName}</p>
          </div>
        )}
        {groupLoadError && (
          <div className="mb-5 border-l-2 border-red-400 pl-3 py-1 text-xs text-red-200">
            {groupLoadError}
          </div>
        )}

        {/* ── Bill Title & Total Amount Input Card ── */}
        <div className="mb-6 space-y-5 border-y border-white/10 py-5">
          <div>
            <label className="text-xs font-medium text-white/55 block mb-2">
              What is this for?
            </label>
            <input
              type="text"
              value={billTitle}
              onChange={(e) => setBillTitle(e.target.value)}
              placeholder="e.g. Dinner, Uber, Groceries, Hotel"
              className="w-full bg-transparent border-b border-white/15 px-0 py-2.5 text-base text-white placeholder-white/25 focus:border-[#836EF9] outline-none transition-colors"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-white/55 block mb-2">
              Total amount
            </label>
            <div className="relative flex items-center">
              <span className="absolute left-0 text-lg font-medium text-white/35">$</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={totalBill}
                onChange={(e) => setTotalBill(e.target.value)}
                placeholder="0.00"
                className="w-full bg-transparent border-b border-white/15 pl-6 pr-16 py-3 text-2xl font-semibold text-white placeholder-white/20 focus:border-[#836EF9] outline-none tabular-nums transition-colors"
              />
              <span className="absolute right-0 text-xs font-medium text-white/40">
                AUSD
              </span>
            </div>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-2 border-b border-white/10">
          <button
            type="button"
            onClick={() => setSplitMode("named")}
            className={`border-b-2 px-3 py-3 text-sm font-medium transition-colors ${splitMode === "named" ? "border-[#836EF9] text-white" : "border-transparent text-white/45 hover:text-white"}`}
          >
            Named split
          </button>
          <button
            type="button"
            onClick={() => setSplitMode("open")}
            className={`border-b-2 px-3 py-3 text-sm font-medium transition-colors ${splitMode === "open" ? "border-[#836EF9] text-white" : "border-transparent text-white/45 hover:text-white"}`}
          >
            Open split
          </button>
        </div>

        {splitMode === "open" && (
          <div className="border-b border-white/10 pb-5 mb-5">
            <label className="text-xs font-medium text-white/55 block mb-2">
              Payment slots
            </label>
            <input
              type="number"
              min="1"
              step="1"
              value={openPayerCount}
              onChange={(e) => setOpenPayerCount(e.target.value)}
              className="w-full bg-transparent border-b border-white/15 px-0 py-2.5 text-lg font-semibold text-white focus:border-[#836EF9] outline-none"
            />
            <p className="text-[11px] text-white/45 mt-2">
              Anyone with the payment link can claim one available share. Their wallet will be recorded automatically.
            </p>
          </div>
        )}

        {/* ── Calculation Summary Card ── */}
        <div className="grid grid-cols-2 gap-6 mb-7 border-b border-white/10 pb-6">
          {/* Total Bill Box */}
          <div className="border-l border-white/10 pl-4">
            <p className="text-xs font-medium text-white/40">
              Total bill
            </p>
            <p className="text-2xl font-semibold text-white tabular-nums mt-1">
              ${Number(formatUnits(totalBillBaseUnits, 6)).toFixed(2)}
            </p>
            <p className="text-[10px] text-white/40 mt-0.5">
              {splitMode === "open" ? `${validOpenPayerCount ? parsedOpenPayerCount : 0} payment slots` : `${participantCount} participants`}
            </p>
          </div>

          {/* Per Person Share Box */}
          <div className="border-l border-white/10 pl-4">
            <p className="text-xs font-medium text-white/40">
              Per person
            </p>
            <p className="text-2xl font-semibold text-white tabular-nums mt-1">
              ${perPersonAmount}
            </p>
            <p className="text-[10px] text-white/50 mt-0.5">Each pays equally</p>
          </div>
        </div>

        {/* ── Dynamic Participants List ── */}
        <section className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-white/90 flex items-center gap-2">
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
                className="flex-1 bg-transparent border-b border-white/15 px-0 py-2.5 text-sm text-white placeholder-white/30 focus:border-[#836EF9] outline-none"
              />
              <button
                onClick={handleAddParticipant}
                className="px-3 py-2 text-[#AFA3FF] text-sm font-semibold flex items-center gap-1 transition-colors hover:text-white"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{isResolvingUsername ? "Finding" : "Add"}</span>
              </button>
            </div>
          ) : (
            <div className="mb-3 border-l border-white/15 pl-3 py-1 text-xs text-white/55">
              No names are required. Share the link and the first {validOpenPayerCount ? parsedOpenPayerCount : "—"} wallets can pay.
            </div>
          )}

          {/* Participants list */}
          <div className="divide-y divide-white/10 border-y border-white/10">
            {participants.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between py-4 hover:bg-white/[0.02] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 border border-white/15 flex items-center justify-center text-xs font-semibold text-white/75 shrink-0">
                    {p.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white flex items-center gap-2">
                      <span>{p.name}</span>
                      {p.isOwner && (
                        <span className="text-[10px] text-[#10B981] font-medium">
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
          className="w-full py-3.5 rounded-lg bg-[#836EF9] text-white font-semibold text-sm hover:bg-[#927fff] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isCreating ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Creating split…</span>
            </>
          ) : (
            <>
              <span>Create split</span>
            </>
          )}
        </button>
      </div>

      {/* ── Real Deep-link QR & Share Modal ── */}
      {showQrModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="relative w-full max-w-sm rounded-xl border border-white/15 bg-[#13101D] p-6 text-center">
            <button
              onClick={() => setShowQrModal(false)}
              className="absolute top-4 right-4 text-white/40 hover:text-white"
            >
              ✕
            </button>

            <CheckCircle2 className="mx-auto mb-3 h-6 w-6 text-[#10B981]" />

            <h3 className="text-lg font-bold text-white mb-0.5">{billTitle}</h3>
            <p className="text-xs text-[#836EF9] font-semibold mb-4">
              ${perPersonAmount} AUSD per share · {splitMode === "open" ? `${payerCount} open slots` : `${participantCount} participants`}
            </p>

            {/* Real QR Code linking to payer page */}
            <div className="mx-auto mb-4 flex h-48 w-48 items-center justify-center rounded-lg bg-white p-3">
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
                <span>View transaction ↗</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}

            <p className="text-white/40 text-xs mb-3">
              Share payment link or scan QR code with any device
            </p>
            {isLocalShareUrl && (
              <p className="mb-4 text-left text-xs leading-5 text-amber-200/80">
                This development QR points to localhost and only opens on this computer. On Vercel it automatically uses your public domain.
              </p>
            )}
            {indexingError && (
              <div className="mb-4 border-l-2 border-amber-400/50 pl-3 text-left text-xs text-amber-200">
                <p>Split confirmed on Monad, but JANUS history has not synced it. Retry before sharing the link.</p>
                <p className="mt-1">{indexingError}</p>
                <button onClick={retrySplitIndex} disabled={isRetryingIndex} className="mt-2 underline disabled:opacity-50">
                  {isRetryingIndex ? "Syncing…" : "Retry history sync"}
                </button>
              </div>
            )}

            <div className="mb-4 flex items-center gap-2 border-b border-white/15 py-2.5">
              <p className="text-white/60 text-xs font-mono truncate flex-1 text-left">
                {shareUrl}
              </p>
              <button
                onClick={handleCopy}
                className="shrink-0 p-1.5 text-[#A78BFA] transition-colors hover:text-white"
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
                className="flex items-center justify-center rounded-lg bg-[#836EF9] py-3 text-xs font-semibold text-white hover:bg-[#927fff]"
              >
                Open payment page
              </Link>
              <button
                onClick={() => setShowQrModal(false)}
                className="border-b border-white/20 py-3 text-xs font-semibold text-white/70 hover:text-white"
              >
                Close
              </button>
            </div>
            <Link
              href="/wallet"
              className="flex w-full items-center justify-center py-2.5 text-xs font-medium text-[#A78BFA] transition-colors hover:text-white"
            >
              Return to wallet
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}

export default function SplitPage() {
  return (
    <Suspense fallback={null}>
      <SplitPageContent />
    </Suspense>
  );
}
