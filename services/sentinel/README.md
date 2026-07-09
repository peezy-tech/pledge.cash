# pledge.cash Sentinel

Sentinel is the off-chain governance monitoring and notification service for pledge.cash. This package currently contains the WP0 contracts shared by the watcher, risk engine, harness, API, notification, and web UI work packages.

## Local Commands

```sh
bun --cwd services/sentinel test
bun --cwd services/sentinel drizzle:generate
```

Copy `.env.example` to `.env` for local runtime work. The full runtime assembly is intentionally deferred to the integration work package.
