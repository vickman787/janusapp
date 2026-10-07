# PROJECT JANUS

> Instant AUSD bill splitting & peer transfers on Monad Testnet — built for the Monad Metropolis Hackathon.

## Architecture

```
Browser (Mobile PWA)
  └── Mera WebAuthn PRF passkey → EVM key derivation
  └── Next.js 14 App Router (Vercel)
        ├── / — Dashboard, AUSD balance, activity feed
        ├── /split/new — Bill creator + shareable QR link
        ├── /pay/[splitId] — Payer FaceID approval flow
        └── /settings — Wallet + network info

Monad Testnet (Chain ID 10143)
  └── JanusSplit.sol — Batched splits, direct transfers, EIP-2612 permit
  └── Agora AUSD — ERC-20 + Permit settlement asset
```

## Quick Start

### Frontend
```bash
cd janus-app
npm install
npm install viem wagmi @tanstack/react-query lucide-react qrcode.react clsx tailwind-merge framer-motion uuid
cp .env.local .env.local   # fill in AUSD + settler addresses
npm run dev
```

### Contracts (Foundry)
```bash
forge install foundry-rs/forge-std --no-commit
forge build
forge test -vvv
```

### Contracts (Hardhat)
```bash
npm install
npx hardhat compile
npx hardhat test
```

### Deploy to Monad Testnet
```bash
# Set AUSD_ADDRESS and PRIVATE_KEY in your env
forge script script/DeployJanusSplit.s.sol \
  --rpc-url https://rpc.testnet.monad.xyz \
  --broadcast \
  --private-key $PRIVATE_KEY \
  -vvvv
```

## Design Tokens

| Color | Hex |
|---|---|
| Background | `#0B0813` |
| Surface | `#161224` |
| Brand Purple | `#836EF9` |
| Accent Magenta | `#A0055D` |
| Success Green | `#10B981` |

## Hackathon Tracks

- **Consumer Products & Payments** ($30,000)
- **Agora: Best Cross-Border Payments App on Monad** ($10,000)
- **Monad Foundation: Best Mera-Powered UX** ($2,500)
- **Monad Foundation: Mera One Passkey Many Keys** ($2,500)
