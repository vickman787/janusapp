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
import { ThemeToggle } from "@/components/ThemeToggle";
import { usePrivy, useSendTransaction } from "@privy-io/react-auth";
import { encodeFunctionData, isAddress, parseUnits } from "viem";
import { describeError } from "@/lib/errors";
import {
  fetchOnchainAusdBalance,
  AUSD_ADDRESS,
  AGORA_FAUCET_ABI,
  AGORA_FAUCET_ADDRESS,
  JANUS_SPLIT_ADDRESS,
  ensureGas,
  MON_GAS_REQUIRED_MESSAGE,
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
  const { login, logout, authenticated, user } = usePrivy();
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
  const [faucetErrorMsg, setFaucetErrorMsg] = useState<string | null>(null);

  // Address copy state
  const [copied, setCopied] = useState(false);

  async function handleDisconnect() {
    try {
      await logout();
    } finally {
      window.location.replace("/");
    }
  }

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
  const [profileLoadError, setProfileLoadError] = useState(false);

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
      if (!res.ok) {
        setProfileLoadError(true);
        return;
      }
      if (data.profile?.username) {
        setProfileUsername(data.profile.username);
        setProfileLoadError(false);
      } else if (!localStorage.getItem(dismissedKey)) {
        setShowUsernamePrompt(true);
      }
    })().catch(() => setProfileLoadError(true));
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

            const reconciledStatus =
              onchain.status === 1
                ? "Settled"
                : onchain.status === 2
                  ? "Cancelled"
                  : "Active";
            const reconciledCount = Number(onchain.settledCount);

            if (
              split.txHash &&
              (split.status !== reconciledStatus || split.settledCount !== reconciledCount)
            ) {
              try {
                await fetch("/api/splits", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    splitId: split.splitId,
                    txHash: split.txHash,
                    participants: split.participants || [],
                  }),
                });
              } catch (error) {
                console.warn("Failed to reconcile split history:", error);
              }
            }

            return {
              ...split,
              status: reconciledStatus,
              settledCount: reconciledCount,
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
      // Older browser-cached splits may have confirmed on-chain while their
      // initial Supabase write failed. Re-index the verified creation receipt
      // first so payment receipts always have a parent split row.
      if (split.txHash) {
        const splitResponse = await fetch("/api/splits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            splitId: split.splitId,
            txHash: split.txHash,
            participants: split.participants || [],
          }),
        });
        const splitResult = await splitResponse.json();
        if (!splitResponse.ok || !splitResult.success || !splitResult.verified) {
          throw new Error(splitResult.error || "Could not sync this split");
        }
      }

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

      if (!(await ensureGas(activeAddress))) throw new Error(MON_GAS_REQUIRED_MESSAGE);
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

  // 3. Faucet claim: the connected wallet signs the faucet request directly.
  async function handleClaimFaucet() {
    if (!authenticated || !activeAddress) {
      login();
      return;
    }
    if (isClaimingFaucet) return;
    setIsClaimingFaucet(true);
    setFaucetSuccessMsg(null);
    setFaucetErrorMsg(null);

    try {
      if (!(await ensureGas(activeAddress))) {
        setFaucetErrorMsg(MON_GAS_REQUIRED_MESSAGE);
        return;
      }

      const callData = encodeFunctionData({
        abi: AGORA_FAUCET_ABI,
        functionName: "requestFunds",
        args: [activeAddress as `0x${string}`] as const,
      });
      const { hash } = await sendTransaction(
        { to: AGORA_FAUCET_ADDRESS, data: callData, chainId: 10143 },
        { address: activeAddress }
      );
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("AUSD faucet claim reverted");

      setFaucetSuccessMsg("+10,000 AUSD Dripped!");
      saveLocalActivity(activeAddress, {
        id: hash,
        type: "faucet",
        title: "Agora AUSD Faucet Drip",
        amount: "10000.00",
        timestamp: Date.now(),
        date: "Just now",
        isPositive: true,
        txHash: hash,
        status: "Confirmed",
      });
      await Promise.all([refreshBalance(), refreshActivity()]);
      setTimeout(() => setFaucetSuccessMsg(null), 5000);
    } catch (err) {
      console.error("Faucet error:", err);
      setFaucetErrorMsg(err instanceof Error ? err.message : "AUSD faucet claim failed");
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
      if (!(await ensureGas(activeAddress))) throw new Error(MON_GAS_REQUIRED_MESSAGE);

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

  return (
    <main className="relative mx-auto flex min-h-screen max-w-xl flex-col justify-between bg-[#0B0813] px-4 pb-40 pt-5 text-white min-[380px]:px-5 sm:px-8 sm:pt-6">
      {showUsernamePrompt && (
        <div className="fixed inset-0 z-[100] bg-[#0B0813]/80 backdrop-blur-sm flex items-center justify-center p-5">
          <div className="w-full max-w-sm rounded-xl border border-white/15 bg-[#13101D] p-6">
            <p className="mb-2 text-xs font-medium text-[#A78BFA]">Make JANUS yours</p>
            <h2 className="mb-2 text-2xl font-semibold text-white">Choose a username</h2>
            <p className="text-sm text-white/55 mb-5">Use a simple name like <span className="text-[#A78BFA]">@alice</span> when inviting friends or sending AUSD.</p>
            <div className="flex gap-2">
              <Link href="/settings" onClick={() => setShowUsernamePrompt(false)} className="flex-1 rounded-lg bg-[#836EF9] py-3 text-center font-semibold text-white">Create username</Link>
              <button onClick={dismissUsernamePrompt} className="flex-1 border-b border-white/20 py-3 font-medium text-white/65">Maybe later</button>
            </div>
          </div>
        </div>
      )}
      <div>
        {/* ── Top Header Navigation Bar ── */}
        <header className="mb-8 flex items-center justify-between gap-3 border-b border-white/10 pb-5 sm:mb-10 sm:pb-6">
          <Link href="/" aria-label="Back to JANUS home" className="min-w-0 shrink hover:opacity-95 transition-opacity">
            <JanusLogo size={34} showText={true} />
          </Link>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            {/* Privy Auth Button / Status */}
            {!authenticated ? (
              <button
                onClick={login}
                className="flex shrink-0 items-center gap-2 rounded-lg bg-[#836EF9] px-3 py-2.5 text-xs font-semibold text-white transition-all hover:bg-[#927fff] active:scale-95 sm:px-4"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span className="sm:hidden">Sign in</span>
                <span className="hidden sm:inline">Connect / Sign In</span>
              </button>
            ) : (
              <div className="flex items-center gap-2">
              <Link
                href="/settings"
                className="flex items-center gap-2 py-1.5 px-3 rounded-lg bg-[#161224]/80 border border-white/10 hover:border-[#836EF9]/50 transition-colors shadow-sm"
              >
                <div className="w-6 h-6 rounded-md bg-[#836EF9]/20 flex items-center justify-center text-[10px] font-bold text-[#C5BCFF]">
                  <Wallet className="w-3 h-3 text-white" />
                </div>
                <span className="text-xs font-mono font-medium text-white/90">
                  {profileUsername ? `@${profileUsername}` : shortenedAddress}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-white/50" />
              </Link>
              <button
                onClick={handleDisconnect}
                className="p-2 rounded-lg bg-[#161224]/80 border border-white/10 hover:border-red-500/50 hover:text-red-400 text-white/50 transition-colors"
                title="Disconnect"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
              </div>
            )}
          </div>
        </header>

        {profileLoadError && authenticated && activeAddress && (
          <p className="-mt-6 mb-6 text-xs text-amber-200/80">
            Your username could not be loaded right now. Your profile has not been changed.
          </p>
        )}

        {/* ── Heading ── */}
        <div className="mb-5 flex items-end justify-between gap-4">
          <div><p className="mb-1 text-sm text-white/45">Personal account</p><h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Wallet</h1></div>
          <p className="pb-1 text-[11px] text-white/40">Testnet</p>
        </div>

        {/* ── Balance Card (Live On-Chain Agora AUSD Balance) ── */}
        <div className="mb-4 border-y border-white/10 py-7 text-left sm:py-8">
          <p className="mb-2 text-sm text-white/45">Available balance</p>

          <p className="min-h-[48px] flex items-center text-5xl font-semibold text-white tabular-nums tracking-tight">
            {!authenticated ? (
              <span className="text-white/30 text-3xl font-medium">$0.00</span>
            ) : (
              `$${balance}`
            )}
          </p>

          {/* If authenticated: display the active wallet address. Account controls live in the header. */}
          {authenticated && activeAddress ? (
            <div className="mt-5 border-t border-white/10 pt-4">
              <button
                onClick={handleCopyAddress}
                className="flex items-center gap-1.5 text-[11px] font-mono text-white/55 transition-colors hover:text-white"
                title="Click to copy full address"
              >
                <span>{shortenedAddress}</span>
                {copied ? (
                  <Check className="w-3 h-3 text-[#10B981]" />
                ) : (
                  <Copy className="w-3 h-3 text-white/40" />
                )}
              </button>
            </div>
          ) : (
            <div className="mt-4 border-t border-[#2A2242]/70 pt-3 text-center">
              <p className="text-[11px] text-white/40">Sign in from the header to see your balance and payments</p>
            </div>
          )}
        </div>

        {/* ── Faucet Drip Helper Banner (Claim Testnet AUSD) ── */}
        <div className="mb-8 flex items-center justify-between gap-4 border-b border-white/10 py-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-white">
              Test balance
            </p>
            <p className="mt-0.5 text-[10px] text-white/50">
              Claim 10,000 Agora AUSD to your address
            </p>
          </div>

          <button
            onClick={handleClaimFaucet}
            disabled={isClaimingFaucet}
            className="flex items-center gap-1.5 text-xs font-semibold text-[#A78BFA] transition-colors hover:text-white disabled:opacity-50"
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
        {faucetErrorMsg && (
          <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-amber-300">
            <span>{faucetErrorMsg}</span>
            {faucetErrorMsg === MON_GAS_REQUIRED_MESSAGE && (
              <a
                href="https://faucet.monad.xyz"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-[#A78BFA] underline underline-offset-2 hover:text-white"
              >
                Get testnet MON ↗
              </a>
            )}
          </div>
        )}

        {/* ── Quick Actions (SEND & SPLIT A BILL) ── */}
        <div className="mb-9">
          <h2 className="mb-3 text-sm font-semibold text-white">Actions</h2>
          <div className="grid grid-cols-2 border-y border-white/10 sm:max-w-[520px]">
            {/* SEND AUSD */}
            <button
              onClick={() => {
                if (!authenticated) {
                  login();
                } else {
                  setSendModalOpen(true);
                }
              }}
              className="group flex items-center gap-3 border-r border-white/10 py-4 pr-4 text-left transition-colors hover:bg-white/[0.02]"
            >
              <div className="flex h-8 w-8 items-center justify-center text-[#A78BFA]">
                <Send className="w-4 h-4 text-[#836EF9] rotate-[-25deg]" />
              </div>
              <span className="text-xs font-semibold text-white/85">
                Send
              </span>
            </button>

            <Link
              href="/split"
              className="group flex items-center gap-3 py-4 pl-4 text-left transition-colors hover:bg-white/[0.02]"
            >
              <div className="flex h-8 w-8 items-center justify-center text-[#A78BFA]">
                <Split className="w-4 h-4 text-[#836EF9]" />
              </div>
              <span className="text-xs font-semibold text-white/85">Split a bill</span>
            </Link>
          </div>
        </div>

        {/* ── Active Bill Splits (Created by or Involving User) ── */}
        {authenticated && paymentsDue.length > 0 && (
          <section className="mb-6">
            <div className="mb-2 flex items-end justify-between">
              <div>
                  <h2 className="text-sm font-semibold text-white">
                  Payments Due
                </h2>
                <p className="mt-1 text-xs text-white/40">{paymentsDue.length} {paymentsDue.length === 1 ? "request" : "requests"}</p>
              </div>
              <span className="text-[11px] text-white/35">
                Private to you
              </span>
            </div>

            <div className="divide-y divide-white/10 border-y border-white/10">
              {paymentsDue.map((payment) => {
                const organizer = payment.organizerUsername
                  ? `@${payment.organizerUsername}`
                  : `${payment.creator.slice(0, 6)}...${payment.creator.slice(-4)}`;
                const fundedShares = Math.min(payment.settledCount, payment.numPayers);

                return (
                  <div key={payment.splitId} className="py-4">
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
                        className="shrink-0 py-2 text-xs font-semibold text-[#A78BFA] transition-colors hover:text-white"
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
            <div className="mb-2 flex items-end justify-between">
              <div>
                <h2 className="text-sm font-semibold text-white/90 tracking-wide">
                  Bill Splits
                </h2>
                <p className="mt-1 text-xs text-white/40">{splits.length} {splits.length === 1 ? "split" : "splits"}</p>
              </div>
              <Link
                href="/split/new"
                className="text-xs text-[#836EF9] hover:text-[#A78BFA] font-medium transition-colors"
              >
                + New Split
              </Link>
            </div>

            <div className="divide-y divide-white/10 border-y border-white/10">
              {splits.map((s) => {
                const isCopied = copiedSplitId === s.splitId;
                const paidAddresses = new Set((s.payers || []).map((payer) => payer.address.toLowerCase()));
                const expectedParticipants = s.participants || [];
                const fundedShares = Math.min(s.settledCount ?? s.payers?.length ?? 0, s.numPayers);
                const indexedPaymentHashes = new Set((s.payers || []).map((payer) => payer.txHash.toLowerCase()));
                const availableMissingReceipts = activity.filter((item) =>
                  item.type === "received" &&
                  item.splitId?.toLowerCase() === s.splitId.toLowerCase() &&
                  item.txHash &&
                  !indexedPaymentHashes.has(item.txHash.toLowerCase())
                ).length;
                const unindexedShares = Math.min(
                  Math.max(0, fundedShares - (s.payers?.length ?? 0)),
                  availableMissingReceipts
                );
                const payerCounts = new Map<string, number>();
                const payerUsernames = new Map<string, string>();
                for (const payer of s.payers || []) {
                  const key = payer.address.toLowerCase();
                  payerCounts.set(key, (payerCounts.get(key) || 0) + 1);
                  if (payer.username) payerUsernames.set(key, payer.username);
                }
                return (
                  <div key={s.splitId} className="py-4">
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
                      <span className={`text-xs font-medium ${s.status === "Settled" ? "text-[#10B981]" : s.status === "Cancelled" ? "text-white/35" : "text-[#A78BFA]"}`}>
                        {s.status}
                      </span>
                    </div>

                    {(s.payers?.length ?? 0) > 0 && (
                      <div className="mt-3 border-l border-white/15 pl-3 text-[11px] text-white/55">
                        <span className="text-white/80">Paid by:</span>{" "}
                        {Array.from(payerCounts.entries()).map(([address, count], index) => (
                          <span key={address}>
                            {index > 0 ? ", " : ""}
                            {payerUsernames.has(address)
                              ? `@${payerUsernames.get(address)}`
                              : expectedParticipants.find((participant) => participant.address.toLowerCase() === address)?.name || `${address.slice(0, 6)}…${address.slice(-4)}`}
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
                      <div className="mt-3 border-l border-white/15 pl-3 text-[11px] text-white/55">
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
                            className="inline-flex items-center gap-1 text-[11px] text-white/40 hover:text-[#836EF9] transition-colors"
                        >
                          <span>View transaction ↗</span>
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
                          className="flex items-center gap-1 py-1 text-xs font-medium text-[#A78BFA] transition-colors hover:text-white"
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
            <h2 className="text-sm font-semibold text-white tracking-wide">
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
            <div className="border-y border-white/10 py-8 text-center">
              <p className="text-sm font-bold text-white mb-1">
                Your payment history will appear here
              </p>
              <p className="mx-auto max-w-xs text-xs text-white/40">
                Sign in from the header to see transfers, payments, and split activity.
              </p>
            </div>
          ) : activity.length === 0 ? (
            <div className="border-y border-white/10 py-8 text-center">
              <p className="text-sm font-bold text-white mb-1">
                No activity yet
              </p>
              <p className="text-xs text-white/40 max-w-xs mx-auto mb-4">
                Send money or create a split to get started.
              </p>
              <Link
                href="/split/new"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#836EF9] text-white text-xs font-semibold hover:bg-[#927fff] transition-colors"
              >
                Create Split
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-white/10">
              {activity.map((rawItem) => {
                const item = resolveActivityForViewer(rawItem, activeAddress || "");
                const isIncoming = item.direction === "received" || item.direction === "faucet";

                return (
                  <div
                    key={rawItem.id}
                    className="flex flex-col gap-2 py-4 transition-colors hover:bg-white/[0.02]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div
                          className={`flex h-5 w-5 shrink-0 items-center justify-center ${
                            isIncoming
                              ? "text-[#10B981]"
                              : item.direction === "sent"
                              ? "text-white/45"
                              : "text-[#A78BFA]"
                          }`}
                        >
                          {item.direction === "faucet" ? (
                            <ArrowDownLeft className="h-4 w-4 stroke-[2]" />
                          ) : item.direction === "received" ? (
                            <ArrowDownLeft className="h-4 w-4 stroke-[2]" />
                          ) : item.direction === "sent" ? (
                            <ArrowUpRight className="h-4 w-4 stroke-[2]" />
                          ) : item.direction === "split_paid" ? (
                            <CheckCircle className="h-4 w-4 stroke-[2]" />
                          ) : (
                            <Users className="h-4 w-4" />
                          )}
                        </div>

                        <div className="min-w-0">
                          <p className="min-w-0 truncate text-sm font-medium text-white">{item.title}</p>

                          <p className="mt-1 text-xs text-white/40">
                            {item.actionText}
                          </p>
                        </div>
                      </div>

                      <div className="w-28 shrink-0 text-right">
                        <p
                          className={`text-lg font-semibold tabular-nums tracking-tight ${
                            isIncoming ? "text-[#10B981]" : "text-white/95"
                          }`}
                        >
                          {item.amountDisplay}
                        </p>
                        <p className="text-[10px] text-white/35">AUSD</p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pl-8 text-[11px] text-white/35">
                      <span>{item.date}</span>
                      {item.txHash && (
                        <a
                          href={`https://testnet.monadscan.com/tx/${item.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[#A78BFA] hover:underline"
                        >
                          <span>View transaction ↗</span>
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
          <div className="relative w-full max-w-sm rounded-xl border border-[#4C1D2C] bg-[#13101D] p-6">
            <button
              onClick={() => !isCancellingSplit && setCancelTarget(null)}
              disabled={isCancellingSplit}
              className="absolute top-4 right-4 text-white/40 hover:text-white disabled:opacity-40"
              aria-label="Close cancellation dialog"
            >
              <X className="w-5 h-5" />
            </button>

            <AlertTriangle className="mb-4 h-5 w-5 text-red-300" />
            <h3 className="text-lg font-bold text-white">Cancel this split?</h3>
            <p className="text-sm text-white/60 mt-2">
              This will stop any new payments for <span className="text-white font-semibold">{cancelTarget.title}</span>.
            </p>
            <p className="mt-3 border-l-2 border-amber-400/50 pl-3 text-xs text-amber-200/90">
              Payments already made are not refunded automatically. This action cannot be undone.
            </p>

            {cancelError && (
              <p className="mt-3 border-l-2 border-red-400/60 pl-3 text-xs text-red-200">
                {cancelError}
              </p>
            )}

            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                onClick={() => setCancelTarget(null)}
                disabled={isCancellingSplit}
                className="border-b border-white/20 py-3 text-sm font-semibold text-white/70 hover:text-white disabled:opacity-50"
              >
                Keep split
              </button>
              <button
                onClick={confirmCancelSplit}
                disabled={isCancellingSplit}
                className="flex items-center justify-center gap-2 rounded-lg bg-red-500/85 py-3 text-sm font-semibold text-white transition-colors hover:bg-red-500 disabled:opacity-50"
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
          <div className="relative w-full max-w-sm rounded-xl border border-white/15 bg-[#13101D] p-6">
            <button
              onClick={() => setSendModalOpen(false)}
              className="absolute top-4 right-4 text-white/40 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="mb-1 text-lg font-semibold text-white">Send AUSD</h3>
            <p className="mb-4 text-xs text-white/40">Review the recipient and amount before confirming.</p>

            {sendSent ? (
              <div className="py-6 text-center space-y-3">
                <CheckCircle className="w-10 h-10 text-[#10B981] mx-auto" />
                <p className="text-base font-semibold text-white">Payment sent</p>
                <p className="text-xs text-white/50">The payment has been confirmed.</p>
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
                    className="inline-flex items-center gap-1.5 text-xs text-[#A78BFA] hover:underline"
                  >
                    <span>View transaction ↗</span>
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
                  <div className="border-l-2 border-red-400/60 pl-3 text-xs text-red-300">
                    {sendError}
                  </div>
                )}
                <div>
                  <label className="mb-1 block text-xs text-white/50">
                    Recipient username or address
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="@alice or 0x..."
                    value={sendTo}
                    onChange={(e) => setSendTo(e.target.value)}
                    className="w-full border-b border-white/15 bg-transparent px-0 py-3 text-sm text-white outline-none placeholder:text-white/20 focus:border-[#836EF9]"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/50">
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
                    className="w-full border-b border-white/15 bg-transparent px-0 py-3 text-2xl font-semibold text-white outline-none placeholder:text-white/20 focus:border-[#836EF9]"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSending}
                  className="w-full py-3 rounded-lg bg-[#836EF9] text-white font-semibold text-sm hover:bg-[#927fff] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isSending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Confirming payment…</span>
                    </>
                  ) : (
                    <span>Send payment</span>
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
