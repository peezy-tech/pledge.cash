---
name: verify-web-runtime
description: Build and visually verify the pledge.cash web app against local Anvil under the /pledge-cash/ base path.
---

# Web runtime verification

1. Confirm local Anvil is available on `127.0.0.1:8547` with chain ID `31337`.
2. Build the current app:
   ```sh
   bun --cwd apps/web build:local
   ```
3. Start a fresh preview after every rebuild; an already-running Vite preview may retain a stale asset manifest:
   ```sh
   VITE_BASE_PATH=/pledge-cash/ apps/web/node_modules/.bin/vite preview \
     --host 127.0.0.1 --port 5287 \
     --outDir "$PWD/apps/web/dist-local" \
     --config "$PWD/apps/web/vite.config.ts"
   ```
4. Drive the real browser surface with installed Chrome. Give RPC-backed routes time to hydrate:
   ```sh
   google-chrome --headless=new --no-sandbox --disable-gpu \
     --window-size=1440,1200 --virtual-time-budget=18000 \
     --screenshot=/path/to/evidence.png \
     'http://127.0.0.1:5287/pledge-cash/explore?chain=31337'
   ```
5. Use `--dump-dom` on Explore to obtain current canonical project/grant routes before opening them. Verify at least:
   - local/testnet environment disclosure
   - pending-network and Alerts-unavailable states
   - Explore market metrics and query/filter preservation
   - one AMM project Overview and Participate route
   - one canonical grant route with project return context
   - a narrow/mobile capture and one malformed or unsupported route probe

Do not treat a screenshot as valid if it is blank. If application assets return the SPA HTML instead of JavaScript, start a fresh preview on a new port.
