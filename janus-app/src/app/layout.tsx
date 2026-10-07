import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { JanusLogo } from "@/components/JanusLogo";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Janus — Consumer Payments on Monad",
  description:
    "Group bill splitting and peer transfers that settle in under 1 second on Monad. Zero seed phrases — just your face.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon.png", type: "image/png" },
      { url: "/favicon.ico" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  openGraph: {
    title:       "Janus — Consumer Payments on Monad",
    description: "Split bills with AUSD on Monad. Sub-second finality.",
    type:        "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0B0813",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[#0B0813] text-white min-h-screen relative overflow-x-hidden`}
      >
        {/* ── Monad Atmospheric Glows + Giant Janus Logo Watermark ── */}
        <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden flex items-center justify-center">
          {/* Top Primary Purple Spotlight */}
          <div className="absolute -top-[160px] left-1/2 -translate-x-1/2 w-[720px] h-[480px] rounded-full bg-gradient-to-b from-[#836EF9]/30 via-[#6848D7]/15 to-transparent blur-[120px]" />

          {/* Right Mid Magenta Accent Glow */}
          <div className="absolute top-[30%] -right-[140px] w-[450px] h-[450px] rounded-full bg-gradient-to-br from-[#A0055D]/20 to-[#836EF9]/10 blur-[115px]" />

          {/* Bottom Left Deep Violet Ambient Glow */}
          <div className="absolute bottom-[8%] -left-[140px] w-[420px] h-[420px] rounded-full bg-gradient-to-tr from-[#836EF9]/22 to-transparent blur-[110px]" />

          {/* 🌟 Giant Janus Dual-Face Logo in Background 🌟 */}
          <div className="absolute top-[18%] left-1/2 -translate-x-1/2 w-[520px] h-[520px] opacity-[0.09] pointer-events-none">
            <JanusLogo variant="watermark" className="w-full h-full" />
          </div>

          {/* Subtle Monad Micro-grid pattern */}
          <div className="absolute inset-0 opacity-[0.035] bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:24px_24px]" />
        </div>

        {/* ── Main App Layer ── */}
        <div className="relative z-10 min-h-screen flex flex-col">
          <Providers>{children}</Providers>
        </div>
      </body>
    </html>
  );
}
