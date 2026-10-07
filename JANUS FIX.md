# JANUS Remediation Plan

Last updated: 2026-10-04

## Purpose

This document tracks the security, correctness, reliability, and deployment work required before JANUS can be considered safe for public use. The application is currently appropriate for a testnet demonstration only.

## Implementation progress

Completed in the first remediation pass:

- [x] Disabled all unauthenticated server-signed settlement, faucet, and split-creation routes.
- [x] Removed embedded private-key fallbacks from application and Hardhat configuration.
- [x] Added a root `.gitignore` that protects environment files and generated artifacts.
- [x] Replaced the unsafe `.env.example` private-key value with an empty placeholder.
- [x] Removed amount, memo, and organizer data from payment links.
- [x] Made the payer page load authoritative split details from the contract.
- [x] Changed split payments from direct token transfers to exact approval plus `settleSplit`.
- [x] Required confirmed `SplitCreated` and `PaymentSettled` events before server state updates.
- [x] Disabled client-authored server activity records.
- [x] Changed simulation failures and missing configuration to fail closed.
- [x] Corrected the `BatchSettled` frontend ABI.
- [x] Corrected split debtor accounting so the organizer is not expected to pay themselves.
- [x] Replaced active floating-point token transaction conversion with `parseUnits`.
- [x] Removed unused fake passkey and client-private-key hooks.
- [x] Added the accurate `SplitAlreadyExists` contract error and corrected permit documentation.
- [x] Added Privy access/identity-token verification using the app's public JWKS and protected wallet-history reads.
- [x] Corrected split activity sender/recipient direction and made verified server split state override stale local cache state.
- [x] Fixed split creation indexing to submit the verified creation receipt instead of client-authored split data.
- [x] Replaced JSON persistence with a transactional SQLite database, indexed queries, and automatic legacy-data import.
- [x] Verified Privy wallet signing with a real payment flow.
- [x] Verified linked-wallet authorization and private-history access controls with real wallets.
- [x] Added SQLite-backed IP/user rate limiting to private reads, indexing endpoints, and simulation.
- [x] Added baseline CSP, clickjacking, MIME-sniffing, referrer, permissions, and production HSTS headers.

Still required before release:

- [ ] Rotate the exposed key and revoke its allowances; this requires control of the affected wallet.
- [ ] Add production monitoring, security headers, and deployment controls.
- [ ] Generate the frontend ABI from contract artifacts.
- [ ] Complete and run the full contract, API, frontend, and end-to-end test suites.

## Priority definitions

- **P0 — Critical:** Can cause loss of funds, secret compromise, or arbitrary unauthorized transactions. Fix before any public deployment.
- **P1 — High:** Breaks payment integrity, permits forged application state, or makes the core settlement workflow unreliable.
- **P2 — Medium:** Production reliability, authentication, data consistency, and contract correctness issues.
- **P3 — Low:** Hardening, maintainability, naming, and defense-in-depth improvements.

---

## P0 — Critical security fixes

### 1. Disable unauthenticated server-wallet spending

Affected files:

- `janus-app/src/app/api/settle/route.ts`
- `janus-app/src/app/api/faucet/route.ts`
- `janus-app/src/app/api/split/create/route.ts`

Current problem:

- The routes use a server-held private key.
- `/api/settle` accepts an arbitrary recipient and amount.
- `/api/faucet` can send 0.05 MON to arbitrary addresses.
- There is no server-side authentication, authorization, replay protection, rate limiting, or spending limit.

Required fix:

- Disable these routes until a secure design is implemented.
- Prefer user-signed transactions through Privy for user actions.
- If a relayer is genuinely required, authenticate the user and verify a signed, expiring request containing the chain ID, contract, function, parameters, nonce, and intended signer.
- Add per-user, per-IP, and global rate limits.
- Add strict transaction allowlists and maximum spending limits.
- Keep relayer and faucet wallets separate from deployment/admin wallets.
- Monitor relayer balances and transaction activity.

Acceptance criteria:

- An anonymous request cannot cause any transaction.
- An authenticated user cannot select an arbitrary server-wallet transfer.
- Replaying an already accepted request fails.
- Requests for the wrong chain or contract fail.
- Faucet abuse tests confirm that configured limits are enforced.

