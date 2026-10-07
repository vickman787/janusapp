"use client";

import React from "react";
import { PrivyProvider } from "@privy-io/react-auth";

// Restore the direct QuickNode path that the embedded Privy wallet used
// successfully before the proxy experiment. This is deliberately public for
// local hackathon development; use a referrer-restricted endpoint before a
// public deployment.
const walletRpcUrl =
  process.env.NEXT_PUBLIC_MONAD_RPC_URL?.trim().replace(/^['"]|['"]$/g, "") ||
  "https://rpc.testnet.monad.xyz";

// Suppress benign third-party React DOM prop warnings (e.g. from Privy modal) in dev overlay
if (typeof window !== "undefined") {
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    if (
      typeof args[0] === "string" &&
      args[0].includes("React does not recognize the `isActive` prop on a DOM element")
    ) {
      return;
    }
    originalError(...args);
  };
}

export const monadTestnet = {
  id: 10143,
  name: "Monad Testnet",
  network: "monad-testnet",
  nativeCurrency: {
    name: "MON",
    symbol: "MON",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [walletRpcUrl],
    },
  },
  blockExplorers: {
    default: {
      name: "MonadScan",
      url: "https://testnet.monadscan.com",
    },
  },
};

export function Providers({ children }: { children: React.ReactNode }) {
  const rawAppId =
    process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim().replace(/^['"]|['"]$/g, "") || "";
  const appId =
    rawAppId.length === 25 ? rawAppId : "cm01234567890123456789012";
  return (
    <PrivyProvider
      appId={appId}
      config={{
        defaultChain: monadTestnet,
        supportedChains: [monadTestnet],
        loginMethods: ["email", "wallet", "google", "passkey"],
        appearance: {
          theme: "dark",
          accentColor: "#836EF9",
        },
        embeddedWallets: {
          ethereum: {
            createOnLogin: "users-without-wallets",
          },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
