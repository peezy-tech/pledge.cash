# pledge.cash Sentinel

Sentinel is a self-hosted off-chain monitor for pledge.cash Boardroom governance. It discovers each canonical external controller, stores scheduled Boardroom and controller-self operations in Postgres with generation and epoch context, classifies risk, writes deterministic or harness-assisted analysis, exposes a Hono HTTP API, and sends notifications through configured channels.

## Prerequisites

- Bun 1.3.11.
- Postgres 15 or newer.
- A 32+ character Better Auth secret for PledgeCash product sessions.
- A deployed peezy.tech Identity provider and two distinct confidential client
  secrets for shared identity mode.
- A Telegram bot from BotFather for private alerts.
- Optional: `claude` or `codex` on `PATH` with its own host-level authentication for harness analysis.
- Optional: Twitter API credentials for public high-risk alerts.

## Configuration

Copy `.env.example` and set values for your environment.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string used by Drizzle migrations and runtime queries. |
| `SENTINEL_PORT` | no | API port, default `8787`. |
| `SENTINEL_WEB_ORIGIN` | yes | Browser app origin allowed by CORS and SIWE wallet-link messages. |
| `SENTINEL_CHAIN_IDS` | yes | Comma-separated chain ids to monitor. |
| `SENTINEL_RPC_URL_<chainId>` | yes | RPC URL for each configured chain. |
| `SENTINEL_CONFIRMATIONS_<chainId>` | no | Confirmation lag per chain, default `5`, local chain `31337` default `0`. |
| `SENTINEL_POLL_INTERVAL_MS` | no | Watcher loop delay, default `12000`. |
| `SENTINEL_MAX_BLOCK_RANGE` | no | Maximum block span per watcher pass, capped at and defaulting to `1000` for the public HyperEVM testnet RPC. |
| `SENTINEL_EXPLORER_URL_<chainId>` | no | Explorer base URL used in rendered notifications. |
| `BETTER_AUTH_SECRET` | yes | Unique 32+ character secret used to protect self-hosted auth state and tokens. |
| `BETTER_AUTH_URL` | yes | Public Sentinel API origin. Better Auth is mounted at `/auth`. |
| `PEEZY_IDENTITY_URL` | yes in shared mode | Bare origin of the shared peezy.tech Identity provider. |
| `PEEZY_IDENTITY_CLIENT_ID` | yes in shared mode | Registered Identity application and OIDC client identifier. |
| `PEEZY_IDENTITY_APP_CLIENT_SECRET` | yes in shared mode | Confidential secret for wallet grants, user profiles, and social-link handoffs. |
| `PEEZY_IDENTITY_OIDC_CLIENT_SECRET` | yes in shared mode | Separate confidential secret for the OIDC authorization-code exchange. |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | legacy mode only | Enables Sentinel-owned Discord sign-in when shared Identity is not configured. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | legacy mode only | Enables Sentinel-owned GitHub sign-in when shared Identity is not configured. |
| `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET` | legacy mode only | Enables Sentinel-owned X sign-in; separate from Twitter notification credentials. |
| `TELEGRAM_OAUTH_CLIENT_ID`, `TELEGRAM_OAUTH_CLIENT_SECRET` | legacy mode only | Enables Sentinel-owned Telegram OIDC sign-in; separate from the notification bot token. |
| `APPLE_CLIENT_ID`, `APPLE_CLIENT_SECRET` | legacy mode only | Enables Sentinel-owned Apple sign-in. |
| `SENTINEL_HARNESS` | no | `claude`, `codex`, or `none`; default `claude`. |
| `SENTINEL_HARNESS_CMD` | no | Harness binary override. |
| `SENTINEL_HARNESS_MODEL` | no | Model label passed to the harness adapter. |
| `SENTINEL_HARNESS_WORKDIR` | no | Temporary workspace root for analysis runs. |
| `SENTINEL_HARNESS_TIMEOUT_MS` | no | Per-analysis deadline, default `300000`. |
| `SENTINEL_HARNESS_DAILY_LIMIT` | no | Maximum reserved harness runs per UTC day, default `50`; excess uses templates. |
| `SENTINEL_HARNESS_BOARDROOM_ALLOWLIST` | no | Comma-separated boardrooms allowed to use the harness without subscribers. |
| `SENTINEL_REMINDER_HOURS_BEFORE_ETA` | no | Send one reminder per channel inside this pre-eta window, default `24`. |
| `TELEGRAM_BOT_TOKEN` | yes for Telegram | Bot token used for long polling and message sends. |
| `TELEGRAM_BOT_USERNAME` | yes for linking | Bot username used to create deep links. |
| `SENTINEL_TWITTER_ENABLED` | no | Set `1` to enable Twitter delivery. |
| `TWITTER_API_KEY`, `TWITTER_API_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_TOKEN_SECRET` | yes for Twitter | Credentials for the optional Twitter channel. |

