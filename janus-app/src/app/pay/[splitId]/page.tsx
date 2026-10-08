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
  MON_GAS_REQUIRED_MESSAGE,
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
      if (!(await ensureGas(payerAddress))) throw new Error(MON_GAS_REQUIRED_MESSAGE);

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
        <h1 className="text-2xl font-semibold mb-2">Split unavailable</h1>
        <p className="text-white/60 text-sm mb-6">{splitLoadError || "Unable to load this split"}</p>
        <Link href="/wallet" className="px-5 py-2.5 rounded-lg border border-white/15 text-sm">
          Back to Wallet
        </Link>
      </main>
    );
  }

  if (payState === "settled") {
    return (
      <main className="min-h-screen bg-[#0B0813] text-white flex flex-col items-center justify-center px-5 max-w-md mx-auto text-center">
        <CheckCircle className="w-8 h-8 text-[#10B981] mb-5" />
        <h1 className="text-3xl font-semibold text-white mb-2">Payment settled</h1>
        <p className="text-white/60 text-sm mb-2">
          ${amount} AUSD transferred to {organizerDisplay}
        </p>
        <p className="text-white/40 text-xs mb-6">Confirmed payment</p>

        {txHash && (
          <a
            href={`https://testnet.monadscan.com/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[#AFA3FF] text-xs mb-8 hover:text-white"
          >
            <span>View transaction ↗</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}

        <Link
          href="/wallet"
          className="px-6 py-3 rounded-lg bg-[#836EF9] text-white text-sm font-semibold hover:bg-[#927fff] transition-colors"
        >
          Back to Wallet
        </Link>
      </main>
    );
  }

  if (payState === "sync_pending") {
    return (
      <main className="min-h-screen bg-[#0B0813] text-white flex flex-col items-center justify-center px-5 max-w-md mx-auto text-center">
        <CheckCircle className="w-8 h-8 text-[#10B981] mb-5" />
        <h1 className="text-2xl font-semibold mb-2">Payment confirmed</h1>
        <p className="text-white/65 text-sm mb-3">Your AUSD was sent. JANUS history has not synced this payment yet. Do not pay again.</p>
        <p className="text-amber-300 text-xs mb-5">{errorMsg}</p>
        {txHash && <a className="text-[#836EF9] text-xs mb-6" href={`https://testnet.monadscan.com/tx/${txHash}`} target="_blank" rel="noopener noreferrer">View transaction {txHash.slice(0, 12)}…</a>}
        <button onClick={retryPaymentIndex} disabled={isRetryingIndex} className="px-6 py-3 rounded-lg bg-[#836EF9] text-sm font-semibold disabled:opacity-50">
          {isRetryingIndex ? "Syncing…" : "Retry history sync"}
        </button>
      </main>
    );
  }

  // ── Rejected / Error State ────────────────────────────────────────────────

  if (payState === "rejected") {
    return (
      <main className="min-h-screen bg-[#0B0813] text-white flex flex-col items-center justify-center px-5 max-w-md mx-auto text-center">
        <AlertCircle className="w-8 h-8 text-red-300 mb-5" />
        <h1 className="text-2xl font-semibold text-white mb-2">Payment declined</h1>
        <p className="text-white/50 text-xs mb-8 max-w-xs">
          {errorMsg || "The bill settlement request could not be completed on Monad."}
        </p>
        <button
          onClick={() => setPayState("review")}
          className="px-6 py-3 rounded-lg border border-white/15 text-white text-sm font-semibold hover:border-white/30 transition-colors"
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
              Review payment
            </h1>
          </div>
          <JanusLogo size={32} showText={false} />
        </header>

        {/* ── Payer view subhead ── */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-white tracking-tight">
              Payment request
            </h2>
            <p className="text-xs text-white/40 font-mono mt-0.5">
              {payerAddress
                ? `${payerAddress.slice(0, 6)}…${payerAddress.slice(-4)}`
                : "Connect wallet to settle"}
            </p>
          </div>
          <span className="text-[10px] text-white/35">Testnet</span>
        </div>

        {/* ── Request Card ── */}
        <div className="mb-8 border-y border-white/10 py-6">
          <div className="text-left">
            <p className="text-white/45 text-xs mb-2">
              Requested by {organizerDisplay}
            </p>
            <p className="text-4xl font-semibold text-white tabular-nums tracking-tight mt-1">
              ${amount} <span className="text-lg font-normal text-white/50">AUSD</span>
            </p>
            <p className="text-sm text-white/60 mt-2">{memo}</p>
          </div>
        </div>

        <div className="my-6 grid grid-cols-2 gap-4 border-b border-white/10 pb-6 text-sm">
          <div><p className="text-xs text-white/40">Recipient</p><p className="mt-1 truncate text-white/80">{organizerDisplay}</p></div>
          <div><p className="text-xs text-white/40">Status</p><p className="mt-1 text-white/80">Ready to approve</p></div>
        </div>
      </div>

      {/* ── Action Buttons ── */}
      <div className="space-y-3 pt-4">
        {!authenticated ? (
          <button
            onClick={login}
            className="w-full py-3.5 rounded-lg bg-[#836EF9] text-white font-semibold text-sm hover:bg-[#927fff] transition-colors"
          >
            Connect Wallet to Pay
          </button>
        ) : !walletsReady || !payerAddress ? (
          <button
            onClick={handleWalletSetup}
            className="w-full py-3.5 rounded-lg bg-[#836EF9] text-white font-semibold text-sm hover:bg-[#927fff] transition-colors"
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
            className="w-full py-3.5 rounded-lg bg-[#836EF9] text-white font-semibold text-sm hover:bg-[#927fff] transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {payState === "scanning" ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Confirming payment…</span>
              </>
            ) : (
              <span>
                {payerAlreadySettled
                  ? "COVER ANOTHER SHARE"
                  : payerWallet?.walletClientType === "privy"
                      ? "Approve payment"
                    : "Approve payment"}
              </span>
            )}
          </button>
          </>
        )}

        <Link
          href="/wallet"
          className="w-full py-3 text-white/55 font-medium text-sm hover:text-white transition-colors block text-center"
        >
          Cancel
        </Link>
      </div>
    </main>
  );
}