### 2. Remove and rotate embedded private keys

Affected files:

- `janus-app/src/app/api/settle/route.ts`
- `janus-app/src/app/api/faucet/route.ts`
- `janus-app/src/app/api/split/create/route.ts`
- `hardhat.config.ts`

Required fix:

- Remove every hardcoded private-key fallback.
- Fail startup or deployment when a required key is missing.
- Never use the standard Hardhat development key on a public network.
- Rotate all keys that have appeared in source, logs, screenshots, archives, or shared files.
- Transfer assets and revoke token allowances associated with exposed keys.
- Store production secrets in the deployment platform's secret manager.
- Use separate keys for deployment, relaying, faucet operations, and administration.

Acceptance criteria:

- Searching the repository for private-key-shaped values finds no real or fallback key.
- Production cannot start a signing service without an explicitly configured secret.
- Old addresses have no valuable balances or active allowances.

### 3. Protect root environment files

Affected files:

- `.env`
- `.env.example`
- Root `.gitignore` (currently missing)

Required fix:

- Add a root `.gitignore` containing at least `.env`, `.env.*`, build artifacts, caches, and dependency directories.
- Explicitly allow `.env.example` with `!.env.example`.
- Ensure `.env.example` contains placeholders only.
- Check Git history before publishing the repository.
- Rotate any secret that was previously committed or uploaded.

Acceptance criteria:

- `git check-ignore .env` confirms that the root `.env` is ignored.
- `.env.example` remains trackable.
- Secret scanning passes in CI.

### 4. Stop trusting payment-link query parameters

Affected files:

- `janus-app/src/app/pay/[splitId]/page.tsx`
- `janus-app/src/app/split/new/page.tsx`

Current problem:

- `amount`, `memo`, and `organizer` are read from the URL.
- The URL-provided organizer becomes the actual AUSD recipient.
- Anyone can edit the link and replace the recipient or amount.

Required fix:

- Put only `splitId` in the payment link.
- Load the authoritative requester, amount per payer, status, and memo from `JanusSplit.getSplit(splitId)`.
- Reject nonexistent, cancelled, settled, or malformed splits.
- Display the full authoritative recipient with a clear confirmation step.
- Never use query-string data as transaction parameters.

Acceptance criteria:

- Editing URL parameters cannot change the transaction recipient or amount.
- The transaction always targets the requester stored in the contract.
- Invalid and inactive split IDs cannot reach the payment-signing step.

---

## P1 — Payment integrity and application-state fixes

### 5. Use `settleSplit` for split payments

Affected files:

- `janus-app/src/app/pay/[splitId]/page.tsx`
- `janus-app/src/lib/web3.ts`
- `contracts/JanusSplit.sol`

Current problem:

- The payment page calls the AUSD token's `transfer` function directly.
- `hasPaid`, `settledCount`, and split status are therefore not updated on-chain.
- Contract double-payment protection and settlement events are bypassed.

Required fix:

- Implement the appropriate approval/permit flow for AUSD.
- Call `JanusSplit.settleSplit(splitId)` for registered splits.
- Wait for a successful receipt before showing a final success state.
- Read the updated split state after confirmation.
- Reserve direct token transfers for the separate send-money feature.

Acceptance criteria:

- A successful payment sets `hasPaid(splitId, payer)` to true.
- `settledCount` increases exactly once.
- Duplicate payments revert or are prevented before signing.
- The final payment changes the split status to `Settled` and emits `SplitFullySettled`.

### 6. Verify transactions before updating off-chain state

Affected files:

- `janus-app/src/app/api/splits/pay/route.ts`
- `janus-app/src/app/pay/[splitId]/page.tsx`
- `janus-app/src/lib/serverStore.ts`

Required fix:

- Do not accept payer, amount, recipient, or status as trusted client assertions.
- Retrieve the receipt using the configured Monad RPC.
- Require a successful receipt on the expected chain.
- Decode the expected `PaymentSettled` event from the expected contract.
- Derive payer, recipient, split ID, and amount from the event.
- Make event processing idempotent using `chainId + transactionHash + logIndex`.
- Do not record a transaction before confirmation.
- Handle reorgs or define an explicit confirmation policy.

