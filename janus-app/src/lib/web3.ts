import { createPublicClient, http, defineChain, formatUnits, parseAbi } from "viem";

const clientRpcUrl =
  process.env.NEXT_PUBLIC_MONAD_RPC_URL?.trim().replace(/^['"]|['"]$/g, "") ||
  "https://rpc.testnet.monad.xyz";

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: {
      http: [clientRpcUrl],
    },
  },
  blockExplorers: {
    default: { name: "MonadScan", url: "https://testnet.monadscan.com" },
  },
});

export const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(clientRpcUrl),
});

export const AUSD_ADDRESS = (process.env.NEXT_PUBLIC_AUSD_ADDRESS ||
  "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC") as `0x${string}`;

export const JANUS_SPLIT_ADDRESS = (process.env
  .NEXT_PUBLIC_JANUS_SPLIT_CONTRACT ||
  process.env.NEXT_PUBLIC_JANUS_SETTLER_ADDRESS ||
  "0x1c3F1382057F99b5dAd89855B919bB322792C66E") as `0x${string}`;

// V2 is additive. Existing splits continue to use JANUS_SPLIT_ADDRESS;
// new splits use V2 when configured, with the legacy contract as fallback.
export const JANUS_SPLIT_V2_ADDRESS = (process.env.NEXT_PUBLIC_JANUS_SPLIT_V2_CONTRACT || "") as `0x${string}`;
export const NEW_SPLIT_CONTRACT_ADDRESS = (JANUS_SPLIT_V2_ADDRESS || JANUS_SPLIT_ADDRESS) as `0x${string}`;

export const AGORA_FAUCET_ADDRESS = (process.env
  .NEXT_PUBLIC_AGORA_FAUCET_ADDRESS ||
  "0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C") as `0x${string}`;

export const AGORA_FAUCET_ABI = parseAbi([
  "function requestFunds(address recipient) external",
]);

export const MON_GAS_REQUIRED_MESSAGE =
  "You need a small amount of Monad testnet MON for the network fee before claiming AUSD.";

export const ERC20_ABI = parseAbi([
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function transfer(address recipient, uint256 amount) external returns (bool)",
  "function transferFrom(address sender, address recipient, uint256 amount) external returns (bool)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
]);

export const JANUS_SPLIT_ABI = parseAbi([
  "event SplitCreated(bytes32 indexed splitId, address indexed requester, uint256 totalAmount, uint256 numPayers, string memo)",
  "event PaymentSettled(bytes32 indexed splitId, address indexed payer, address indexed recipient, uint256 amount, string memo)",
  "event BatchSettled(bytes32 indexed splitId, address indexed payer, uint256 totalDistributed, uint256 recipientCount)",
  "event SplitCancelled(bytes32 indexed splitId, address indexed requester)",
  "event SplitFullySettled(bytes32 indexed splitId)",
  "function createSplit(bytes32 splitId, uint256 totalAmount, uint256 numPayers, string memo) external returns (uint256)",
  "function cancelSplit(bytes32 splitId) external",
  "function settleSplit(bytes32 splitId) external",
  "function settleAdditionalShare(bytes32 splitId) external",
  "function settleDirectTransfer(bytes32 splitId, address recipient, uint256 amount, string memo) external",
  // getSplit returns the Solidity SplitRecord struct as one tuple.
  "function getSplit(bytes32 splitId) external view returns ((address requester, uint256 totalAmount, uint256 amountPerPayer, uint256 numPayers, uint256 settledCount, uint8 status, string memo))",
  "function payerHasSettled(bytes32 splitId, address payer) external view returns (bool)",
]);

/**
 * Live on-chain balanceOf call for Agora AUSD on Monad Testnet (6 decimals)
 */
export async function fetchOnchainAusdBalance(address: string): Promise<string> {
  if (!address || !address.startsWith("0x")) return "0.00";
  try {
    const rawBalance = await publicClient.readContract({
      address: AUSD_ADDRESS,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [address as `0x${string}`],
    });
    return Number(formatUnits(rawBalance, 6)).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch (error) {
    console.error("Live on-chain balanceOf query failed:", error);
    return "0.00";
  }
}

/** Check whether the wallet has any native MON available for network fees. */
export async function ensureGas(address?: string): Promise<boolean> {
  if (!address || !address.startsWith("0x")) return false;
  try {
    const bal = await publicClient.getBalance({ address: address as `0x${string}` });
    return bal > 0n;
  } catch (err) {
    console.warn("ensureGas check warning:", err);
    return false;
  }
}

export interface OnchainSplitActivity {
  id: string;
  type: string;
  title: string;
  amount: string;
  date: string;
  isPositive: boolean;
  isGroup: boolean;
  splitId?: string;
}

/**
 * Fetch live events from deployed JanusSplit contract
 */
export async function fetchOnchainSplitEvents(
  address?: string
): Promise<OnchainSplitActivity[]> {
  try {
    const currentBlock = await publicClient.getBlockNumber();
    // Query within RPC range limit (last 90 blocks)
    const ninety = BigInt(90);
    const zero = BigInt(0);
    const fromBlock = currentBlock > ninety ? currentBlock - ninety : zero;

    const [createdLogs, settledLogs] = await Promise.all([
      publicClient.getContractEvents({
        address: JANUS_SPLIT_ADDRESS,
        abi: JANUS_SPLIT_ABI,
        eventName: "SplitCreated",
        fromBlock,
        toBlock: currentBlock,
      }),
      publicClient.getContractEvents({
        address: JANUS_SPLIT_ADDRESS,
        abi: JANUS_SPLIT_ABI,
        eventName: "PaymentSettled",
        fromBlock,
        toBlock: currentBlock,
      }),
    ]);

    const events: OnchainSplitActivity[] = [];

    for (const log of createdLogs) {
      const args = log.args;
      if (!address || args.requester?.toLowerCase() === address.toLowerCase()) {
        events.push({
          id: log.transactionHash,
          type: "created",
          title: args.memo || "Bill Split Created",
          amount: `${(Number(args.totalAmount || 0) / 1e6).toFixed(2)}`,
          date: "On-chain",
          isPositive: false,
          isGroup: true,
          splitId: args.splitId,
        });
      }
    }

    for (const log of settledLogs) {
      const args = log.args;
      const isRecipient = Boolean(
        address && args.recipient?.toLowerCase() === address.toLowerCase()
      );
      events.push({
        id: log.transactionHash,
        type: "settled",
        title: args.memo || "Split Share Settled",
        amount: `${(Number(args.amount || 0) / 1e6).toFixed(2)}`,
        date: "On-chain",
        isPositive: isRecipient,
        isGroup: true,
        splitId: args.splitId,
      });
    }

    return events;
  } catch (error) {
    console.warn("getContractEvents query limited or empty:", error);
    return [];
  }
}
