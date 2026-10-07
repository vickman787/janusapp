"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle,
  AlertCircle,
  ExternalLink,
  Loader2,
  Wallet,
} from "lucide-react";
import { JanusLogo } from "@/components/JanusLogo";
import {
  getAccessToken,
  usePrivy,
  useWallets,
} from "@privy-io/react-auth";
import {
  createWalletClient,
  custom,
  encodeFunctionData,
  formatUnits,
  isAddress,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import {
  AUSD_ADDRESS,
  ERC20_ABI,
  JANUS_SPLIT_ABI,
  JANUS_SPLIT_ADDRESS,
  JANUS_SPLIT_V2_ADDRESS,
  ensureGas,
  monadTestnet,
  publicClient,
} from "@/lib/web3";
import { saveLocalActivity } from "@/lib/activityStore";
import { describeError } from "@/lib/errors";

type PayState = "review" | "scanning" | "settled" | "sync_pending" | "rejected";

interface OnchainSplit {
  requester: Address;
  totalAmount: bigint;
  amountPerPayer: bigint;
  numPayers: bigint;
  settledCount: bigint;
  status: number;
  memo: string;
}

export default function PayPage() {
  const {
    authenticated,
    user,
    login,
    logout,
    connectWallet,
    createWallet,
  } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const routeParams = useParams();

  const splitId = (routeParams?.splitId as string) || "";

  const [payState, setPayState] = useState<PayState>("review");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [split, setSplit] = useState<OnchainSplit | null>(null);
  const [contractAddress, setContractAddress] = useState<Address>(JANUS_SPLIT_ADDRESS);
  const [isLoadingSplit, setIsLoadingSplit] = useState(true);
  const [splitLoadError, setSplitLoadError] = useState<string | null>(null);
  const [payerAlreadySettled, setPayerAlreadySettled] = useState(false);
  const [isRetryingIndex, setIsRetryingIndex] = useState(false);

  const linkedWalletAddress = user?.wallet?.address?.toLowerCase();
  const payerWallet =
    wallets.find(
      (wallet) => wallet.address.toLowerCase() === linkedWalletAddress
    ) || wallets[0];
  const payerAddress = payerWallet?.address;
  const amount = split ? formatUnits(split.amountPerPayer, 6) : "0";
  const memo = split?.memo || "Bill Settlement";
  const organizer = split?.requester || "";
  const organizerDisplay = organizer
    ? `${organizer.slice(0, 6)}…${organizer.slice(-4)}`
    : "Split Organizer";

  async function indexPayment(hash: string): Promise<void> {
    const response = await fetch("/api/splits/pay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ splitId, txHash: hash }),
    });
    const result = await response.json();
    if (!response.ok || !result.success || !result.verified || !result.split) {
      throw new Error(result.error || "Payment history has not synced yet");
    }
  }

  async function retryPaymentIndex() {
    if (!txHash || isRetryingIndex) return;
    setIsRetryingIndex(true);
    try {
      await indexPayment(txHash);
      setPayState("settled");
      setErrorMsg(null);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : "Payment history has not synced yet");
    } finally {
      setIsRetryingIndex(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadSplit() {
      setIsLoadingSplit(true);
      setSplitLoadError(null);

      try {
        if (!/^0x[0-9a-fA-F]{64}$/.test(splitId)) {
          throw new Error("Invalid split link");
        }

        // Resolve the contract that created this split. Existing rows use the
        // legacy fallback; new rows can safely use JanusSplitV2.
        let selectedContract = JANUS_SPLIT_ADDRESS;
        const metadataResponse = await fetch(`/api/splits?id=${encodeURIComponent(splitId)}`);
        if (metadataResponse.ok) {
          const metadata = await metadataResponse.json();
          if (metadata.split?.contractAddress && isAddress(metadata.split.contractAddress)) {
            selectedContract = metadata.split.contractAddress as Address;
          }
        }

        const result = (await publicClient.readContract({
          address: selectedContract,
          abi: JANUS_SPLIT_ABI,
          functionName: "getSplit",
          args: [splitId as `0x${string}`],
        })) as {
          requester: Address;
          totalAmount: bigint;
          amountPerPayer: bigint;
          numPayers: bigint;
          settledCount: bigint;
          status: number;
          memo: string;
        };

        const loaded: OnchainSplit = {
          requester: result.requester,
          totalAmount: result.totalAmount,
          amountPerPayer: result.amountPerPayer,
          numPayers: result.numPayers,
          settledCount: result.settledCount,
          status: Number(result.status),
          memo: result.memo,
        };

        if (loaded.requester.toLowerCase() === zeroAddress) {
          throw new Error("This split does not exist on-chain");
        }
        if (loaded.status === 1) throw new Error("This split is already settled");
        if (loaded.status === 2) throw new Error("This split was cancelled");

        let hasPaid = false;
        if (payerAddress) {
          hasPaid = await publicClient.readContract({
            address: selectedContract,
            abi: JANUS_SPLIT_ABI,
            functionName: "payerHasSettled",
            args: [splitId as `0x${string}`, payerAddress as Address],
          });
        }

        if (!cancelled) {
          setSplit(loaded);
          setContractAddress(selectedContract);
          setPayerAlreadySettled(hasPaid);
        }
      } catch (error) {
        if (!cancelled) {
          setSplit(null);
          setSplitLoadError(error instanceof Error ? error.message : "Unable to load this split");
        }
      } finally {
        if (!cancelled) setIsLoadingSplit(false);
      }
    }

    loadSplit();
    return () => {
      cancelled = true;
    };
  }, [payerAddress, splitId]);

  async function handleApprove(coverAnotherShare = false) {
    if (!authenticated || !payerWallet || !payerAddress) {
      login();
      return;
    }
    if (!split || splitLoadError || (payerAlreadySettled && !coverAnotherShare)) {
      setErrorMsg(payerAlreadySettled ? "This wallet has already paid this split" : "Split is not payable");
      setPayState("rejected");
      return;
    }
    if (coverAnotherShare && contractAddress.toLowerCase() !== JANUS_SPLIT_V2_ADDRESS.toLowerCase()) {
      setErrorMsg("Covering another share is only available for V2 splits");
      setPayState("rejected");
      return;
    }

    setPayState("scanning");
    setErrorMsg(null);

    try {
      // 1. Biometric passkey delay
      await new Promise((r) => setTimeout(r, 600));

      const amountBigInt = split.amountPerPayer;

      const accessToken = await getAccessToken();
      if (payerWallet.walletClientType === "privy" && !accessToken) {
        setPayState("review");
        await logout();
        login();
        return;
      }

      const connected = await payerWallet.isConnected();
      if (!connected) {
        throw new Error("Reconnect your wallet before paying this split");
      }
      await payerWallet.switchChain(10143);
      const walletProvider = await payerWallet.getEthereumProvider();
      const walletClient = createWalletClient({
        account: payerAddress as Address,
        chain: monadTestnet,
        transport: custom(walletProvider),
      });

      const sendFromPayer = (to: Address, data: Hex) =>
        walletClient.sendTransaction({
          account: payerAddress as Address,
          to,
          data,
        });

      const [nativeBalance, ausdBalance] = await Promise.all([
        publicClient.getBalance({ address: payerAddress as Address }),
        publicClient.readContract({
          address: AUSD_ADDRESS,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [payerAddress as Address],
        }),
      ]);
      if (nativeBalance === 0n) {
        throw new Error("This wallet has no MON on Monad Testnet for gas");
      }
      if (ausdBalance < amountBigInt) {
        throw new Error(
          `This wallet needs ${formatUnits(amountBigInt, 6)} AUSD to pay this split`
        );
      }

      // Ensure payer has MON for gas
      await ensureGas(payerAddress);

      // Encode transfer(recipient, amount) for AUSD
      const allowance = await publicClient.readContract({
        address: AUSD_ADDRESS,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [payerAddress as Address, contractAddress],
      });

      if (allowance < amountBigInt) {
        const approveData = encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "approve",
          args: [contractAddress, amountBigInt],
        });
        const approvalHash = await sendFromPayer(AUSD_ADDRESS, approveData);
        const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approvalHash });
        if (approvalReceipt.status !== "success") throw new Error("AUSD approval failed");
      }

      const callData = encodeFunctionData({
        abi: JANUS_SPLIT_ABI,
        functionName: coverAnotherShare ? "settleAdditionalShare" : "settleSplit",
        args: [splitId as `0x${string}`],
      });

      // 🌟 Signed & sent directly by the user's Privy wallet! 🌟
      const hash = await sendFromPayer(contractAddress, callData);

      setTxHash(hash);

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Settlement transaction reverted");

      // Save activity for payer
      saveLocalActivity(payerAddress, {
        id: hash,
        type: "split_paid",
        title: coverAnotherShare
          ? `Covered another share: ${memo || "Bill Split"}`
          : `Paid split: ${memo || "Bill Split"}`,
        amount: amount || "0",
        timestamp: Date.now(),
        date: "Just now",
        isPositive: false,
        txHash: hash,
        splitId,
        counterparty: organizer,
        status: "Settled",
      });

      // Chain settlement succeeded. A history error must never ask the user
      // to pay again; the same hash can be safely re-indexed.
      try {
        await indexPayment(hash);
        setPayState("settled");
      } catch (error) {
        setErrorMsg(error instanceof Error ? error.message : "Payment history has not synced yet");
        setPayState("sync_pending");
      }
    } catch (err) {
      console.error("Pay approval error:", err);
      if (
        err instanceof Error && err.message.toLowerCase().includes("valid access token")
      ) {
        await logout();
        login();
        setPayState("review");
        return;
      }
      setErrorMsg(describeError(err, "Payment cancelled or failed"));
      setPayState("rejected");
    }
  }

  async function handleWalletSetup() {
    try {
      await createWallet();
    } catch {
      connectWallet();
    }
  }

  // ── Settled State ─────────────────────────────────────────────────────────

  if (isLoadingSplit) {
    return (
      <main className="min-h-screen bg-[#0B0813] text-white flex items-center justify-center px-5">
        <div className="flex items-center gap-3 text-white/70">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Loading verified split details...</span>
        </div>
      </main>
    );
  }

  if (splitLoadError || !split) {
    return (
      <main className="min-h-screen bg-[#0B0813] text-white flex flex-col items-center justify-center px-5 text-center">
        <AlertCircle className="w-12 h-12 text-[#A0055D] mb-4" />
        <h1 className="text-2xl font-bold mb-2">Split unavailable</h1>
        <p className="text-white/60 text-sm mb-6">{splitLoadError || "Unable to load this split"}</p>
        <Link href="/" className="px-6 py-3 rounded-full bg-[#161224] border border-[#2A2242]">
          Back to Wallet
        </Link>
      </main>
    );
  }

  if (payState === "settled") {
    return (
      <main className="min-h-screen bg-[#0B0813] text-white flex flex-col items-center justify-center px-5 max-w-md mx-auto text-center">
        <div className="w-24 h-24 rounded-full bg-[#10B981]/15 border-2 border-[#10B981] flex items-center justify-center mb-6 shadow-[0_0_40px_rgba(16,185,129,0.5)]">
          <CheckCircle className="w-12 h-12 text-[#10B981]" />
        </div>
        <h1 className="text-3xl font-extrabold text-white mb-2">Payment Settled!</h1>
        <p className="text-white/60 text-sm mb-2">
          ${amount} AUSD transferred to {organizerDisplay}
        </p>
        <p className="text-[#836EF9] text-xs font-semibold mb-6 uppercase tracking-wider">
          Monad Testnet · Sub-second Finality
        </p>

        {txHash && (
          <a
            href={`https://testnet.monadscan.com/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[#836EF9] text-xs font-mono underline underline-offset-4 mb-8 truncate max-w-xs block hover:text-white"
          >
            <span>Tx: {txHash.slice(0, 14)}…{txHash.slice(-8)}</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}

        <Link
          href="/"
          className="px-8 py-3.5 rounded-full bg-[#161224] border border-[#2A2242] text-white text-sm font-semibold hover:border-[#836EF9]/50 transition-colors shadow-sm"
        >
          Back to Wallet
        </Link>
      </main>
    );
  }

  if (payState === "sync_pending") {
    return (
      <main className="min-h-screen bg-[#0B0813] text-white flex flex-col items-center justify-center px-5 max-w-md mx-auto text-center">
        <CheckCircle className="w-16 h-16 text-[#10B981] mb-5" />
        <h1 className="text-2xl font-bold mb-2">Payment confirmed on Monad</h1>
        <p className="text-white/65 text-sm mb-3">Your AUSD was sent. JANUS history has not synced this payment yet. Do not pay again.</p>
        <p className="text-amber-300 text-xs mb-5">{errorMsg}</p>
        {txHash && <a className="text-[#836EF9] text-xs mb-6" href={`https://testnet.monadscan.com/tx/${txHash}`} target="_blank" rel="noopener noreferrer">View transaction {txHash.slice(0, 12)}…</a>}
        <button onClick={retryPaymentIndex} disabled={isRetryingIndex} className="px-8 py-3 rounded-full bg-[#836EF9] text-sm font-semibold disabled:opacity-50">
          {isRetryingIndex ? "Syncing…" : "Retry history sync"}
        </button>
      </main>
    );
  }

  // ── Rejected / Error State ────────────────────────────────────────────────

  if (payState === "rejected") {
    return (
      <main className="min-h-screen bg-[#0B0813] text-white flex flex-col items-center justify-center px-5 max-w-md mx-auto text-center">
        <div className="w-20 h-20 rounded-full bg-[#A0055D]/15 border-2 border-[#A0055D] flex items-center justify-center mb-6">
          <AlertCircle className="w-10 h-10 text-[#A0055D]" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">Payment Declined</h1>
        <p className="text-white/50 text-xs mb-8 max-w-xs">
          {errorMsg || "The bill settlement request could not be completed on Monad."}
        </p>
        <button
          onClick={() => setPayState("review")}
          className="px-8 py-3 rounded-full bg-[#161224] border border-[#2A2242] text-white text-sm font-semibold hover:border-[#836EF9]/50 transition-colors"
        >
          Try Again
        </button>
      </main>
    );
  }

  // ── Review State ─────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-[#0B0813] text-white px-5 pt-7 pb-10 max-w-md mx-auto relative flex flex-col justify-between">
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
              Payment Approval
            </h1>
          </div>
          <JanusLogo size={32} showText={false} />
        </header>

        {/* ── Payer view subhead ── */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-white tracking-tight">
              Payer View
            </h2>
            <p className="text-xs text-white/40 font-mono mt-0.5">
              {payerAddress
                ? `${payerAddress.slice(0, 6)}…${payerAddress.slice(-4)}`
                : "Connect wallet to settle"}
            </p>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#836EF9]/10 border border-[#836EF9]/30 text-[10px] font-semibold text-[#836EF9]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse" />
            <span>Monad Testnet</span>
          </div>
        </div>

        {/* ── Request Card ── */}
        <div className="relative pt-6 mb-8">
          {/* Organizer Avatar Badge */}
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 z-10 w-12 h-12 rounded-full p-[2px] bg-gradient-to-tr from-[#836EF9] to-[#F472B6] shadow-[0_0_16px_rgba(131,110,249,0.5)]">
            <div className="w-full h-full rounded-full bg-[#161224] flex items-center justify-center text-sm font-bold text-white">
              <Wallet className="w-5 h-5 text-[#836EF9]" />
            </div>
          </div>

          <div className="bg-[#161224]/90 border border-[#2A2242] rounded-3xl pt-8 pb-6 px-6 text-center shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
            <p className="text-white/40 text-[10px] font-semibold uppercase tracking-[0.2em] mb-1">
              REQUEST FROM {organizerDisplay}:
            </p>
            <p className="text-4xl font-extrabold text-white tabular-nums tracking-tight mt-1">
              ${amount} <span className="text-lg font-normal text-white/50">AUSD</span>
            </p>
            <p className="text-xs text-white/60 font-medium mt-1">{memo}</p>
          </div>
        </div>

        {/* ── FaceID Concentric Radar Scanner ── */}
        <div className="flex flex-col items-center justify-center my-6">
          <div className="relative flex items-center justify-center w-44 h-44">
            {/* Outer Concentric Radar Glow Rings */}
            <div className="absolute inset-0 rounded-full border border-[#10B981]/20 bg-gradient-to-b from-[#10B981]/10 to-transparent blur-[1px]" />
            <div className="absolute inset-4 rounded-full border border-[#10B981]/30 bg-[#10B981]/5" />
            <div className="absolute inset-8 rounded-full border border-[#10B981]/40 bg-[#10B981]/10 shadow-[0_0_32px_rgba(16,185,129,0.25)]" />

            {/* Scanning pulse effect */}
            {payState === "scanning" && (
              <div className="absolute inset-2 rounded-full border-2 border-[#10B981] animate-ping opacity-60" />
            )}

            {/* Glowing FaceID Smiling Face Icon Vector */}
            <div className="relative z-10 flex flex-col items-center justify-center text-[#10B981]">
              <svg
                viewBox="0 0 100 100"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="w-20 h-20"
              >
                <path
                  d="M20 34 V22 H32"
                  stroke="#10B981"
                  strokeWidth="5"
                  strokeLinecap="round"
                />
                <path
                  d="M80 34 V22 H68"
                  stroke="#10B981"
                  strokeWidth="5"
                  strokeLinecap="round"
                />
                <path
                  d="M20 66 V78 H32"
                  stroke="#10B981"
                  strokeWidth="5"
                  strokeLinecap="round"
                />
                <path
                  d="M80 66 V78 H68"
                  stroke="#10B981"
                  strokeWidth="5"
                  strokeLinecap="round"
                />

                <path
                  d="M38 42 C40 38 46 38 48 42"
                  stroke="#10B981"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
                <path
                  d="M52 42 C54 38 60 38 62 42"
                  stroke="#10B981"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
                <path
                  d="M50 46 V56"
                  stroke="#10B981"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                />
                <path
                  d="M38 64 C44 72 56 72 62 64"
                  stroke="#10B981"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* ── Action Buttons ── */}
      <div className="space-y-3 pt-4">
        {!authenticated ? (
          <button
            onClick={login}
            className="w-full py-4 rounded-full bg-gradient-to-r from-[#836EF9] to-[#A0055D] text-white font-extrabold text-sm tracking-wider uppercase shadow-[0_0_32px_rgba(131,110,249,0.45)] hover:opacity-95 active:scale-[0.98] transition-all"
          >
            Connect Wallet to Pay
          </button>
        ) : !walletsReady || !payerAddress ? (
          <button
            onClick={handleWalletSetup}
            className="w-full py-4 rounded-full bg-gradient-to-r from-[#836EF9] to-[#A0055D] text-white font-extrabold text-sm tracking-wider uppercase shadow-[0_0_32px_rgba(131,110,249,0.45)] hover:opacity-95 active:scale-[0.98] transition-all"
          >
            Set Up Wallet to Pay
          </button>
        ) : (
          <>
          {payerAlreadySettled && (
            <p className="rounded-xl border border-[#F59E0B]/30 bg-[#F59E0B]/10 px-3 py-2 text-center text-xs text-[#FCD34D]">
              This wallet already paid one share. You can optionally cover another unpaid share.
            </p>
          )}
          <button
            onClick={() => handleApprove(Boolean(payerAlreadySettled))}
            disabled={payState === "scanning" || (payerAlreadySettled && !JANUS_SPLIT_V2_ADDRESS)}
            className="w-full py-4 rounded-full bg-[#10B981] text-black font-extrabold text-sm tracking-wider uppercase shadow-[0_0_32px_rgba(16,185,129,0.45)] hover:bg-[#34D399] active:scale-[0.98] transition-all disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {payState === "scanning" ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-black" />
                <span>Settling on Monad…</span>
              </>
            ) : (
              <span>
                {payerAlreadySettled
                  ? "COVER ANOTHER SHARE"
                  : payerWallet?.walletClientType === "privy"
                    ? "APPROVE WITH FACEID"
                    : "APPROVE PAYMENT"}
              </span>
            )}
          </button>
          </>
        )}

        <Link
          href="/"
          className="w-full py-3.5 rounded-full bg-[#161224]/80 border border-[#2A2242] text-white/80 font-bold text-xs tracking-wider uppercase hover:border-white/30 hover:text-white transition-colors block text-center"
        >
          Cancel
        </Link>
      </div>
    </main>
  );
}
