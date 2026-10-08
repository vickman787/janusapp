import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { JanusLogo } from "@/components/JanusLogo";

export function PreviewShell({
  children,
  active,
}: {
  children: React.ReactNode;
  active: "welcome" | "wallet";
}) {
  return (
    <div className="min-h-screen bg-[#0B0813] text-[#F7F5FB]">
      <header className="mx-auto flex w-full max-w-[1440px] items-center justify-between px-5 py-6 sm:px-8 lg:px-10">
        <Link href="/" aria-label="JANUS home" className="shrink-0">
          <JanusLogo size={34} showText />
        </Link>
        <nav className="hidden items-center gap-8 text-sm text-white/55 sm:flex">
          <Link href="/" className={active === "welcome" ? "text-white" : "transition-colors hover:text-white"}>
            Welcome
          </Link>
          <Link href="/wallet" className={active === "wallet" ? "text-white" : "transition-colors hover:text-white"}>
            Wallet
          </Link>
        </nav>
      </header>
      {children}
      <footer className="mx-auto flex w-full max-w-[1440px] flex-col gap-3 border-t border-white/10 px-5 py-8 text-xs text-white/40 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-10">
        <div className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5 text-[#10B981]" /> Built for ordinary money moments.</div>
        <span>JANUS Consumer Payments</span>
      </footer>
    </div>
  );
}
