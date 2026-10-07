"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Send,
  ArrowUpRight,
  ArrowDownLeft,
  ChevronDown,
  Users,
  X,
  CheckCircle,
  Copy,
  Check,
  Droplets,
  Loader2,
  Split,
  LogIn,
  LogOut,
  Wallet,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import { JanusLogo } from "@/components/JanusLogo";
import { BottomNav } from "@/components/BottomNav";
import { usePrivy, useSendTransaction } from "@privy-io/react-auth";
import { encodeFunctionData, isAddress, parseUnits } from "viem";
import { describeError } from "@/lib/errors";
import {
  fetchOnchainAusdBalance,
  AUSD_ADDRESS,
  JANUS_SPLIT_ADDRESS,
  ensureGas,
  publicClient,
  ERC20_ABI,
  JANUS_SPLIT_ABI,
} from "@/lib/web3";
import {
  ActivityItem,
  PaymentDueItem,
  SplitItem,
  fetchPaymentsDue,
  fetchUserActivities,
  fetchUserSplits,
  getServerAuthHeaders,
  indexConfirmedTransfer,
  saveLocalActivity,
  resolveActivityForViewer,
} from "@/lib/activityStore";

export default function DashboardPage() {
  const { login, logout, authenticated, ready, user } = usePrivy();
  const { sendTransaction } = useSendTransaction();

  const [balance, setBalance] = useState("0.00");
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [splits, setSplits] = useState<SplitItem[]>([]);
  const [paymentsDue, setPaymentsDue] = useState<PaymentDueItem[]>([]);
  const [copiedSplitId, setCopiedSplitId] = useState<string | null>(null);
  const [repairingSplitId, setRepairingSplitId] = useState<string | null>(null);
  const [splitSyncErrors, setSplitSyncErrors] = useState<Record<string, string>>({});
  const [cancelTarget, setCancelTarget] = useState<SplitItem | null>(null);
  const [isCancellingSplit, setIsCancellingSplit] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Faucet state
  const [isClaimingFaucet, setIsClaimingFaucet] = useState(false);
  const [faucetSuccessMsg, setFaucetSuccessMsg] = useState<string | null>(null);

  // Address copy state
  const [copied, setCopied] = useState(false);

  // Send modal state
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [sendTo, setSendTo] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sendSent, setSendSent] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendTxHash, setSendTxHash] = useState<string | null>(null);
  const [sendIndexPending, setSendIndexPending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [showUsernamePrompt, setShowUsernamePrompt] = useState(false);
  const [profileUsername, setProfileUsername] = useState<string | null>(null);

  // Active address from Privy user's wallet
  const activeAddress = user?.wallet?.address;
  const shortenedAddress = activeAddress
    ? `${activeAddress.slice(0, 6)}...${activeAddress.slice(-4)}`
    : "";

  useEffect(() => {
    if (!authenticated || !activeAddress || typeof window === "undefined") return;
    const dismissedKey = `janus_username_prompt_dismissed_${activeAddress.toLowerCase()}`;
    (async () => {
      const res = await fetch(`/api/profiles?address=${encodeURIComponent(activeAddress)}`, {
      });
      const data = await res.json();
      if (data.profile?.username) {
        setProfileUsername(data.profile.username);
      } else if (!localStorage.getItem(dismissedKey)) {
        setShowUsernamePrompt(true);
      }
    })().catch(() => undefined);
  }, [authenticated, activeAddress]);

  function dismissUsernamePrompt() {
    if (activeAddress) localStorage.setItem(`janus_username_prompt_dismissed_${activeAddress.toLowerCase()}`, "1");
    setShowUsernamePrompt(false);
  }

  // 1. Fetch live onchain AUSD balance using Viem & Monad RPC
  const refreshBalance = useCallback(async () => {
    if (!activeAddress) {
      setBalance("0.00");
      return;
    }
    try {
      const bal = await fetchOnchainAusdBalance(activeAddress);
      setBalance(bal);
    } catch (e) {
      console.error("Failed to load onchain balance:", e);
    }
  }, [activeAddress]);

  // Split cards have their own chain-backed refresh path. This does not rely
  // on the activity API or the local JSON cache for settlement state.
  const refreshSplits = useCallback(async () => {
    if (!activeAddress) {
      setSplits([]);
      setPaymentsDue([]);
      return;
    }

    try {
      const splitItems = await fetchUserSplits(activeAddress);
      const liveSplits = await Promise.all(
        splitItems.map(async (split) => {
          try {
            const onchain = (await publicClient.readContract({
              address: (split.contractAddress || JANUS_SPLIT_ADDRESS) as `0x${string}`,
              abi: [
                {
                  type: "function",
                  name: "getSplit",
                  stateMutability: "view",
                  inputs: [{ name: "splitId", type: "bytes32" }],
                  outputs: [
                    {
                      type: "tuple",
                      components: [
                        { name: "requester", type: "address" },
                        { name: "totalAmount", type: "uint256" },
                        { name: "amountPerPayer", type: "uint256" },
                        { name: "numPayers", type: "uint256" },
                        { name: "settledCount", type: "uint256" },
                        { name: "status", type: "uint8" },
                        { name: "memo", type: "string" },
                      ],
                    },
                  ],
                },
              ],
              functionName: "getSplit",
              args: [split.splitId as `0x${string}`],
            })) as { status: number; settledCount: bigint };

            return {
              ...split,
              status:
                onchain.status === 1
                  ? "Settled"
                  : onchain.status === 2
                    ? "Cancelled"
                    : "Active",
              settledCount: Number(onchain.settledCount),
            } as SplitItem;
          } catch {
            return split;
          }
        })
      );
      setSplits(liveSplits);
      try {
        setPaymentsDue(await fetchPaymentsDue(activeAddress));
      } catch (error) {
        // Keep the last confirmed inbox instead of making a pending request
        // disappear because of a temporary network or auth refresh failure.
        console.warn("Failed to refresh payments due:", error);
      }
    } catch (e) {
      console.warn("Failed to refresh split status:", e);
    }
  }, [activeAddress]);

  // Fetch live event logs & persistent history for active address.
  const refreshActivity = useCallback(async () => {
    if (!activeAddress) {
      setActivity([]);
      return;
    }
    try {
      setActivity(await fetchUserActivities(activeAddress));
      await refreshSplits();
    } catch (e) {
      console.warn("Failed to load user activities:", e);
    }
  }, [activeAddress, refreshSplits]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshBalance(), refreshActivity()]);
  }, [refreshActivity, refreshBalance]);

  async function syncMissingSplitPayments(split: SplitItem) {
    if (repairingSplitId) return;
    setRepairingSplitId(split.splitId);
    setSplitSyncErrors((current) => ({ ...current, [split.splitId]: "" }));
    try {
      const indexed = new Set((split.payers || []).map((payer) => payer.txHash.toLowerCase()));
      const missing = activity.filter((item) =>
        item.type === "received" && item.splitId?.toLowerCase() === split.splitId.toLowerCase() &&
        item.txHash && !indexed.has(item.txHash.toLowerCase())
      );
      if (missing.length === 0) throw new Error("No missing payment receipt is available in JANUS activity yet");
      for (const item of missing) {
        const response = await fetch("/api/splits/pay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ splitId: split.splitId, txHash: item.txHash }),
        });
        const result = await response.json();
        if (!response.ok || !result.success || !result.verified) {
          throw new Error(result.error || "Could not sync this payment");
        }
      }
      await refreshSplits();
    } catch (error) {
      setSplitSyncErrors((current) => ({
        ...current,
        [split.splitId]: describeError(error, "Could not sync this payment"),
      }));
    } finally {
      setRepairingSplitId(null);
    }
  }

  async function confirmCancelSplit() {
    const split = cancelTarget;
    if (!split || !activeAddress || isCancellingSplit) return;

    setIsCancellingSplit(true);
    setCancelError(null);
    try {
      if (split.status !== "Active") throw new Error("Only active splits can be cancelled");
      if (split.creator.toLowerCase() !== activeAddress.toLowerCase()) {
        throw new Error("Only the organizer can cancel this split");
      }

      await ensureGas(activeAddress);
      const callData = encodeFunctionData({
        abi: JANUS_SPLIT_ABI,
        functionName: "cancelSplit",
        args: [split.splitId as `0x${string}`],
      });
      const contractAddress = (split.contractAddress || JANUS_SPLIT_ADDRESS) as `0x${string}`;
      const { hash } = await sendTransaction(
        { to: contractAddress, data: callData, chainId: 10143 },
        { address: activeAddress }
      );
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Split cancellation transaction reverted");

      try {
        const response = await fetch("/api/splits/cancel", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(await getServerAuthHeaders()),
          },
          body: JSON.stringify({ splitId: split.splitId, txHash: hash, address: activeAddress }),
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
          console.warn("Cancellation was confirmed on Monad but JANUS indexing failed:", result.error);
        }
      } catch (indexError) {
        console.warn("Cancellation was confirmed on Monad but JANUS indexing failed:", indexError);
      }

      await refreshSplits();
      setCancelTarget(null);
    } catch (error) {
      setCancelError(describeError(error, "Could not cancel this split"));
    } finally {
      setIsCancellingSplit(false);
    }
  }

  useEffect(() => {
    if (authenticated && activeAddress) {
      const initialRefresh = setTimeout(() => {
        refreshBalance();
        refreshActivity();
      }, 0);

      // One refresh every two minutes while the page is visible. The manual
      // refresh button remains available for an immediate update.
      const refreshTimer = setInterval(() => {
        if (document.visibilityState !== "visible") return;
        refreshBalance();
        refreshActivity();
      }, 120000);
      return () => {
        clearTimeout(initialRefresh);
        clearInterval(refreshTimer);
      };
    } else {
      const reset = setTimeout(() => {
        setBalance("0.00");
        setActivity([]);
        setSplits([]);
        setPaymentsDue([]);
      }, 0);
      return () => clearTimeout(reset);
    }
  }, [authenticated, activeAddress, refreshBalance, refreshActivity, refreshSplits]);

  // 3. Faucet claim: calls /api/faucet with user's active Privy wallet address
  async function handleClaimFaucet() {
    if (!authenticated || !activeAddress) {
      login();
      return;
    }
    if (isClaimingFaucet) return;
    setIsClaimingFaucet(true);
    setFaucetSuccessMsg(null);

    try {
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: activeAddress }),
      });
      const data = await res.json();

      if (data.success) {
        setFaucetSuccessMsg("+10,000 AUSD Dripped!");

        // Record in persistent activity store
        saveLocalActivity(activeAddress, {
          id: data.txHash || `faucet-${Date.now()}`,
          type: "faucet",
          title: "Agora AUSD Faucet Drip",
          amount: "10000.00",
          timestamp: Date.now(),
          date: "Just now",
          isPositive: true,
          txHash: data.txHash,
          status: "Confirmed",
        });

        if (data.balance) {
          setBalance(data.balance);
        } else {
          refreshBalance();
        }
        refreshActivity();
        setTimeout(() => setFaucetSuccessMsg(null), 5000);
      } else {
        alert(data.error || "Faucet claim failed");
      }
    } catch (err) {
      console.error("Faucet error:", err);
      alert("Failed to connect to Agora faucet.");
    } finally {
      setIsClaimingFaucet(false);
    }
  }

  function handleCopyAddress() {
    if (!activeAddress) return;
    navigator.clipboard.writeText(activeAddress).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleCopySplitLink(split: SplitItem) {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/pay/${split.splitId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedSplitId(split.splitId);
      setTimeout(() => setCopiedSplitId(null), 2000);
    });
  }

  async function handleSendSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sendTo || !sendAmount) return;
    if (!authenticated || !activeAddress) {
      login();
      return;
    }

    setIsSending(true);
    setSendError(null);
    setSendTxHash(null);
    setSendIndexPending(false);

    try {
      let recipientAddress = sendTo.trim();
      if (recipientAddress.startsWith("@")) {
        const profileResponse = await fetch(`/api/profiles?username=${encodeURIComponent(recipientAddress.slice(1).toLowerCase())}`);
        const profileData = await profileResponse.json();
        recipientAddress = profileData.profile?.walletAddress || "";
        if (!recipientAddress) throw new Error("That username is not registered");
      }
      if (!isAddress(recipientAddress)) {
        throw new Error("Enter a valid @username or wallet address");
      }
      let amountBigInt: bigint;
      try {
        amountBigInt = parseUnits(sendAmount, 6);
      } catch {
        throw new Error("Please enter a valid amount");
      }
      if (amountBigInt <= 0n) throw new Error("Amount must be greater than zero");

      // Make sure user has gas for the transaction
      await ensureGas(activeAddress);

      // Encode transfer(recipient, amount) for Agora AUSD
      const callData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [recipientAddress as `0x${string}`, amountBigInt],
      });

      // 🌟 Prompts the USER'S Privy wallet to sign & broadcast directly! 🌟
      const { hash } = await sendTransaction(
        {
          to: AUSD_ADDRESS,
          data: callData,
          chainId: 10143,
        },
        { address: activeAddress }
      );

      setSendTxHash(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Transfer reverted on Monad");
      setSendSent(true);

      // Keep the confirmed transaction visible locally while server history syncs.
      saveLocalActivity(activeAddress, {
        id: hash,
        type: "send",
        from: activeAddress,
        to: recipientAddress,
        title: sendTo.trim().startsWith("@")
          ? `Sent to @${sendTo.trim().slice(1)}`
          : `Sent to ${recipientAddress.slice(0, 6)}…${recipientAddress.slice(-4)}`,
        amount: sendAmount,
        timestamp: Date.now(),
        date: "Just now",
        isPositive: false,
        txHash: hash,
        counterparty: recipientAddress,
        status: "Confirmed",
      });

      setSendIndexPending(!(await indexConfirmedTransfer(hash)));
      refreshBalance();
      refreshActivity();
    } catch (err) {
      console.error("Send transaction error:", err);
      setSendError(describeError(err, "Transaction cancelled or failed"));
    } finally {
      setIsSending(false);
    }
  }

  if (!ready) {
    return (
      <main className="min-h-screen bg-[#0B0813] text-white px-5 pt-8 pb-28 max-w-md mx-auto flex flex-col">
        <header className="flex items-center justify-between mb-6">
          <JanusLogo size={36} showText={true} />
          <div className="flex items-center gap-2 text-xs text-white/50">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[#836EF9]" />
            Restoring wallet
          </div>
        </header>
        <div className="rounded-3xl border border-[#2A2242] bg-[#161224]/90 p-7 text-center">
          <div className="mx-auto mb-3 h-14 w-14 animate-pulse rounded-full border-[6px] border-[#836EF9]/40" />
          <p className="text-sm text-white/50">Checking your secure JANUS session…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0B0813] text-white px-5 pt-8 pb-28 max-w-md mx-auto relative flex flex-col justify-between">
      {showUsernamePrompt && (
        <div className="fixed inset-0 z-[100] bg-[#0B0813]/80 backdrop-blur-sm flex items-center justify-center p-5">
          <div className="w-full max-w-sm bg-[#161224] border border-[#2A2242] rounded-3xl p-6 shadow-2xl">
            <p className="text-xs font-bold uppercase tracking-widest text-[#836EF9] mb-2">Make JANUS yours</p>
            <h2 className="text-2xl font-extrabold text-white mb-2">Choose a username</h2>
            <p className="text-sm text-white/55 mb-5">Use a simple name like <span className="text-[#A78BFA]">@alice</span> when inviting friends or sending AUSD.</p>
            <div className="flex gap-2">
              <Link href="/settings" onClick={() => setShowUsernamePrompt(false)} className="flex-1 text-center py-3 rounded-xl bg-[#836EF9] text-white font-bold">Create username</Link>
              <button onClick={dismissUsernamePrompt} className="flex-1 py-3 rounded-xl border border-[#2A2242] text-white/70 font-bold">Maybe later</button>
            </div>
          </div>
        </div>
      )}
      <div>
        {/* ── Top Header Navigation Bar ── */}
        <header className="flex items-center justify-between mb-6">
          <Link href="/" className="hover:opacity-95 transition-opacity">
            <JanusLogo size={36} showText={true} />
          </Link>

          {/* Privy Auth Button / Status */}
          {!authenticated ? (
            <button
              onClick={login}
              className="flex items-center gap-2 py-2 px-4 rounded-full bg-gradient-to-r from-[#836EF9] to-[#A0055D] text-white text-xs font-bold hover:opacity-95 shadow-[0_2px_12px_rgba(131,110,249,0.4)] transition-all active:scale-95"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Connect / Sign In</span>
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href="/settings"
                className="flex items-center gap-2 py-1.5 px-3 rounded-full bg-[#161224]/80 border border-[#2A2242] hover:border-[#836EF9]/50 transition-colors shadow-sm"
              >
                <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-[#836EF9] to-[#C084FC] flex items-center justify-center text-[10px] font-bold text-white">
                  <Wallet className="w-3 h-3 text-white" />
                </div>
                <span className="text-xs font-mono font-medium text-white/90">
                  {profileUsername ? `@${profileUsername}` : shortenedAddress}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-white/50" />
              </Link>
              <button
                onClick={logout}
                className="p-2 rounded-full bg-[#161224]/80 border border-[#2A2242] hover:border-red-500/50 hover:text-red-400 text-white/50 transition-colors"
                title="Disconnect"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </header>

        {/* ── Heading ── */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Your Wallet
          </h1>
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#836EF9]/10 border border-[#836EF9]/30 text-[10px] font-semibold text-[#836EF9]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse" />
            <span>Monad Testnet</span>
          </div>
        </div>

        {/* ── Balance Card (Live On-Chain Agora AUSD Balance) ── */}
        <div className="relative rounded-3xl overflow-hidden bg-[#161224]/90 border border-[#2A2242] p-7 mb-4 text-center shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
          {/* Subtle Ambient Backlight */}
          <div className="absolute -top-12 left-1/2 -translate-x-1/2 w-48 h-48 bg-[#836EF9]/20 rounded-full blur-3xl pointer-events-none" />

          {/* Monad Glowing Ring / Donut */}
          <div className="relative mx-auto mb-3 flex items-center justify-center">
            <div className="w-14 h-14 rounded-full border-[6px] border-[#836EF9] shadow-[0_0_24px_rgba(131,110,249,0.7)] flex items-center justify-center">
              <div className="w-5 h-5 rounded-full bg-[#161224]" />
            </div>
          </div>

          <p className="text-white/40 text-[11px] font-semibold uppercase tracking-[0.2em] mb-1">
            AUSD BALANCE:
          </p>

          <p className="min-h-[48px] flex items-center justify-center text-4xl font-extrabold text-white tabular-nums tracking-tight">
            {!authenticated ? (
              <span className="text-white/30 text-3xl font-medium">$0.00</span>
            ) : (
              `$${balance}`
            )}
          </p>

          {/* If authenticated: display shortened wallet address and disconnect button */}
          {authenticated && activeAddress ? (
            <div className="mt-3 pt-3 border-t border-[#2A2242]/70 flex items-center justify-center gap-2">
              <button
                onClick={handleCopyAddress}
                className="flex items-center gap-1.5 text-[11px] font-mono text-white/60 hover:text-white transition-colors bg-[#0B0813]/60 px-2.5 py-1 rounded-full border border-[#2A2242]"
                title="Click to copy full address"
              >
                <span>{shortenedAddress}</span>
                {copied ? (
                  <Check className="w-3 h-3 text-[#10B981]" />
                ) : (
                  <Copy className="w-3 h-3 text-white/40" />
                )}
              </button>
              <button
                onClick={logout}
                className="flex items-center gap-1 text-[11px] text-white/40 hover:text-red-400 transition-colors bg-[#0B0813]/60 px-2.5 py-1 rounded-full border border-[#2A2242]"
                title="Disconnect"
              >
                <LogOut className="w-3 h-3" />
                <span>Disconnect</span>
              </button>
            </div>
          ) : (
            <div className="mt-4 pt-3 border-t border-[#2A2242]/70 flex flex-col items-center">
              <p className="text-[11px] text-white/40 mb-2">Connect to access your Monad vault</p>
              <button
                onClick={login}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-[#836EF9] to-[#A0055D] text-white text-xs font-bold shadow-[0_2px_12px_rgba(131,110,249,0.35)] hover:opacity-95 active:scale-95 transition-all"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Connect / Sign In</span>
              </button>
            </div>
          )}
        </div>

        {/* ── Faucet Drip Helper Banner (Claim Testnet AUSD) ── */}
        <div className="mb-6 bg-gradient-to-r from-[#836EF9]/15 to-[#10B981]/10 border border-[#836EF9]/30 rounded-2xl p-3.5 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[#10B981]/20 text-[#10B981] flex items-center justify-center shrink-0">
              <Droplets className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-bold text-white">
                Need Testnet Funds?
              </p>
              <p className="text-[10px] text-white/50">
                Claim 10,000 Agora AUSD to your address
              </p>
            </div>
          </div>

          <button
            onClick={handleClaimFaucet}
            disabled={isClaimingFaucet}
            className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-[#836EF9] to-[#10B981] text-white font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-[0_2px_12px_rgba(131,110,249,0.4)] hover:opacity-95 active:scale-95 transition-all disabled:opacity-50"
          >
            {isClaimingFaucet ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Claiming…</span>
              </>
            ) : faucetSuccessMsg ? (
              <span className="text-[#10B981]">{faucetSuccessMsg}</span>
            ) : (
              <span>Claim AUSD</span>
            )}
          </button>
        </div>

        {/* ── Quick Actions (SEND AUSD & REQUEST AUSD) ── */}
        <div className="mb-7">
          <h2 className="text-sm font-semibold text-white/90 mb-3 tracking-wide">
            Quick Actions
          </h2>
          <div className="grid grid-cols-2 gap-3.5">
            {/* SEND AUSD */}
            <button
              onClick={() => {
                if (!authenticated) {
                  login();
                } else {
                  setSendModalOpen(true);
                }
              }}
              className="flex flex-col items-center justify-center gap-2 p-5 rounded-2xl bg-[#161224]/90 border border-[#2A2242] hover:border-[#836EF9]/50 transition-all group shadow-sm active:scale-[0.98]"
            >
              <div className="w-10 h-10 rounded-full bg-[#836EF9]/10 flex items-center justify-center group-hover:bg-[#836EF9]/20 transition-colors">
                <Send className="w-4 h-4 text-[#836EF9] rotate-[-25deg]" />
              </div>
              <span className="text-xs font-bold text-white/85 tracking-wider uppercase">
                SEND AUSD
              </span>
            </button>

            {/* REQUEST AUSD */}
            <Link
              href="/split"
              className="flex flex-col items-center justify-center gap-2 p-5 rounded-2xl bg-[#161224]/90 border border-[#2A2242] hover:border-[#836EF9]/50 transition-all group shadow-sm active:scale-[0.98]"
            >
              <div className="w-10 h-10 rounded-full bg-[#836EF9]/10 flex items-center justify-center group-hover:bg-[#836EF9]/20 transition-colors">
                <ArrowUpRight className="w-4 h-4 text-[#836EF9]" />
              </div>
              <span className="text-xs font-bold text-white/85 tracking-wider uppercase">
                REQUEST AUSD
              </span>
            </Link>
          </div>
        </div>

        {/* ── Active Bill Splits (Created by or Involving User) ── */}
        {authenticated && paymentsDue.length > 0 && (
          <section className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-white/90 tracking-wide">
                  Payments Due
                </h2>
                <span className="px-1.5 py-0.5 rounded-full bg-[#F59E0B]/15 text-[#FBBF24] text-[10px] font-bold">
                  {paymentsDue.length}
                </span>
              </div>
              <span className="text-[10px] text-white/40 uppercase tracking-wider">
                Private to you
              </span>
            </div>

            <div className="space-y-2.5">
              {paymentsDue.map((payment) => {
                const organizer = payment.organizerUsername
                  ? `@${payment.organizerUsername}`
                  : `${payment.creator.slice(0, 6)}...${payment.creator.slice(-4)}`;
                const fundedShares = Math.min(payment.settledCount, payment.numPayers);

                return (
                  <div
                    key={payment.splitId}
                    className="p-3.5 rounded-2xl bg-[#161224]/90 border border-[#2A2242] hover:border-[#F59E0B]/40 transition-all shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-white truncate">{payment.title}</h3>
                        <p className="text-xs text-white/65 mt-1">
                          You owe <span className="font-semibold text-white">${payment.amountPerPerson} AUSD</span>
                        </p>
                        <p className="text-xs text-white/45 mt-1">Organizer: {organizer}</p>
                        <p className="text-[11px] text-white/35 mt-1">
                          {fundedShares} of {payment.numPayers} shares funded
                        </p>
                      </div>
                      <Link
                        href={`/pay/${payment.splitId}`}
                        className="shrink-0 px-3 py-2 rounded-xl bg-[#836EF9]/20 border border-[#836EF9]/30 text-xs font-semibold text-[#A78BFA] hover:bg-[#836EF9]/30 transition-colors"
                      >
                        Pay now
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {authenticated && splits.length > 0 && (
          <section className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-white/90 tracking-wide">
                  Bill Splits
                </h2>
                <span className="px-1.5 py-0.5 rounded-full bg-[#836EF9]/20 text-[#836EF9] text-[10px] font-bold">
                  {splits.length}
                </span>
              </div>
              <Link
                href="/split/new"
                className="text-xs text-[#836EF9] hover:text-[#A78BFA] font-medium transition-colors"
              >
                + New Split
              </Link>
            </div>

            <div className="space-y-2.5">
              {splits.map((s) => {
                const isCopied = copiedSplitId === s.splitId;
                const paidAddresses = new Set((s.payers || []).map((payer) => payer.address.toLowerCase()));
                const expectedParticipants = s.participants || [];
                const fundedShares = Math.min(s.settledCount ?? s.payers?.length ?? 0, s.numPayers);
                const unindexedShares = Math.max(0, fundedShares - (s.payers?.length ?? 0));
                const payerCounts = new Map<string, number>();
                for (const payer of s.payers || []) {
                  const key = payer.address.toLowerCase();
                  payerCounts.set(key, (payerCounts.get(key) || 0) + 1);
                }
                return (
                  <div
                    key={s.splitId}
                    className="p-3.5 rounded-2xl bg-[#161224]/90 border border-[#2A2242] hover:border-[#836EF9]/40 transition-all shadow-sm"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h3 className="text-sm font-bold text-white">{s.title}</h3>
                        <p className="text-xs text-white/50">
                          ${s.amountPerPerson} AUSD / person · {s.numPayers} participants
                        </p>
                      <p className="text-xs text-[#A78BFA] mt-1">
                        {fundedShares} of {s.numPayers} shares funded
                      </p>
                      </div>
                      <span className="px-2 py-0.5 rounded-full bg-[#10B981]/15 text-[#10B981] text-[10px] font-bold uppercase tracking-wider">
                        {s.status}
                      </span>
                    </div>

                    {(s.payers?.length ?? 0) > 0 && (
                      <div className="mt-2 rounded-xl bg-[#0B0813]/60 px-2.5 py-2 text-[11px] text-white/60">
                        <span className="text-white/80">Paid by:</span>{" "}
                        {Array.from(payerCounts.entries()).map(([address, count], index) => (
                          <span key={address}>
                            {index > 0 ? ", " : ""}
                            {expectedParticipants.find((participant) => participant.address.toLowerCase() === address)?.name || `${address.slice(0, 6)}…${address.slice(-4)}`}
                            {count > 1 ? ` (${count} shares)` : ""}
                          </span>
                        ))}
                        {(s.numPayers - fundedShares) > 0 && (
                          <span className="text-amber-300"> · {s.numPayers - fundedShares} shares still unfunded</span>
                        )}
                      </div>
                    )}
                    {unindexedShares > 0 && (
                      <div className="mt-2 text-[11px] text-amber-300">
                        <p>{unindexedShares} confirmed {unindexedShares === 1 ? "payment is" : "payments are"} still syncing to JANUS history.</p>
                        <button onClick={() => syncMissingSplitPayments(s)} disabled={repairingSplitId === s.splitId} className="mt-1 underline disabled:opacity-50">
                          {repairingSplitId === s.splitId ? "Syncing…" : "Sync payment history"}
                        </button>
                        {splitSyncErrors[s.splitId] && <p className="mt-1">{splitSyncErrors[s.splitId]}</p>}
                      </div>
                    )}

                    {expectedParticipants.length > 0 && (
                      <div className="mt-2 rounded-xl bg-[#0B0813]/60 px-2.5 py-2 text-[11px] text-white/60">
                        <span className="text-white/80">Participant status:</span>
                        <div className="mt-1 space-y-0.5">
                          {expectedParticipants.map((participant) => {
                            const paid = paidAddresses.has(participant.address.toLowerCase());
                            return (
                              <div key={participant.address} className="flex items-center justify-between gap-2">
                                <span className="truncate">
                                  {participant.name || `${participant.address.slice(0, 6)}…${participant.address.slice(-4)}`}
                                </span>
                                <span className={paid ? "text-emerald-300" : "text-amber-300"}>
                                  {paid ? "Paid" : s.status === "Settled" ? "Covered" : "Pending"}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-2 border-t border-[#2A2242]/60 mt-1">
                      {s.txHash ? (
                        <a
                          href={`https://testnet.monadscan.com/tx/${s.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-mono text-white/40 hover:text-[#836EF9] transition-colors"
                        >
                          <span>Tx: {s.txHash.slice(0, 6)}…{s.txHash.slice(-4)}</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-[11px] text-white/30">On-chain</span>
                      )}

                      <div className="flex items-center gap-2">
                        {s.status === "Active" && activeAddress && s.creator.toLowerCase() === activeAddress.toLowerCase() && (
                          <button
                            onClick={() => {
                              setCancelError(null);
                              setCancelTarget(s);
                            }}
                            className="text-xs text-red-300 hover:text-red-200 transition-colors"
                          >
                            Cancel split
                          </button>
                        )}
                        <Link
                          href={`/pay/${s.splitId}`}
                          className="text-xs text-white/70 hover:text-white transition-colors"
                        >
                          Payer Link
                        </Link>
                        <button
                          onClick={() => handleCopySplitLink(s)}
                          className="flex items-center gap-1 py-1 px-2.5 rounded-lg bg-[#836EF9]/15 text-[#836EF9] hover:bg-[#836EF9]/25 text-xs font-medium transition-colors"
                        >
                          {isCopied ? (
                            <>
                              <Check className="w-3 h-3 text-[#10B981]" />
                              <span className="text-[#10B981]">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>Share</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Recent Activity (Persistent Transactions & Split Events) ── */}
        <section id="activity" className="mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-white/90 tracking-wide">
              Recent Activity
            </h2>
            {authenticated && (
              <button
                onClick={refreshAll}
                className="text-xs text-[#836EF9] hover:text-[#A78BFA] font-medium transition-colors"
              >
                Refresh
              </button>
            )}
          </div>

          {!authenticated ? (
            <div className="bg-[#161224]/90 border border-[#2A2242] rounded-2xl p-7 text-center shadow-sm">
              <div className="w-12 h-12 rounded-full bg-[#836EF9]/15 text-[#836EF9] flex items-center justify-center mx-auto mb-3">
                <Split className="w-5 h-5" />
              </div>
              <p className="text-sm font-bold text-white mb-1">
                No splits yet. Create your first split bill!
              </p>
              <p className="text-xs text-white/40 max-w-xs mx-auto mb-4">
                Split dinner, rent, or drinks in sub-second Monad transactions.
              </p>
              <button
                onClick={login}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-[#836EF9] to-[#A0055D] text-white text-xs font-bold shadow-[0_2px_12px_rgba(131,110,249,0.35)] hover:opacity-95 transition-opacity"
              >
                Connect to View
              </button>
            </div>
          ) : activity.length === 0 ? (
            <div className="bg-[#161224]/90 border border-[#2A2242] rounded-2xl p-7 text-center shadow-sm">
              <div className="w-12 h-12 rounded-full bg-[#836EF9]/15 text-[#836EF9] flex items-center justify-center mx-auto mb-3">
                <Split className="w-5 h-5" />
              </div>
              <p className="text-sm font-bold text-white mb-1">
                No splits yet. Create your first split bill!
              </p>
              <p className="text-xs text-white/40 max-w-xs mx-auto mb-4">
                Split dinner, rent, or drinks in sub-second Monad transactions.
              </p>
              <Link
                href="/split/new"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-[#836EF9] to-[#A0055D] text-white text-xs font-bold shadow-[0_2px_12px_rgba(131,110,249,0.35)] hover:opacity-95 transition-opacity"
              >
                Create Split
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {activity.map((rawItem) => {
                const item = resolveActivityForViewer(rawItem, activeAddress || "");
                const isIncoming = item.direction === "received" || item.direction === "faucet";

                return (
                  <div
                    key={rawItem.id}
                    className="p-3.5 rounded-2xl bg-[#161224]/80 border border-[#2A2242] hover:border-[#836EF9]/40 transition-all shadow-sm flex flex-col gap-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div
                          className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                            isIncoming
                              ? "bg-[#10B981]/15 text-[#10B981] border border-[#10B981]/30"
                              : item.direction === "sent"
                              ? "bg-[#F59E0B]/15 text-[#F59E0B] border border-[#F59E0B]/30"
                              : "bg-[#836EF9]/15 text-[#836EF9] border border-[#836EF9]/30"
                          }`}
                        >
                          {item.direction === "faucet" ? (
                            <Droplets className="w-5 h-5" />
                          ) : item.direction === "received" ? (
                            <ArrowDownLeft className="w-5 h-5 stroke-[2.5]" />
                          ) : item.direction === "sent" ? (
                            <ArrowUpRight className="w-5 h-5 stroke-[2.5]" />
                          ) : item.direction === "split_paid" ? (
                            <CheckCircle className="w-5 h-5 stroke-[2.5]" />
                          ) : (
                            <Users className="w-5 h-5" />
                          )}
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                isIncoming
                                  ? "bg-[#10B981]/20 text-[#10B981]"
                                  : item.direction === "sent"
                                  ? "bg-[#F59E0B]/20 text-[#F59E0B]"
                                  : "bg-[#836EF9]/20 text-[#836EF9]"
                              }`}
                            >
                              {item.badge}
                            </span>
                            <p className="min-w-0 truncate text-sm font-semibold text-white">{item.title}</p>
                          </div>

                          <p className="text-[11px] text-white/50 font-mono mt-0.5">
                            {item.actionText}
                          </p>
                        </div>
                      </div>

                      <div className="w-20 shrink-0 text-right">
                        <p
                          className={`text-sm font-bold tabular-nums ${
                            isIncoming ? "text-[#10B981]" : "text-white/95"
                          }`}
                        >
                          {item.amountDisplay}
                        </p>
                        <p className="text-[10px] text-white/40 uppercase font-semibold">
                          AUSD
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1.5 border-t border-[#2A2242]/50 text-[11px] text-white/40">
                      <span>{item.date}</span>
                      {item.txHash && (
                        <a
                          href={`https://testnet.monadscan.com/tx/${item.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-[#836EF9] hover:underline"
                        >
                          <span>Tx: {item.txHash.slice(0, 6)}…{item.txHash.slice(-4)}</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* ── Fixed Bottom Navigation Dock ── */}
      <BottomNav />

      {cancelTarget && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#161224] border border-[#4C1D2C] rounded-3xl max-w-sm w-full p-6 shadow-2xl relative">
            <button
              onClick={() => !isCancellingSplit && setCancelTarget(null)}
              disabled={isCancellingSplit}
              className="absolute top-4 right-4 text-white/40 hover:text-white disabled:opacity-40"
              aria-label="Close cancellation dialog"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="w-11 h-11 rounded-full bg-red-500/15 border border-red-500/30 text-red-300 flex items-center justify-center mb-4">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-bold text-white">Cancel this split?</h3>
            <p className="text-sm text-white/60 mt-2">
              This will stop any new payments for <span className="text-white font-semibold">{cancelTarget.title}</span>.
            </p>
            <p className="text-xs text-amber-200/90 mt-3 rounded-xl bg-amber-500/10 border border-amber-500/20 p-3">
              Payments already made are not refunded automatically. This action cannot be undone.
            </p>

            {cancelError && (
              <p className="mt-3 rounded-xl bg-red-500/15 border border-red-500/30 p-3 text-xs text-red-200">
                {cancelError}
              </p>
            )}

            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                onClick={() => setCancelTarget(null)}
                disabled={isCancellingSplit}
                className="py-3 rounded-xl bg-[#0B0813] border border-[#2A2242] text-sm font-semibold text-white/75 hover:text-white disabled:opacity-50"
              >
                Keep split
              </button>
              <button
                onClick={confirmCancelSplit}
                disabled={isCancellingSplit}
                className="py-3 rounded-xl bg-red-500/85 hover:bg-red-500 text-sm font-bold text-white transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isCancellingSplit ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {isCancellingSplit ? "Cancelling..." : "Cancel split"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Send Modal ── */}
      {sendModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#161224] border border-[#2A2242] rounded-3xl max-w-sm w-full p-6 shadow-2xl relative">
            <button
              onClick={() => setSendModalOpen(false)}
              className="absolute top-4 right-4 text-white/40 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-lg font-bold text-white mb-1">Send Agora AUSD</h3>
            <p className="text-xs text-white/40 mb-4">
              Instant settlement on Monad rails
            </p>

            {sendSent ? (
              <div className="py-6 text-center space-y-3">
                <CheckCircle className="w-12 h-12 text-[#10B981] mx-auto animate-bounce" />
                <p className="text-base font-bold text-white">Transfer Confirmed!</p>
                <p className="text-xs text-white/50">Settled on Monad Testnet in &lt;1s</p>
                {sendIndexPending && sendTxHash && (
                  <div className="text-xs text-amber-300">
                    <p>Transfer confirmed, but JANUS history has not synced it. Do not send again.</p>
                    <button
                      onClick={async () => setSendIndexPending(!(await indexConfirmedTransfer(sendTxHash)))}
                      className="mt-2 underline"
                    >
                      Retry history sync
                    </button>
                  </div>
                )}

                {sendTxHash && (
                  <a
                    href={`https://testnet.monadscan.com/tx/${sendTxHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-[#836EF9] hover:underline font-mono"
                  >
                    <span>Tx: {sendTxHash.slice(0, 10)}…{sendTxHash.slice(-6)}</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}

                <button
                  onClick={() => {
                    setSendSent(false);
                    setSendModalOpen(false);
                    setSendTo("");
                    setSendAmount("");
                    setSendTxHash(null);
                    setSendIndexPending(false);
                  }}
                  className="mt-3 px-5 py-2 rounded-xl bg-[#0B0813] border border-[#2A2242] text-xs font-semibold text-white/80 hover:text-white"
                >
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={handleSendSubmit} className="space-y-4">
                {sendError && (
                  <div className="p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-xs text-red-300">
                    {sendError}
                  </div>
                )}
                <div>
                  <label className="text-xs text-white/50 uppercase tracking-wider block mb-1">
                    Recipient username or address
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="@alice or 0x..."
                    value={sendTo}
                    onChange={(e) => setSendTo(e.target.value)}
                    className="w-full bg-[#0B0813] border border-[#2A2242] rounded-xl px-3 py-2 text-sm text-white font-mono placeholder-white/20 focus:border-[#836EF9] outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-white/50 uppercase tracking-wider block mb-1">
                    Amount (AUSD)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    placeholder="0.00"
                    value={sendAmount}
                    onChange={(e) => setSendAmount(e.target.value)}
                    className="w-full bg-[#0B0813] border border-[#2A2242] rounded-xl px-3 py-2 text-lg font-bold text-white placeholder-white/20 focus:border-[#836EF9] outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSending}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#836EF9] to-[#A0055D] text-white font-bold text-sm shadow-[0_4px_24px_rgba(131,110,249,0.4)] hover:opacity-95 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isSending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Broadcasting on Monad…</span>
                    </>
                  ) : (
                    <span>Confirm Send on Monad</span>
                  )}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
