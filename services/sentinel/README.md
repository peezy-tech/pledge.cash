# pledge.cash Sentinel

Sentinel is a self-hosted off-chain monitor for pledge.cash Boardroom governance. It watches configured chains, stores queued actions in Postgres, classifies risk, writes deterministic or harness-assisted analysis, exposes a Hono HTTP API, and sends notifications through configured channels.

## Prerequisites

- Bun 1.3.11.
- Postgres 15 or newer.
- A WorkOS AuthKit app for account sessions.
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
| `SENTINEL_MAX_BLOCK_RANGE` | no | Maximum block span per watcher pass, default `2000`. |
| `SENTINEL_EXPLORER_URL_<chainId>` | no | Explorer base URL used in rendered notifications. |
| `WORKOS_API_KEY` | yes for auth | WorkOS API key. |
| `WORKOS_CLIENT_ID` | yes for auth | WorkOS client id. |
| `WORKOS_COOKIE_PASSWORD` | yes for auth | WorkOS sealed-session cookie password. |
| `WORKOS_REDIRECT_URI` | yes for auth | AuthKit callback URL ending in `/auth/callback`. |
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
