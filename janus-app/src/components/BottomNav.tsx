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
      setPendingCount(0);
      return;
    }

    void refreshInboxCount();
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
    { label: "Wallet", href: "/", icon: Wallet },
    { label: "Activity", href: "/#activity", icon: Activity },
    { label: "Inbox", href: "/inbox", icon: Inbox },
    { label: "Groups", href: "/groups", icon: Users },
    { label: "Settings", href: "/settings", icon: Settings },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 max-w-md mx-auto px-4 pb-5 pt-2">
      <div className="bg-[#161224]/90 backdrop-blur-xl border border-[#2A2242] rounded-2xl p-2 flex items-center justify-around shadow-[0_8px_32px_rgba(0,0,0,0.6)]">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href.split("#")[0]) && item.href !== "/";

          return (
            <Link
              key={item.label}
              href={item.href}
              className={`flex flex-col items-center gap-1 py-1.5 px-3 rounded-xl transition-all ${
                isActive
                  ? "text-[#836EF9] font-semibold"
                  : "text-white/40 hover:text-white/80"
              }`}
            >
              <span className="relative">
                <Icon
                  className={`w-5 h-5 transition-transform ${
                    isActive ? "scale-110 stroke-[2.5]" : "stroke-[1.75]"
                  }`}
                />
                {item.label === "Inbox" && pendingCount > 0 && (
                  <span className="absolute -top-2 -right-3 min-w-4 h-4 px-1 rounded-full bg-[#F59E0B] text-[#0B0813] text-[9px] font-black leading-4 text-center ring-2 ring-[#161224]">
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
