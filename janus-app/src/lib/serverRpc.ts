import "server-only";
import { createPublicClient, http } from "viem";
import { monadTestnet } from "@/lib/web3";

const rpcUrl = (
  process.env.QUICKNODE_RPC_URL ||
  // Existing local setups used this name. This module is server-only and the
  // value is never referenced by browser code or next.config.ts.
  process.env["NEXT_PUBLIC_MONAD_RPC_URL"] ||
  "https://rpc.testnet.monad.xyz"
).trim().replace(/^['"]|['"]$/g, "");

export const serverPublicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(rpcUrl, { timeout: 12_000 }),
});

export { rpcUrl };
