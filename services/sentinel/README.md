# PledgeCash identity service

The retained Sentinel service is the PledgeCash product identity boundary. It
owns product sessions, delegates canonical social and wallet credentials to
peezy.tech Identity, and maintains local wallet-link records.
It does not watch chains, analyze protocol actions, or deliver notifications.

## Requirements

- Bun 1.3+
- Postgres 15+
- A unique 32-byte-or-longer Better Auth secret
- A peezy.tech Identity application with distinct API and OIDC credentials

Copy `.env.example`, then run:

```sh
bun --cwd services/sentinel dev
```

The service applies Drizzle migrations before listening. `GET /health` verifies
database reachability. Product clients use `/auth/*` for sessions and
`/wallets/*` for wallet-link challenges and proofs.

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string. |
| `SENTINEL_PORT` | no | HTTP port, default `8787`. |
| `SENTINEL_WEB_ORIGIN` | yes | Exact browser origin accepted by CORS and SIWE. |
| `SENTINEL_TRUSTED_PROXY_IPS` | when Sentinel is served over HTTPS | Exact trusted edge peers used to resolve client addresses. |
| `BETTER_AUTH_SECRET` | yes | Product-session signing secret. |
| `BETTER_AUTH_URL` | yes | Exact public origin of this service. |
| `PEEZY_IDENTITY_URL` | yes | Shared Identity origin. HTTPS is required outside loopback development. |
| `PEEZY_IDENTITY_CLIENT_ID` | yes | Identity client identifier. |
| `PEEZY_IDENTITY_APP_CLIENT_SECRET` | yes | Confidential Identity API secret. |
| `PEEZY_IDENTITY_OIDC_CLIENT_SECRET` | yes | Distinct OIDC exchange secret. |

Shared Identity is authoritative for credential ownership. Local `authWallets`,
`walletOwners`, and `wallets` rows bind those credentials to one PledgeCash
product user; a wallet address cannot cross product principals. Identity issues
wallet-link challenges and grants, while Sentinel enforces bounded SIWE messages,
per-client quotas, reconciliation, and advisory locks around ownership changes.

## Validation

```sh
bun --cwd services/sentinel test
bun --cwd services/sentinel typecheck
```

Set `SENTINEL_AUTH_TEST_DATABASE_URL` to run the Postgres integration suites.
Set the peezy.tech Identity integration variables referenced by the tests to run
the shared-Identity compatibility suite.