Acceptance criteria:

- Random or failed transaction hashes cannot create payment records.
- A valid transaction for another token, recipient, or split is rejected.
- Processing the same event twice does not increment settlement twice.

### 7. Authenticate and authorize data APIs

Affected files:

- `janus-app/src/app/api/splits/route.ts`
- `janus-app/src/app/api/splits/pay/route.ts`
- `janus-app/src/app/api/activity/route.ts`

Required fix:

- Verify Privy access tokens server-side.
- Derive the caller's wallet identity from the verified session rather than request JSON.
- Authorize every read and write against the derived identity.
- Prevent arbitrary overwrite of existing split and activity records.
- Validate all request bodies with a schema library.
- Add request-size limits and rate limits.
- Return generic external errors while logging detailed internal errors securely.

Acceptance criteria:

- Anonymous writes return `401`.
- Cross-wallet writes and private reads return `403`.
- Caller-supplied wallet addresses cannot impersonate another user.
- Invalid types, oversized strings, and malformed addresses return `400`.

### 8. Fix split participant semantics

Affected files:

- `janus-app/src/app/split/new/page.tsx`
- `contracts/JanusSplit.sol`
- Contract and UI tests

Current problem:

- The UI includes the organizer in `numPayers`.
- The organizer normally does not pay themselves, leaving the split permanently active.

Required fix:

- Define whether `numPayers` means all participants or only people who owe the requester.
- If it means debtors, exclude the organizer from `numPayers` and calculate each share using the intended business rule.
- If the organizer owes a share, model that explicitly instead of requiring a transfer to themselves.
- Document rounding and remainder behavior.

Acceptance criteria:

- The number of expected settlements equals the number of actual debtors.
- A normal UI-created split can reach `Settled` without the organizer paying themselves.
- Tests cover two-person, three-person, organizer-included, and non-divisible totals.

---

## P2 — Contract, simulation, and production reliability fixes

### 9. Correct or remove the relayer permit claim

Affected file:

- `contracts/JanusSplit.sol`

Current problem:

- `settleWithPermit` uses `msg.sender` as the permit owner.
- A third-party relayer cannot submit the payer's permit as documented.

Required fix:

- Either rename/document the function as payer-submitted only, or accept an explicit payer address and safely bind that payer into the permit and settlement logic.
- If supporting meta-transactions, include nonces, deadlines, chain ID, verifying contract, split ID, payer, and amount in the signed authorization.
- Add relayer and replay tests.

Acceptance criteria:

- Documentation matches actual behavior.
- A valid relayed payment succeeds if relayers are supported.
- Wrong payer, expired authorization, altered split ID, wrong chain, and replay attempts fail.

### 10. Make simulation fail closed

Affected file:

- `janus-app/src/app/api/simulate/route.ts`

Current problem:

- Missing Tenderly configuration, upstream errors, and exceptions are reported as successful simulations.

Required fix:

- Return `simulated: false` when simulation was not performed.
- Return an error or explicit warning that blocks security-sensitive approval flows.
- Validate `from`, `to`, `data`, and `value` before sending them upstream.
- Do not save arbitrary public simulations unless required.
- Authenticate and rate-limit the route to protect Tenderly quota.

Acceptance criteria:

- Network and provider failures cannot be displayed as a successful preflight.
- Callers can distinguish successful simulation, reverted simulation, and unavailable simulation.

### 11. Replace JSON-file persistence

Affected files:

- `janus-app/src/lib/serverStore.ts`
- `janus-app/data/janus_store.json`

Required fix:

- Move durable state to a transactional database.
- Use unique constraints for split IDs and indexed event identities.
- Make writes atomic and idempotent.
- Store chain-derived facts separately from user-editable metadata.
- Add migrations, backups, retention rules, and access controls.
- Do not commit live user data.

Suggested minimum tables:

- `splits`: split ID, chain ID, contract, requester, total amount, payer count, status, creation transaction.
- `payments`: chain ID, transaction hash, log index, split ID, payer, recipient, amount, block number.
- `activities`: user address, event reference, display metadata, timestamps.

Acceptance criteria:

