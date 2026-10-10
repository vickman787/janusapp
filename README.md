# JANUS

**Shared costs, settled.** JANUS is a mobile-first consumer payments app for sending Agora AUSD and settling group expenses on Monad Testnet.

[Live app](https://www.janusapp.xyz/) · [Monad Testnet explorer](https://testnet.monadscan.com/)

## What we built

JANUS turns a shared expense into a link that people can pay from any device. The organizer creates either a named split for specific JANUS users or an open split with a fixed number of payment slots. JANUS calculates each share, generates a payer link and QR code, and closes the split as payments settle on-chain.

The current build includes:

- Direct peer-to-peer AUSD transfers by JANUS username or wallet address.
- Named splits for invited participants and open splits that anyone with the link can join.
- Shareable payer links and QR codes.
- On-chain split creation, settlement, cancellation, and status reconciliation.
- A wallet dashboard with live AUSD balance, payment activity, split progress, and payments due.
- JANUS usernames, groups, an inbox, and participant identity resolution.
- Privy authentication through email, Google, an external wallet, or a registered passkey.
- Privy embedded wallets for users who do not already have a wallet.
- A testnet AUSD faucet flow and MonadScan transaction links.
- Responsive light and dark interfaces designed for phones first.

## Main user flow

1. Sign in with email, Google, or a wallet. A first-time user receives an embedded wallet through Privy.
2. Optionally register a JANUS username and add a passkey from **Settings**.
3. Add Monad Testnet MON for gas and claim test AUSD.
4. Send AUSD directly, or create a named/open split.
5. Share the generated payer link or QR code.
6. Each payer approves AUSD and settles their share through the JANUS contract.
7. JANUS verifies the transaction receipt, updates Supabase history, and reconciles the displayed status with the contract.

Supabase stores product metadata and indexed history; it does not custody funds or decide whether a payment settled. Monad remains the settlement source of truth.

## Architecture

```text
Phone or desktop browser
  ├─ Next.js 16 App Router UI
  ├─ Privy authentication + embedded/external wallets + passkeys
  └─ Viem transaction signing and contract reads
          │
          ├──────── Monad Testnet (chain ID 10143)
          │           ├─ Agora AUSD ERC-20
          │           ├─ JanusSplit
          │           └─ JanusSplitV2
          │
          └──────── Next.js server routes
                      ├─ Privy token verification
                      ├─ Transaction receipt/event verification
                      ├─ Server-only RPC access and rate limiting
                      └─ Supabase metadata, profiles, groups, and history
```

Important design choices:

- Users sign transactions from their own Privy or connected wallet.
- Server routes verify transaction receipts before indexing confirmed activity.
- Existing splits retain the contract address that created them, allowing the legacy and V2 contracts to coexist.
- Local activity is shown immediately after confirmation while persistent history catches up.
- Paid RPC credentials and the Supabase service-role key remain server-only.

## Technology

| Layer | Technology |
| --- | --- |
| Web app | Next.js 16, React 19, TypeScript, Tailwind CSS |
| Authentication and wallets | Privy React Auth |
| Blockchain client | Viem |
| Network | Monad Testnet, chain ID `10143` |
| Settlement asset | Agora AUSD, 6 decimals |
| Contracts | Solidity, Foundry, Hardhat |
| Persistence | Supabase/Postgres |
| QR payments | `qrcode.react` |
| Deployment | Vercel |
| Demo tooling | Remotion and FFmpeg |

## Application routes

| Route | Purpose |
| --- | --- |
| `/` | Public landing page |
| `/wallet` | Balance, transfers, splits, payments due, and activity |
| `/split/new` | Create a named or open split |
| `/pay/[splitId]` | Review and settle a shared payment request |
| `/inbox` | Requests awaiting the signed-in user |
| `/groups` | Reusable payment groups |
| `/settings` | Username, passkey, network details, faucet, and account controls |

## Deployed contracts

| Contract | Monad Testnet address |
| --- | --- |
| Agora AUSD | [`0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`](https://testnet.monadscan.com/address/0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC) |
| JanusSplit | [`0x1c3F1382057F99b5dAd89855B919bB322792C66E`](https://testnet.monadscan.com/address/0x1c3F1382057F99b5dAd89855B919bB322792C66E) |
| JanusSplitV2 | [`0xE9B9C0e09819857D8aa32b1dD749B26F58E43eD1`](https://testnet.monadscan.com/address/0xE9B9C0e09819857D8aa32b1dD749B26F58E43eD1) |
| Agora test faucet | [`0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C`](https://testnet.monadscan.com/address/0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C) |

Deployment notes are maintained in [`contracts/DEPLOYMENTS.md`](contracts/DEPLOYMENTS.md).

## Repository layout

```text
JANUS/
├─ contracts/             Solidity split contracts and mock AUSD
├─ script/                Foundry and Hardhat deployment scripts
├─ test/                  Foundry contract tests
├─ test-hardhat/          Hardhat contract tests
├─ supabase/migrations/   Database schema, indexes, profiles, and groups
├─ janus-app/             Next.js application and API routes
└─ .env.example           Environment-variable template
```

## Run locally

### Prerequisites

- Node.js 20 or newer and npm.
- A Privy application.
- A Supabase project.
- Monad Testnet RPC access.
- Foundry only if you want to compile, test, or deploy with Forge.

### 1. Install the web app

```bash
git clone https://github.com/vickman787/janusapp.git
cd janusapp/janus-app
npm install
```

Do not reinstall the dependencies one by one; `npm install` uses the committed lockfile.

### 2. Configure the environment

Copy the root template into the app:

```bash
cp ../.env.example .env.local
```

At minimum, configure these values:

```dotenv
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_MONAD_RPC_URL=https://rpc.testnet.monad.xyz
NEXT_PUBLIC_AUSD_ADDRESS=0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC
NEXT_PUBLIC_JANUS_SPLIT_CONTRACT=0x1c3F1382057F99b5dAd89855B919bB322792C66E
NEXT_PUBLIC_JANUS_SPLIT_V2_CONTRACT=0xE9B9C0e09819857D8aa32b1dD749B26F58E43eD1
NEXT_PUBLIC_AGORA_FAUCET_ADDRESS=0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C

NEXT_PUBLIC_PRIVY_APP_ID=your_privy_app_id
PRIVY_APP_ID=your_privy_app_id
PRIVY_APP_SECRET=your_server_only_privy_app_secret

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_server_only_service_role_key

# Recommended for server-side indexing and verification
QUICKNODE_RPC_URL=your_server_only_monad_rpc_url
```

Never expose `PRIVY_APP_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, a private key, or a paid RPC credential through a `NEXT_PUBLIC_` variable.

### 3. Prepare Supabase

Apply the SQL files in `supabase/migrations/` in numeric order. They create the core activity/split tables, rate limits, participant records, profiles, usernames, payments-due index, and groups.

### 4. Start development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Verify a frontend build

Run these commands from `janus-app/`:

```bash
npm run lint
npx tsc --noEmit
npm run build
npm run start
```

`npm run build` creates the optimized Next.js production bundle. `npm run start` serves that bundle locally after a successful build.

## Smart-contract development

Install the root dependencies first:

```bash
cd ..
npm install
```

Hardhat:

```bash
npm run compile
npm run test:hardhat
```

Foundry:

```bash
npm run forge:build
npm run test:forge
```

Deployments require a funded Monad Testnet deployer and a locally configured `PRIVATE_KEY`. Never commit that key.

```bash
npm run deploy:monad
npm run deploy:monad:v2
```

## Testnet notes and limitations

- JANUS currently uses Monad Testnet and test AUSD; it is not a production financial service.
- Users need a small amount of testnet MON for gas.
- A passkey can only be used after the user first signs in with email, Google, or a wallet and registers the passkey under **Settings**.
- Supabase indexing can briefly trail an already-confirmed transaction. JANUS keeps the confirmed hash visible and supports history reconciliation without asking the user to pay again.
- QR codes encode the current payer URL. Set `NEXT_PUBLIC_APP_URL` to a publicly reachable origin before sharing a QR code across devices.

## Security model

- JANUS does not hold users' private keys.
- Wallet signatures and transaction approvals remain user-controlled.
- Server APIs authenticate Privy sessions and verify relevant Monad receipts/events before persisting payment history.
- Sensitive service credentials are server-only.
- This is hackathon/testnet software and has not received a production security audit.

## License

No open-source license has been added yet. All rights are reserved by the project authors unless a license is added later.
