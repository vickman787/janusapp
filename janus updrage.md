# JANUS Upgrade Plan

## Recommended implementation order

### 1. Finish participant tracking

Show payment progress on every split:

- `1 of 3 paid`
- Wallets that have paid
- Number of participants still unpaid
- `Active` until everyone pays
- `Settled` when all participants pay

Needed:

- Store expected participant wallets.
- Store each payment against a split and wallet.
- Display payer status on the dashboard.

### 2. Add clear payment states and errors

Show clear progress during payment:

- Preparing payment
- Waiting for wallet approval
- Approving AUSD
- Confirming transaction
- Payment successful
- Payment failed

Needed:

- Transaction state in the payer page.
- Retry and cancel actions.
- Human-readable wallet and RPC errors.

### 3. Add QR-code payer links

Allow the creator to display or share a QR code for the existing payer link:

```text
/pay/{splitId}
```

Needed:

- QR-code generation package.
- QR modal or card.
- Copy and native share buttons.

### 4. Add usernames

Let users register a unique username after connecting their wallet.

Example:

```text
@alice → 0xB6F2...269E
```

Needed database table:

```text
profiles
- wallet_address
- username
- created_at
```

Rules:

- Usernames are unique case-insensitively.
- Usernames are resolved to wallet addresses server-side.
- Payments still settle to wallet addresses.
- Store the username snapshot on each split.

### 5. Add analytics

Display:

- Total splits created
- Total AUSD settled
- Paid and pending splits
- Number of successful payments

Needed:

- Supabase aggregate queries or reporting views.
- A small analytics section on the dashboard.

### 6. Add notifications

Notify the creator when a participant pays.

Possible first version:

- In-app notification banner.
- Refresh indicator.
- Recent payment activity.

Later options:

- Supabase Realtime.
- Email notifications.
- Push notifications.

## Remaining polish upgrades

- Mobile responsiveness.
- Better empty states.
- Retry buttons for failed reads.
- Transaction explorer links.
- Demo mode with sample data.
- Security and rate-limit review.
- Automated frontend, API, and end-to-end tests.

## Suggested hackathon scope

Complete items 1–3 first. Add usernames if time allows. Leave analytics and external notifications for the final polish phase.