- Concurrent writes do not lose data.
- Multiple server instances see the same state.
- Restarting or redeploying the app does not erase records.
- Duplicate chain events cannot create duplicate payments.

### 12. Remove or isolate the fake passkey implementation

Affected file:

- `janus-app/src/hooks/useMeraAuth.ts`

Required fix:

- Remove the hook if Privy is the supported authentication system.
- Otherwise replace it with a complete, reviewed WebAuthn server challenge and verification flow.
- Never consider local-storage flags proof of authentication.
- Never fall back to public credential IDs as secret key material.
- Never expose a placeholder signature as if it were valid ECDSA.

Acceptance criteria:

- Production contains only one clearly supported authentication path.
- Authentication requires server-verified proof.
- No fake signature API is reachable from production code.

### 13. Fix frontend/contract ABI drift

Affected file:

- `janus-app/src/lib/web3.ts`

Required fix:

- Correct `BatchSettled` to match the contract event, which does not include `memo`.
- Generate the frontend ABI from contract build artifacts instead of maintaining it manually.
- Add CI that rebuilds artifacts and detects stale generated files.

Acceptance criteria:

- Every frontend ABI function and event exactly matches the deployed contract.
- Event decoding tests pass using real contract receipts.

### 14. Use exact token amount parsing

Affected files:

- `janus-app/src/app/page.tsx`
- `janus-app/src/app/pay/[splitId]/page.tsx`
- `janus-app/src/app/split/new/page.tsx`
- API routes that parse amounts

Required fix:

- Replace `parseFloat`, multiplication, and `Math.round` with `parseUnits(value, 6)`.
- Format balances using `formatUnits` instead of converting `bigint` to `Number`.
- Enforce maximum values and no more than six decimal places.
- Reject `Infinity`, exponent notation if unsupported, negative values, and malformed strings.

Acceptance criteria:

- Large balances do not lose precision.
- Decimal edge cases produce exact base-unit values.
- Invalid values return clear validation errors.

### 15. Add strict address and identifier validation

Affected areas:

- All API routes
- Payment and send forms
- Contract-address environment configuration

Required fix:

- Use Viem's `isAddress` and normalize with `getAddress`.
- Validate transaction hashes and `bytes32` split IDs by exact length and hex format.
- Reject zero addresses where inappropriate.
- Validate configured chain and contract addresses at startup.

Acceptance criteria:

- Values that merely begin with `0x` are not accepted.
- Invalid configuration stops startup with a clear message.

---

## P3 — Hardening and maintainability

### 16. Add security headers

Affected file:

- `janus-app/next.config.ts`

Add and test:

- Content Security Policy appropriate for Privy and required RPC/API hosts.
- `X-Content-Type-Options: nosniff`.
- `Referrer-Policy`.
- `Permissions-Policy`.
- Clickjacking protection using CSP `frame-ancestors`.
- HSTS on production HTTPS deployments.

### 17. Correct contract errors and edge cases

Affected file:

- `contracts/JanusSplit.sol`

Required fix:

- Replace the duplicate-ID `SplitDoesNotExist` revert with an accurate error such as `SplitAlreadyExists`.
- Decide whether empty memos are permitted; remove unused `EmptyMemo` or enforce it.
- Decide how division remainders are handled and expose the exact expected amounts.
- Document whether any wallet may count as a payer or whether an allowlist of participants is required.
- Consider OpenZeppelin `SafeERC20` if tokens other than the fixed trusted AUSD may ever be used.
- Remove unused owner state if no owner functionality is intended.

### 18. Add rate limits and abuse controls

Apply to all API routes, especially:

- Faucet requests.
- Transaction simulation.
- Activity and split writes.
- RPC-backed reads.

Include:

- Per-IP and per-authenticated-wallet limits.
- Global emergency limits.
- Request body-size limits.
- Structured audit logging.
- Metrics and alerts for unusual transaction volume or repeated failures.

### 19. Improve error handling and logging

Required fix:

- Do not return raw provider or exception messages to clients.
- Assign request IDs and log structured errors server-side.
- Redact secrets, authorization headers, signed payloads, and RPC credentials.
- Distinguish validation errors, authentication failures, authorization failures, upstream failures, and internal errors.
- Avoid globally replacing `console.error` in `providers.tsx`.

