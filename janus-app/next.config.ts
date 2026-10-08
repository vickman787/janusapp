import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep local development scoped to this app when the parent workspace also
  // contains a lockfile.
  turbopack: {
    root: __dirname,
  },

  // Output mode for Vercel
  output: "standalone",

  // PWA + image domains
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.monad.xyz",
      },
    ],
  },

  // Transpile viem for edge compatibility
  transpilePackages: ["viem"],

  // Disable x-powered-by header
  poweredByHeader: false,

  // Strict mode
  reactStrictMode: true,

  // Environment variables exposed to the client
  env: {
    NEXT_PUBLIC_MONAD_CHAIN_ID:          process.env.NEXT_PUBLIC_MONAD_CHAIN_ID          ?? "10143",
    NEXT_PUBLIC_MONAD_RPC_URL:           process.env.NEXT_PUBLIC_MONAD_RPC_URL           ?? "",
    NEXT_PUBLIC_AUSD_ADDRESS:            process.env.NEXT_PUBLIC_AUSD_ADDRESS            ?? "",
    NEXT_PUBLIC_JANUS_SETTLER_ADDRESS:   process.env.NEXT_PUBLIC_JANUS_SETTLER_ADDRESS   ?? "",
  },

  // Headers for PWA
  async headers() {
    const isDevelopment = process.env.NODE_ENV !== "production";
    const contentSecurityPolicy = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""} https://*.privy.io https://accounts.google.com`,
      "style-src 'self' 'unsafe-inline' https://*.privy.io",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https:",
      `connect-src 'self' https://*.privy.io https://*.monad.xyz https://*.monadscan.com https://*.quicknode.pro https://*.quiknode.pro https://*.walletconnect.com wss://*.privy.io wss://*.walletconnect.com${isDevelopment ? " http://localhost:3000 ws://localhost:3000" : ""}`,
      "frame-src 'self' https://*.privy.io https://accounts.google.com",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
    ].join("; ");

    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          ...(isDevelopment
            ? []
            : [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=31536000; includeSubDomains; preload",
                },
              ]),
        ],
      },
      {
        source: "/manifest.json",
        headers: [
          { key: "Content-Type", value: "application/manifest+json" },
          { key: "Access-Control-Allow-Origin", value: "*" },
        ],
      },
    ];
  },
};

export default nextConfig;
