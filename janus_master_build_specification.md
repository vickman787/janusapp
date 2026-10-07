# PROJECT JANUS: Technical Specification & Implementation Guide
**Event:** Monad Metropolis Hackathon  
**Target Tracks & Bounties:** 
- Primary Track: Consumer Products & Payments ($30,000)
- Agora Sponsor Bounty: Best Cross-Border Payments App on Monad ($10,000)
- Monad Foundation Bounty: Best Mera-Powered UX ($2,500)
- Monad Foundation Bounty: Mera: One Passkey, Many Keys ($2,500)
**Deployment Target:** Monad Testnet (Chain ID: `10143`) & Vercel Web/PWA

---

## 1. Executive Summary & Vision

Janus is a mobile-first, consumer-facing social payment app built natively on Monad. It eliminates Web3 friction entirely:
1. **Zero Seed Phrases**: Onboarding is purely biometric via device passkeys (Mera WebAuthn PRF).
2. **Instant Settlement**: Group bill splitting and peer transfers settle in under 1 second using Agora AUSD stablecoin on Monad rails.
3. **Dual View Architecture**: Inspired by Janus (the Roman god of transitions and dual faces), the interface delivers synchronous real-time coordination between the requester and payer.

---

## 2. Technical Stack & Builder Perks

* **Hosting & Routing:** Next.js (App Router, TypeScript) deployed to Vercel. PWA manifest enabled.
* **Styling & UI:** Tailwind CSS, Lucide React, Shadcn/Radix components, Framer Motion. Deep obsidian palette (`#0B0813`) with Monad purple (`#836EF9`, `#A0055D`) accents.
* **Blockchain Layer:** Monad Testnet (EVM compatible, 10k TPS, 1-sec finality).
* **Client RPC:** QuickNode Monad Testnet RPC endpoint (via Metropolis Builder Perk).
* **Smart Contracts & Debugging:** Foundry / Solidity, Tenderly Pro for trace simulations.
* **Authentication & Key Management:** Mera SDK (`@category-labs/mera` or WebAuthn PRF extension).
* **Settlement Asset:** Agora AUSD (ERC-20 + EIP-2612 Permit support).
* **Data & Portfolio Feed:** Zerion Builder API (for live balances and transaction history).

---

## 3. Architecture & User Flows

```
[User Browser (Mobile/Desktop)]
        │
        ├── 1. Mera Passkey Auth ───► FaceID/TouchID generates deterministic EVM Key via WebAuthn PRF
        ├── 2. AUSD Balance & Feeds ──► Zerion API / QuickNode RPC
        │
        └── 3. Action: Create Split
                    │
                    ▼
          [QR Code / Deep Link]
                    │
                    ▼
        [Payer Scans / Opens Link]
                    │
                    ▼
        [Biometric FaceID Approval] ──► Broadcast to Monad Testnet (Sub-second finality)
                                                │
                                                ▼
                                    [Both Screens Update: Settled]
```

### Flow A: Instant Onboarding
1. User visits `app.yourjanusdomain.com`.
2. Taps "Create Vault with FaceID / Passkey".
3. Browser invokes WebAuthn. Mera SDK derives the EVM address deterministically from the passkey PRF output.
4. User is presented with their AUSD balance and account address without any browser extension popups.

### Flow B: Group Split / Direct Request
1. User enters total amount (e.g., `$60 AUSD`) and selects number of participants (e.g., 3 people = $20 each).
2. App generates a shareable deep link (`/pay?id=...&amount=20&to=0x...`) and an animated QR code.
3. Requester screen shows waiting status indicator.

### Flow C: Settlement
1. Payer opens deep link or scans QR code.
2. Payer reviews request: "$20.00 AUSD for Dinner".
3. Payer taps "Approve with FaceID".
4. Transaction executes either via direct `transfer` or the `JanusSettler` contract on Monad.
5. Monad settles in ~1 second. WebSocket/RPC fires confirmation event. Both UIs transition to "Payment Settled" state.

