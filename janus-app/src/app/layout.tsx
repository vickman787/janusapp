import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "JANUS — Consumer Payments",
  description:
    "A calm, private way to send money, request payments, and settle shared expenses.",
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
    title:       "JANUS — Consumer Payments",
    description: "Send money, request payments, and settle shared expenses.",
    type:        "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#FAF9FF",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `document.documentElement.dataset.theme = localStorage.getItem("janus-theme") || "light";`,
          }}
        />
      </head>
      <body
        className="antialiased bg-[#0B0813] text-white min-h-screen relative overflow-x-hidden"
      >
        {/* Quiet JANUS canvas: structure and content carry the interface. */}
        <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden" />

        {/* ── Main App Layer ── */}
        <div className="relative z-10 min-h-screen flex flex-col">
          <Providers>{children}</Providers>
        </div>
      </body>
    </html>
  );
}
