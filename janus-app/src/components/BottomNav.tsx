"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wallet, Activity, Inbox, Users, Settings } from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import { fetchPaymentsDue } from "@/lib/activityStore";

export function BottomNav() {
  const pathname = usePathname();
  const { authenticated, user } = usePrivy();
  const activeAddress = user?.wallet?.address;
  const [pendingCount, setPendingCount] = useState(0);
  const [currentHash, setCurrentHash] = useState("");

  useEffect(() => {
    const syncHash = () => setCurrentHash(window.location.hash);
    queueMicrotask(syncHash);
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, [pathname]);

  const refreshInboxCount = useCallback(async () => {
    if (!activeAddress) {
      setPendingCount(0);
      return;
    }
    try {
      const pending = await fetchPaymentsDue(activeAddress);
      setPendingCount(pending.length);
    } catch (error) {
      // Retain the last known badge count during a temporary failed refresh.
      console.warn("Failed to refresh inbox badge:", error);
    }
  }, [activeAddress]);

  useEffect(() => {
    if (!authenticated || !activeAddress) {
      queueMicrotask(() => setPendingCount(0));
      return;
    }

    queueMicrotask(() => void refreshInboxCount());
    const onFocus = () => void refreshInboxCount();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refreshInboxCount();
    };
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshInboxCount();
    }, 120000);

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [authenticated, activeAddress, refreshInboxCount]);

  const navItems = [
    { label: "Wallet", href: "/wallet", icon: Wallet },
    { label: "Activity", href: "/wallet#activity", icon: Activity },
    { label: "Inbox", href: "/inbox", icon: Inbox },
    { label: "Groups", href: "/groups", icon: Users },
    { label: "Settings", href: "/settings", icon: Settings },
  ];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto w-[calc(100%-1rem)] max-w-md pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-2">
      <div className="flex items-center justify-around rounded-2xl border border-white/10 bg-[#161224]/95 p-2 shadow-[0_10px_30px_rgba(0,0,0,0.42)] backdrop-blur-xl">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.label === "Wallet"
            ? pathname === "/wallet" && currentHash !== "#activity"
            : item.label === "Activity"
              ? pathname === "/wallet" && currentHash === "#activity"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.label}
              href={item.href}
              className={`relative flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg px-1 py-1.5 transition-colors ${
                isActive
                  ? "text-[#A78BFA] font-semibold"
                  : "text-white/40 hover:text-white/80"
              }`}
            >
              <span className="relative">
                <Icon
                  className={`w-5 h-5 ${
                    isActive ? "stroke-[2.25]" : "stroke-[1.75]"
                  }`}
                />
                {item.label === "Inbox" && pendingCount > 0 && (
                  <span className="absolute -right-3 -top-2 min-w-4 rounded-full bg-[#F59E0B] px-1 text-center text-[9px] font-bold leading-4 text-[#0B0813]">
                    {pendingCount > 99 ? "99+" : pendingCount}
                  </span>
                )}
              </span>
              <span className="text-[10px] tracking-wide">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