### 20. Remove dead or duplicate code paths

Review and consolidate:

- The unused `useMeraAuth` implementation.
- Server-signed split creation versus Privy user-signed creation.
- Server settlement versus direct user transfers versus contract settlement.
- Local-storage activity state versus server state versus on-chain events.

Target architecture:

1. Privy authenticates the user and provides the user's wallet.
2. The user signs all payment and split transactions.
3. The contract is the authority for split and payment state.
4. A backend indexer verifies contract events and stores query-friendly projections.
5. Local storage is only an optional cache, never an authority.

---

## Testing work required

### Smart-contract tests

- Duplicate split IDs.
- Empty and zero split IDs if disallowed.
- Non-divisible totals and remainder behavior.
- Organizer/debtor accounting.
- Failed token transfers and complete state rollback.
- Reentrancy assumptions or trusted-token documentation.
- Permit success, expiration, altered parameters, wrong signer, replay, and relayer behavior.
- Cancellation before and after partial settlement.
- Fuzz tests for amounts, payer counts, and settlement order.
- Invariant: `settledCount <= numPayers`.
- Invariant: a payer can settle at most once per split.

### API tests

- Anonymous access returns `401` for protected routes.
- Cross-wallet access returns `403`.
- Invalid JSON, addresses, hashes, IDs, and amounts return `400`.
- Forged, failed, unrelated, and wrong-chain transactions are rejected.
- Valid settlement events are recorded once.
- Rate limits and body-size limits are enforced.
- Missing secrets cause safe startup failure.
- Provider failure never returns a false success result.

### Frontend tests

- Payment pages derive recipient and amount from the contract.
- Modified query parameters have no transaction effect.
- Cancelled, settled, and nonexistent splits are blocked.
- Success appears only after a successful receipt.
- Failed and rejected wallet transactions are not recorded as paid.
- Exact six-decimal parsing and formatting.
- Wrong-network handling and network switching.

### End-to-end test

1. Organizer signs `createSplit`.
2. The receipt is confirmed and indexed.
3. A payer opens a link containing only the split ID.
4. The app reads authoritative split data from the contract.
5. The payer approves or permits the exact AUSD amount.
6. The payer signs `settleSplit`.
7. The backend indexes the confirmed `PaymentSettled` event.
8. Duplicate settlement is rejected.
9. The final expected payment marks the split settled.

---

## CI and deployment checklist

- [ ] Root dependencies install from a lockfile.
- [ ] Frontend dependencies install with `npm ci`.
- [ ] TypeScript check passes.
- [ ] ESLint passes.
- [ ] Next.js production build passes.
- [ ] Hardhat tests pass.
- [ ] Foundry tests and fuzz tests pass.
- [ ] Contract ABI generation is reproducible.
- [ ] Dependency vulnerability audit passes or findings are reviewed.
- [ ] Secret scanning passes.
- [ ] Static contract analysis runs, such as Slither.
- [ ] No `.env`, private keys, live user data, build output, or broadcast secrets are committed.
- [ ] Contract addresses and chain IDs are validated per environment.
- [ ] Security headers are verified in the deployed application.
- [ ] Rate limits are tested in staging.
- [ ] Relayer and faucet wallets contain only limited operational funds.
- [ ] Monitoring and an emergency shutdown procedure are documented.

## Recommended implementation order

1. Disable dangerous server-signing endpoints.
2. Remove and rotate embedded keys; protect environment files.
3. Make payment links contain only a split ID.
4. Change payments to call `settleSplit` with authoritative on-chain parameters.
5. Verify confirmed contract events before writing off-chain state.
6. Add server-side Privy authentication and authorization.
7. Replace JSON persistence with a transactional database/indexer.
8. Correct participant accounting, permit behavior, ABI drift, and amount parsing.
9. Add abuse controls, security headers, and structured logging.
10. Complete automated contract, API, frontend, and end-to-end tests.

## Release gate

Do not deploy JANUS publicly or fund any server-controlled wallet until every P0 item is complete. Do not represent off-chain payment status as authoritative until P1 transaction verification and contract settlement integration are complete.