---

## 4. Smart Contract Specification

### `contracts/JanusSettler.sol`
A gas-efficient, minimal settlement contract enabling batched splits, direct transfers, and meta-transaction permits.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract JanusSettler {
    address public immutable ausdToken;

    event PaymentSettled(
        bytes32 indexed splitId,
        address indexed payer,
        address indexed recipient,
        uint256 amount,
        string memo
    );

    constructor(address _ausdToken) {
        ausdToken = _ausdToken;
    }

    /// @notice Direct settlement for an individual split share
    function settleSplit(
        bytes32 splitId,
        address recipient,
        uint256 amount,
        string calldata memo
    ) external {
        require(amount > 0, "Invalid amount");
        require(recipient != address(0), "Invalid recipient");

        bool success = IERC20(ausdToken).transferFrom(msg.sender, recipient, amount);
        require(success, "Transfer failed");

        emit PaymentSettled(splitId, msg.sender, recipient, amount, memo);
    }
}
```

---

## 5. Frontend & UI Implementation Guidelines

### Key Pages & Routes
1. `/` (Dashboard / Vault):
   - Current AUSD balance card.
   - Quick action buttons: **Send AUSD**, **Split Bill**, **Request**.
   - Recent activity list with status pills (Settled, Pending).
2. `/split/new`:
   - Bill creator: title, total amount, number of payers, breakdown per person.
   - Generates persistent shareable payment URL and dynamic QR code.
3. `/pay/[splitId]`:
   - Payer view.
   - Displays recipient name, avatar, item breakdown, and amount due.
   - Central biometric action button ("Approve with FaceID").
4. `/settings`:
   - Displays derived wallet address, copy button, testnet faucet link, export public identity.

### Visual Design System
- **Background**: `#0B0813` (Dark obsidian)
- **Cards/Surfaces**: `#161224` with 1px border `#2A2242`
- **Primary Brand Purple**: `#836EF9` (Monad theme)
- **Accent Magenta**: `#A0055D`
- **Success / Biometric Green**: `#10B981` (Glow effect on FaceID confirmation)
- **Typography**: Inter or Geist Sans, bold numeric displays for currency amounts.

---

## 6. Implementation Instructions for the AI Agent

### Step 1: Project Scaffolding
```bash
npx create-next-app@latest janus-app --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
cd janus-app
npm install viem wagmi @tanstack/react-query lucide-react qrcode.react clsx tailwind-merge framer-motion
```

### Step 2: Environment Configuration (`.env.local`)
```env
NEXT_PUBLIC_MONAD_CHAIN_ID=10143
NEXT_PUBLIC_MONAD_RPC_URL="https://rpc.testnet.monad.xyz" # or QuickNode URL
NEXT_PUBLIC_AUSD_ADDRESS="0x..." # Agora testnet AUSD address
NEXT_PUBLIC_JANUS_SETTLER_ADDRESS="0x..." # Deployed contract address
ZERION_API_KEY="" # From Builder Perks
```

### Step 3: WebAuthn / Mera Key Derivation Hook (`src/hooks/useMeraAuth.ts`)
Implement passkey registration and credential handling using the browser `navigator.credentials` WebAuthn PRF extension or `@category-labs/mera` wrapper to generate a persistent private key stored in secure local memory for signing Viem transactions.

### Step 4: Payer Shareable Link Logic
Ensure deep link `/pay?id=UUID&to=0x...&amount=25` loads immediately on mobile browsers without requiring the payer to sign up before viewing what they owe.

### Step 5: Vercel Deployment Checklist
1. Ensure all dynamic parameters (`splitId`) have proper loading fallbacks for static build optimization.
2. Add `manifest.json` in `/public` for PWA installation support.
3. Configure Vercel dashboard: add environment variables, attach custom domain, verify SSL certificate.