"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Inbox, Loader2, RefreshCw, Wallet } from "lucide-react";
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
      setPaymentsDue([]);
      setHasLoaded(false);
      setLoadError(null);
      return;
    }
    void refreshInbox();
  }, [authenticated, refreshInbox]);

  return (
    <main className="min-h-screen bg-[#0B0813] text-white px-5 pt-7 pb-28 max-w-md mx-auto">
      <header className="flex items-center gap-3.5 mb-6">
        <Link
          href="/"
          className="w-9 h-9 rounded-full bg-[#161224] border border-[#2A2242] flex items-center justify-center hover:border-[#836EF9]/50 transition-colors"
          aria-label="Back to vault"
        >
          <ArrowLeft className="w-4 h-4 text-white/80" />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-white tracking-tight">Inbox</h1>
          <p className="text-xs text-white/45 mt-0.5">Private payment requests for this wallet</p>
        </div>
        {authenticated && (
          <button
            onClick={() => void refreshInbox()}
            disabled={isLoading}
            className="w-9 h-9 rounded-full bg-[#161224] border border-[#2A2242] flex items-center justify-center text-[#A78BFA] hover:border-[#836EF9]/50 disabled:opacity-50"
            aria-label="Refresh inbox"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
          </button>
        )}
      </header>

      {!authenticated ? (
        <div className="bg-[#161224]/90 border border-[#2A2242] rounded-3xl p-7 text-center shadow-sm">
          <div className="w-12 h-12 rounded-full bg-[#836EF9]/15 text-[#836EF9] flex items-center justify-center mx-auto mb-3">
            <Wallet className="w-5 h-5" />
          </div>
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
        <div className="bg-[#161224]/90 border border-[#2A2242] rounded-3xl p-7 text-center shadow-sm">
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
        <div className="bg-[#161224]/90 border border-[#2A2242] rounded-3xl p-7 text-center shadow-sm">
          <div className="w-12 h-12 rounded-full bg-[#10B981]/15 text-[#10B981] flex items-center justify-center mx-auto mb-3">
            <Inbox className="w-5 h-5" />
          </div>
          <p className="text-sm font-bold text-white mb-1">Your inbox is clear</p>
          <p className="text-xs text-white/40">You have no pending split payments.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-1">
            <span className="px-1.5 py-0.5 rounded-full bg-[#F59E0B]/15 text-[#FBBF24] text-[10px] font-bold">
              {paymentsDue.length}
            </span>
            <span className="text-xs text-white/45">payment {paymentsDue.length === 1 ? "request" : "requests"}</span>
          </div>
          {paymentsDue.map((payment) => {
            const organizer = payment.organizerUsername
              ? `@${payment.organizerUsername}`
              : `${payment.creator.slice(0, 6)}...${payment.creator.slice(-4)}`;
            const fundedShares = Math.min(payment.settledCount, payment.numPayers);
            return (
              <div key={payment.splitId} className="p-4 rounded-2xl bg-[#161224]/90 border border-[#2A2242] shadow-sm">
                <h2 className="text-base font-bold text-white">{payment.title}</h2>
                <p className="text-sm text-white/70 mt-2">
                  You owe <span className="font-bold text-white">${payment.amountPerPerson} AUSD</span>
                </p>
                <p className="text-xs text-white/45 mt-1">Organizer: {organizer}</p>
                <p className="text-[11px] text-white/35 mt-2">{fundedShares} of {payment.numPayers} shares funded</p>
                <Link
                  href={`/pay/${payment.splitId}`}
                  className="mt-4 w-full py-3 rounded-xl bg-gradient-to-r from-[#836EF9] to-[#A0055D] text-sm font-bold text-white flex items-center justify-center hover:opacity-95 transition-opacity"
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