Harness credentials such as API keys or CLI logins belong to the host environment. Sentinel passes only the configured command/model/workdir settings.

In shared identity mode, peezy.tech Identity is canonical for the stable user
subject and all social and wallet credentials. An account may be created with a
social provider and remain walletless; PledgeCash asks for a wallet only when a
wallet-dependent feature requires one. The existing in-page SIWE sign-in and
wallet-link routes remain unchanged, and every explicitly linked EOA wallet can
sign into the same subject. PledgeCash stores a local product shadow of that
subject for its existing relational data and continues to own product sessions,
alert coverage, delivery channels, subscriptions, and roles. Social and email
matches never implicitly merge accounts. New wallet proofs are written only to
Identity; Sentinel records the separate per-chain alert coverage row and does
not mirror a second local sign-in credential.

PledgeCash product sessions keep their existing local expiry and revocation
semantics. Disabling an Identity account prevents new central sign-ins,
credential links, and handoffs, but v0.1 does not synchronously revoke a
PledgeCash session that was already issued. A future back-channel revocation
event can shorten that window without putting Identity on every product request.
If Identity is temporarily unavailable, existing product sessions and local
alert state remain readable; starting a new central sign-in or credential link
requires Identity to recover.

When `PEEZY_IDENTITY_*` is entirely unset, Sentinel retains its previous
wallet-first, self-hosted implementation as a rollback-compatible legacy mode.
In either mode, alert coverage is separate from sign-in credentials. Ordinary
sign-in and wallet linking remain EOA-only. ERC-1271 Boardroom control uses the
separate chain-scoped flow below and never creates a wallet credential. Better
Auth organization creation and UI remain disabled; an existing organization
membership can be named as the destination of a Boardroom-control proof.

`POST /boardroom-control/challenges` creates an exactly serialized, five-minute SIWE challenge for one scope and one user or organization destination. `POST /boardroom-control/claims` accepts only the server nonce and controller signature. Sentinel re-resolves the v5 canonical Boardroom/controller topology and calls controller ERC-1271 at one pinned finalized block, rechecks the block hash, and atomically consumes the nonce with claim creation. Claims are audit receipts, not reusable authorization: every privileged Boardroom write must repeat the fresh challenge and proof flow. Unknown chains, legacy or incomplete release identities, changed controller generations or configuration epochs, malformed RPC results, and finality uncertainty fail closed.

Signed-in accounts can read their own keyset-paginated delivery receipts from `GET /notifications`. The response exposes safe operational state and action context, but never returns raw provider errors, chat identifiers, credentials, or another account's rows. A `sent` receipt means the provider accepted the send; it does not prove that a person read it.

Shared mode registers `${BETTER_AUTH_URL}/auth/oauth2/callback/peezy` as the
PledgeCash OIDC redirect URI. Social-provider callbacks terminate at the
Identity provider, and Telegram authentication still does not grant alert
delivery access, which remains an explicit bot-linking step.

In legacy mode, built-in OAuth provider callbacks use
`${BETTER_AUTH_URL}/auth/callback/<provider>`. Telegram uses
`${BETTER_AUTH_URL}/auth/oauth2/callback/telegram`; keep the BotFather Web Login
signing algorithm at its `RS256` default.

## Local Commands

```sh
bun install --frozen-lockfile
bun --cwd services/sentinel test
bun --cwd services/sentinel dev
```

The runtime applies checked-in Drizzle migrations on startup.

For local Anvil verification with a disposable Postgres database:

```sh
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres \
bun --cwd services/sentinel integration:anvil
```

The harness deploys and seeds v5 locally, advances Anvil finality, proves a real EOA-proposer controller signature
through the challenge/claim API, rejects nonce replay, and then exercises scheduled, vetoed, and policy-admin watcher
flows against the same temporary database.

## Docker

Build a generic image:

```sh
docker build -f services/sentinel/Dockerfile -t pledge-cash-sentinel .
```

Optionally install a harness CLI in the image:

```sh
docker build \
  -f services/sentinel/Dockerfile \
  --build-arg SENTINEL_HARNESS_CLI=claude \
  -t pledge-cash-sentinel .
```

Run with your own Postgres and environment file:

```sh
docker run --rm --env-file .env -p 8787:8787 pledge-cash-sentinel
```

Sentinel does not require deployment-specific files in this repository. Provide networking, TLS, persistence, backups, and process supervision in your own hosting environment.

The static web app remains Sentinel-free unless its build receives `VITE_SENTINEL_API_URL`. For
GitHub Pages, set that repository variable only after the API is deployed and healthy; the Pages
workflow probes its `/health` endpoint before building or deploying an enabled UI.
