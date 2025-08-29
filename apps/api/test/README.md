API E2E Test Suite

Preconditions
- API dev server running at http://localhost:3000 (bun run dev from apps/api)
- OPERATOR_PRIVATE_KEY set to a funded Hyperliquid testnet key
- On-chain seed prepared: run one of
  - bun scripts/src/seed_onchain.ts (preferred)
  - bun scripts/src/update_cache_from_db.ts (if DB already populated)
- seed_onchain.cache.json present at scripts/seed_onchain.cache.json

Run
- Unit only: cd apps/api && bun run test:unit
- E2E only: cd apps/api && bun run test:e2e
- All (E2E auto-skips without RUN_E2E): cd apps/api && bun test

What gets tested (E2E)
- Spot tokens cache endpoint (gracefully handles 503 if not ready)
- Normalized payments listing
- Invoice create -> on-chain send -> confirm -> payment recorded
- Recurring plan run (fallback to invoice) and autopay via pledge wallet
- Pledge campaigns/pledges: create, prepare, on-chain send, confirm
- Donations: on-chain send -> record -> list + payments

Auth
- Tests mint SIWE cookies by signing a HS256 JWT with secret "foo" to simulate sessions for specific addresses from the seed cache (creator, pledge user, operator).
