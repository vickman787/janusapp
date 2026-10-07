# PROJECT JANUS: Master Technical Specification & Autonomous Agent Build Guide

**Event:** Monad Metropolis Hackathon 2026  
**Primary Track:** Consumer Products & Payments ($30,000 USD)  
**Target Sponsor Bounties:**
- **Agora:** Best Cross-Border Payments App on Monad ($10,000 USD)
- **Monad Foundation:** Best Mera-Powered UX ($2,500 USD)
- **Monad Foundation:** Mera: One Passkey, Many Keys ($2,500 USD)

**Deployment Targets:**
- Blockchain: Monad Testnet (Chain ID: `10143`)
- Hosting & CDN: Vercel (PWA enabled) with Custom Domain

---

## 1. Product Vision & Executive Summary

**Janus** is a mobile-first, consumer-grade group split and instant cross-border settlement application built natively for Monad. It eliminates traditional Web3 friction entirely:

1. **Zero Seed Phrases**: 100% biometric onboarding (FaceID, TouchID, Windows Hello) using the Mera SDK via WebAuthn PRF.
2. **Instant Settlement**: Sub-second payment confirmation and group bill settlement via Agora AUSD stablecoin over Monad high-throughput rails.
3. **Dual-View UX**: Real-time synchronization between the bill creator (requester) and the payer/participants, reflecting the classical two-faced Janus archetype.
4. **Resilient Production Stack**: Seamless integration with the Metropolis Builder Perks: QuickNode (RPC & WebSockets), Tenderly Pro (transaction simulation & tracing), and Zerion (portfolio balances & decoded activity history).

---

## 2. Network Constants & Token Parameters

- **Network Name:** Monad Testnet
- **Chain ID:** `10143`
- **Default Public RPC:** `https://rpc.testnet.monad.xyz`
- **Block Explorer:** `https://testnet.monadscan.com`
- **Agora AUSD Token Address:** `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`
- **Agora Faucet Contract Address:** `0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C`
- **Token Decimals:** `6`
- **Token Symbol:** `AUSD`

---

## 3. Builder Perks & Infrastructure Integration Map

| Tool / Perk | Integration Path | Functional Role in Janus |
| :--- | :--- | :--- |
| **QuickNode Build Plan** | `lib/web3.ts`, Foundry/Deploy scripts | Dedicated high-throughput Monad Testnet RPC endpoint for rapid balance reads and transaction broadcasts. |
| **Tenderly Pro Tier** | `app/api/simulate/route.ts`, contract tests | Pre-execution transaction simulation API to intercept reverts/insufficient balances before triggering biometric prompts. |
| **Zerion API Builder Tier** | `app/api/activity/route.ts`, `components/ActivityList.tsx` | Decoded wallet transaction feed and asset balances without writing a custom backend indexer or subgraph. |

---

## 4. Environment Configuration (`.env.local`)

```env
# Network & RPC (QuickNode Builder Perk)
NEXT_PUBLIC_CHAIN_ID=10143
NEXT_PUBLIC_MONAD_RPC_URL="https://rpc.testnet.monad.xyz" # Replace with QuickNode endpoint when generated
NEXT_PUBLIC_MONAD_EXPLORER="https://testnet.monadscan.com"

# Agora AUSD Token Configuration
NEXT_PUBLIC_AUSD_ADDRESS="0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC"
NEXT_PUBLIC_AGORA_FAUCET_ADDRESS="0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C"

# Deployed Smart Contract (Filled after deployment)
NEXT_PUBLIC_JANUS_SPLIT_CONTRACT=""

# Tenderly Pro Tier (Transaction Simulation API)
TENDERLY_ACCESS_KEY="your_tenderly_access_key"
TENDERLY_ACCOUNT_SLUG="your_tenderly_account"
TENDERLY_PROJECT_SLUG="janus-monad"

# Zerion API (Activity Feed Indexer)
ZERION_API_KEY="your_zerion_builder_api_key"
```

---

## 5. Smart Contracts & Deployment Guide

### 5.1 Smart Contract: `contracts/JanusSplit.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract JanusSplit {
    address public immutable ausdToken;

    struct Bill {
        address organizer;
        string title;
        uint256 totalAmount;
        uint256 amountPerParticipant;
        uint256 settledCount;
        uint256 totalParticipants;
        bool isComplete;
    }

    mapping(bytes32 => Bill) public bills;
    mapping(bytes32 => mapping(address => bool)) public hasSettled;

    event BillCreated(bytes32 indexed billId, address indexed organizer, uint256 totalAmount, uint256 perPerson);
    event ShareSettled(bytes32 indexed billId, address indexed payer, uint256 amount);
    event BillCompleted(bytes32 indexed billId);

    constructor(address _ausdToken) {
        require(_ausdToken != address(0), "Invalid AUSD address");
        ausdToken = _ausdToken;
    }

    function createBill(
        bytes32 billId,
        string calldata title,
        uint256 totalAmount,
        uint256 participantsCount
    ) external {
        require(bills[billId].organizer == address(0), "Bill already exists");
        require(participantsCount > 0, "Invalid participant count");
        require(totalAmount > 0, "Invalid total amount");

        uint256 perPerson = totalAmount / participantsCount;
        bills[billId] = Bill({
            organizer: msg.sender,
            title: title,
            totalAmount: totalAmount,
            amountPerParticipant: perPerson,
            settledCount: 0,
            totalParticipants: participantsCount,
            isComplete: false
        });

        emit BillCreated(billId, msg.sender, totalAmount, perPerson);
    }

    function settleShare(bytes32 billId) external {
        Bill storage bill = bills[billId];
        require(bill.organizer != address(0), "Bill not found");
        require(!bill.isComplete, "Bill already completed");
        require(!hasSettled[billId][msg.sender], "Share already settled");

        hasSettled[billId][msg.sender] = true;
        bill.settledCount += 1;

        require(
            IERC20(ausdToken).transferFrom(msg.sender, bill.organizer, bill.amountPerParticipant),
            "Transfer failed"
        );

        emit ShareSettled(billId, msg.sender, bill.amountPerParticipant);

        if (bill.settledCount >= bill.totalParticipants) {
            bill.isComplete = true;
            emit BillCompleted(billId);
        }
    }
}
```

### 5.2 Foundry Deployment Script: `script/DeployJanusSplit.s.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../contracts/JanusSplit.sol";

