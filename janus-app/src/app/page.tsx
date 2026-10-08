import Link from "next/link";
import { ArrowRight, Check, LockKeyhole, Send, Users } from "lucide-react";
import { PreviewShell } from "@/components/PreviewShell";

const steps = [
  { number: "01", title: "Create a shared cost", body: "Add the people, the amount, and a note. Everyone sees exactly what they owe." },
  { number: "02", title: "Send it once", body: "Share a private request. No spreadsheets, screenshots, or awkward reminders." },
  { number: "03", title: "Settle together", body: "Payments land in seconds and the split closes itself when everyone is in." },
];

export default function WelcomePreviewPage() {
  return (
    <PreviewShell active="welcome">
      <main>
        <section className="mx-auto grid w-full max-w-[1440px] gap-10 px-5 pb-16 pt-8 sm:px-8 sm:pt-12 xl:grid-cols-[1.05fr_0.95fr] xl:items-center xl:gap-16 xl:px-10 xl:pb-28 xl:pt-20">
          <div>
            <p className="mb-6 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#A78BFA]">Shared costs, settled</p>
            <h1 className="max-w-[680px] text-[clamp(2.65rem,12vw,4.75rem)] font-semibold leading-[1.02] tracking-[-0.055em] text-white">
              Stop chasing people for money.
            </h1>
            <p className="mt-7 max-w-[510px] text-base leading-7 text-white/55 sm:text-lg">
              JANUS makes dinner, rent, and trip expenses simple to settle. One clear request, private by default, finished in seconds.
            </p>
            <div className="mt-9 flex max-w-[520px] flex-col gap-3 lg:flex-row">
              <Link href="/wallet" className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#836EF9] px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-[#927fff]">
                Open the wallet <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="#how-it-works" className="inline-flex items-center justify-center rounded-lg border border-white/15 px-5 py-3.5 text-sm font-semibold text-white/75 transition hover:border-white/30 hover:text-white">
                Read how it works
              </Link>
            </div>
            <div className="mt-8 flex items-center gap-5 text-xs text-white/40">
              <span className="inline-flex items-center gap-2"><LockKeyhole className="h-3.5 w-3.5 text-[#10B981]" /> Private by default</span>
              <span className="inline-flex items-center gap-2"><Check className="h-3.5 w-3.5 text-[#10B981]" /> No seed phrases</span>
            </div>
          </div>

          <div className="relative mx-auto flex w-full max-w-[600px] items-end justify-center gap-2 px-1 pt-4 sm:gap-5 xl:gap-8 xl:py-6">
            <PhoneFrame label="New split" className="mb-6 rotate-[-4deg] sm:mb-8 sm:rotate-[-5deg]">
              <div className="text-[10px] text-white/40">Friday dinner</div>
              <div className="mt-2 text-2xl font-semibold">$184.00</div>
              <div className="mt-1 text-[10px] text-white/40">4 people · $46.00 each</div>
              <div className="mt-7 space-y-2">
                {[["You", "Paid"], ["Maya", "Pending"], ["Noah", "Pending"]].map(([name, status]) => <div key={name} className="flex items-center justify-between border-b border-white/10 pb-2 text-[10px]"><span>{name}</span><span className={status === "Paid" ? "text-[#10B981]" : "text-white/35"}>{status}</span></div>)}
              </div>
              <div className="mt-7 rounded-md bg-[#836EF9] py-2 text-center text-[10px] font-semibold">Share request</div>
            </PhoneFrame>
            <PhoneFrame label="Wallet" className="rotate-[4deg]">
              <div className="flex min-w-0 items-start justify-between gap-2"><div className="min-w-0"><div className="text-[10px] text-white/40">Available balance</div><div className="mt-2 whitespace-nowrap text-[clamp(1.05rem,2vw,1.5rem)] font-semibold tracking-[-0.06em]">$1,248.60</div></div><div className="h-7 w-7 shrink-0 rounded-md bg-[#836EF9]/20" /></div>
              <div className="mt-8 grid grid-cols-2 gap-2"><div className="rounded-md bg-white/10 p-2 text-center text-[10px]"><Send className="mx-auto mb-1 h-3.5 w-3.5 text-[#A78BFA]" />Send</div><div className="rounded-md bg-white/10 p-2 text-center text-[10px]"><Users className="mx-auto mb-1 h-3.5 w-3.5 text-[#A78BFA]" />Split</div></div>
              <div className="mt-7 text-[10px] text-white/40">Recent activity</div>
              <div className="mt-3 space-y-3 text-[10px]"><div className="flex justify-between"><span>From Maya</span><span className="text-[#10B981]">+$46.00</span></div><div className="flex justify-between"><span>Friday dinner</span><span className="text-white/40">-$46.00</span></div></div>
            </PhoneFrame>
          </div>
        </section>

        <section id="how-it-works" className="border-y border-white/10 bg-[#100D1B]/70">
          <div className="mx-auto grid w-full max-w-[1440px] gap-8 px-5 py-14 sm:grid-cols-3 sm:px-8 lg:px-10 lg:py-20">
            {steps.map((step) => <div key={step.number} className="border-l border-[#836EF9]/45 pl-5"><div className="text-xs font-semibold text-[#A78BFA]">{step.number}</div><h2 className="mt-4 text-lg font-semibold text-white">{step.title}</h2><p className="mt-2 max-w-[280px] text-sm leading-6 text-white/45">{step.body}</p></div>)}
          </div>
        </section>
        <section className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-5 py-16 sm:px-8 lg:flex-row lg:items-end lg:justify-between lg:px-10 lg:py-24"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#10B981]">Made for real life</p><h2 className="mt-4 max-w-[530px] text-3xl font-semibold tracking-tight text-white sm:text-4xl">Less admin. More time with your people.</h2></div><p className="max-w-[370px] text-sm leading-6 text-white/45">Your balance, your requests, and your group expenses in one quiet place. JANUS is designed around the moments people actually share.</p></section>
      </main>
    </PreviewShell>
  );
}

function PhoneFrame({ children, label, className = "" }: { children: React.ReactNode; label: string; className?: string }) {
  return <div className={`flex min-h-[350px] w-[min(190px,43vw)] shrink-0 rounded-[24px] border border-white/15 bg-[#171323] p-1.5 sm:min-h-[390px] sm:rounded-[26px] sm:p-2 xl:min-h-[460px] xl:w-[230px] xl:rounded-[30px] xl:p-2.5 ${className}`}><div className="flex-1 overflow-hidden rounded-[19px] border border-white/10 bg-[#0F0C18] px-3 pb-5 pt-3 sm:rounded-[20px] sm:px-4 xl:rounded-[24px] xl:px-5 xl:pb-7 xl:pt-4"><div className="mx-auto mb-6 h-1 w-10 rounded-full bg-white/15 sm:w-12 xl:mb-8 xl:w-14" /><div className="text-xs font-medium text-white/75">{label}</div>{children}</div></div>;
}
