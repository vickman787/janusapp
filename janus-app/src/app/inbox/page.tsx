"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import { BottomNav } from "@/components/BottomNav";
import { PaymentDueItem, fetchPaymentsDue } from "@/lib/activityStore";

export default function InboxPage() {
  const { authenticated, login, user } = usePrivy();
  const activeAddress = user?.wallet?.address;
  const [paymentsDue, setPaymentsDue] = useState<PaymentDueItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refreshInbox = useCallback(async () => {
    if (!activeAddress) {
      setPaymentsDue([]);
      setHasLoaded(false);
      return;
    }
    setIsLoading(true);
    try {
      setPaymentsDue(await fetchPaymentsDue(activeAddress));
      setLoadError(null);
      setHasLoaded(true);
    } catch {
      setLoadError("Could not refresh your inbox. Your last confirmed requests are still shown.");
    } finally {
      setIsLoading(false);
    }
  }, [activeAddress]);

  useEffect(() => {
    if (!authenticated) {
      queueMicrotask(() => {
        setPaymentsDue([]);
        setHasLoaded(false);
        setLoadError(null);
      });
      return;
    }
    queueMicrotask(() => void refreshInbox());
  }, [authenticated, refreshInbox]);

  return (
    <main className="min-h-screen bg-[#0B0813] text-white px-5 pt-7 pb-28 max-w-md mx-auto">
      <header className="flex items-center gap-4 border-b border-white/10 pb-5 mb-7">
        <Link
          href="/wallet"
          className="inline-flex items-center gap-2 py-2 text-sm text-white/55 hover:text-white transition-colors"
          aria-label="Back to vault"
        >
          <ArrowLeft className="w-4 h-4 text-white/80" />
          <span>Wallet</span>
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-white tracking-tight">Inbox</h1>
          <p className="text-xs text-white/45 mt-0.5">Private payment requests for this wallet</p>
        </div>
        {authenticated && (
          <button
            onClick={() => void refreshInbox()}
            disabled={isLoading}
            className="p-2 text-white/45 hover:text-white disabled:opacity-50"
            aria-label="Refresh inbox"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
          </button>
        )}
      </header>

      {!authenticated ? (
        <div className="border-y border-white/10 py-8 text-center">
          <p className="text-sm font-bold text-white mb-1">Connect to view your inbox</p>
          <p className="text-xs text-white/40 mb-4">Payment requests are visible only to the invited wallet.</p>
          <button
            onClick={login}
            className="px-4 py-2 rounded-xl bg-[#836EF9] text-xs font-bold text-white hover:bg-[#9B8AFF] transition-colors"
          >
            Connect wallet
          </button>
        </div>
      ) : !hasLoaded ? (
        <div className="border-y border-white/10 py-8 text-center">
          {loadError ? (
            <>
              <p className="text-sm font-bold text-white mb-1">Could not load your inbox</p>
              <p className="text-xs text-white/45">Please try again in a moment.</p>
              <button onClick={() => void refreshInbox()} className="mt-4 px-4 py-2 rounded-xl bg-[#836EF9] text-xs font-bold">Try again</button>
            </>
          ) : (
            <>
              <Loader2 className="w-5 h-5 animate-spin text-[#836EF9] mx-auto mb-3" />
              <p className="text-sm text-white/60">Loading your payment requests...</p>
            </>
          )}
        </div>
      ) : paymentsDue.length === 0 ? (
        <div className="border-y border-white/10 py-8 text-center">
          <p className="text-sm font-bold text-white mb-1">Your inbox is clear</p>
          <p className="text-xs text-white/40">You have no pending split payments.</p>
        </div>
      ) : (
        <div className="divide-y divide-white/10 border-y border-white/10">
          <div className="flex items-center gap-2 px-1">
            <span className="text-xs text-white/45">{paymentsDue.length} payment {paymentsDue.length === 1 ? "request" : "requests"}</span>
          </div>
          {paymentsDue.map((payment) => {
            const organizer = payment.organizerUsername
              ? `@${payment.organizerUsername}`
              : `${payment.creator.slice(0, 6)}...${payment.creator.slice(-4)}`;
            const fundedShares = Math.min(payment.settledCount, payment.numPayers);
            return (
              <div key={payment.splitId} className="py-5">
                <h2 className="text-base font-semibold text-white">{payment.title}</h2>
                <p className="text-sm text-white/70 mt-2">
                  You owe <span className="font-bold text-white">${payment.amountPerPerson} AUSD</span>
                </p>
                <p className="text-xs text-white/45 mt-1">Organizer: {organizer}</p>
                <p className="text-[11px] text-white/35 mt-2">{fundedShares} of {payment.numPayers} shares funded</p>
                <Link
                  href={`/pay/${payment.splitId}`}
                  className="mt-4 inline-flex py-2 text-sm font-semibold text-[#AFA3FF] hover:text-white transition-colors"
                >
                  Pay now
                </Link>
              </div>
            );
          })}
        </div>
      )}

      {authenticated && hasLoaded && loadError && (
        <p className="mt-4 rounded-xl bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-100/90">
          {loadError}
        </p>
      )}

      <BottomNav />
    </main>
  );
}