contract DeployJanusSplit is Script {
    function run() external {
        address ausdAddress = vm.envAddress("AUSD_ADDRESS");
        vm.startBroadcast();
        JanusSplit split = new JanusSplit(ausdAddress);
        vm.stopBroadcast();
        console.log("JanusSplit deployed at:", address(split));
    }
}
```

### 5.3 Execution Commands (PowerShell / Windows)

```powershell
# 1. Export deployment variables
$env:AUSD_ADDRESS = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC"
$env:PRIVATE_KEY = "0xYOUR_TESTNET_DEPLOYER_PRIVATE_KEY"

# 2. Broadcast deployment to Monad Testnet via Foundry
& "$env:USERPROFILE\.foundry\bin\forge.exe" script script/DeployJanusSplit.s.sol `
  --rpc-url https://rpc.testnet.monad.xyz `
  --broadcast `
  --private-key $env:PRIVATE_KEY `
  -vvvv
```

---

## 6. Frontend & API Routes Implementation

### 6.1 Tenderly Simulation Route: `app/api/simulate/route.ts`

```typescript
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { from, to, data, value } = await req.json();

    const response = await fetch(
      `https://api.tenderly.co/api/v1/account/${process.env.TENDERLY_ACCOUNT_SLUG}/project/${process.env.TENDERLY_PROJECT_SLUG}/simulate`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Access-Key": process.env.TENDERLY_ACCESS_KEY || "",
        },
        body: JSON.stringify({
          network_id: "10143",
          from,
          to,
          input: data || "0x",
          value: value || "0",
          save: true,
        }),
      }
    );

    const simulation = await response.json();
    const isSuccess = simulation.transaction?.status ?? true;

    return NextResponse.json({
      success: isSuccess,
      gasUsed: simulation.transaction?.gas_used || 0,
      error: isSuccess ? null : simulation.transaction?.error_message || "Transaction simulated revert",
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
```

### 6.2 Zerion Activity Feed Route: `app/api/activity/route.ts`

```typescript
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const address = searchParams.get("address");

  if (!address) {
    return NextResponse.json({ error: "Missing address query parameter" }, { status: 400 });
  }

  try {
    const authHeader = Buffer.from(`${process.env.ZERION_API_KEY}:`).toString("base64");
    const res = await fetch(
      `https://api.zerion.io/v1/wallets/${address}/transactions/?page[size]=10`,
      {
        headers: {
          Authorization: `Basic ${authHeader}`,
          Accept: "application/json",
        },
      }
    );

    const data = await res.json();
    return NextResponse.json({ transactions: data.data || [] });
  } catch (error: any) {
    return NextResponse.json({ transactions: [] });
  }
}
```

### 6.3 Web3 Client Provider: `lib/web3.ts`

```typescript
import { createPublicClient, http, defineChain } from "viem";

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_MONAD_RPC_URL || "https://rpc.testnet.monad.xyz"],
    },
  },
  blockExplorers: {
    default: { name: "MonadScan", url: "https://testnet.monadscan.com" },
  },
});

export const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(),
});
```

---

## 7. UI Components & Screen States

### Screen 1: Dashboard (`/`)
- **Vault Summary**: Displays net balance formatted as `$X,XXX.XX AUSD`.
- **Primary Actions**:
  - `Send AUSD`: Direct peer transfer modal.
  - `Split Bill`: Triggers bill breakdown wizard.
  - `Faucet Top-Up`: Direct drip helper invoking Agora Faucet (`0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C`).
- **Activity Section**: Fetches and lists transactions via `/api/activity`.

### Screen 2: Split Creation (`/split`)
- Inputs for Bill Title, Total Amount, and Number of Participants.
- Automatic calculation of per-person share (`total / count`).
- Dynamic QR code generation with deep-link payload: `/pay/[billId]?amount=X&to=0x...`.

### Screen 3: Payer Approval (`/pay/[billId]`)
- Participant reads bill summary: *"Dinner with Alex M. — $40.00 AUSD"*.
- Pre-flight check executes against `/api/simulate`.
- Main CTA: **"Approve with FaceID"** trigger using Mera passkey authentication.
- Instant transition to success animation upon Monad testnet block confirmation.

---

## 8. Autonomous Agent Execution Instructions

1. **Verify Dependencies**: Ensure `@category-labs/mera`, `viem`, `wagmi`, `@tanstack/react-query`, `lucide-react`, and `qrcode.react` are installed.
2. **Deploy Contract**: Run the Foundry deployment script using the provided testnet AUSD address (`0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`).
3. **Bind Contract Address**: Write the resulting deployed address to `NEXT_PUBLIC_JANUS_SPLIT_CONTRACT` in `.env.local`.
4. **Verify API Routes**: Ensure both `/api/simulate` and `/api/activity` handle missing environment keys gracefully with fallback mock data for local testing.
5. **Vercel Build Check**: Run `npm run build` to confirm zero lint or TypeScript errors prior to hosting.