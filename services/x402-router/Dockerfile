FROM oven/bun:1.3.11 AS deps

WORKDIR /app

COPY package.json bun.lock tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY docs/package.json docs/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY services/sentinel/package.json services/sentinel/package.json
COPY services/x402-router/package.json services/x402-router/package.json

RUN bun install --frozen-lockfile

FROM deps AS verify

COPY packages/sdk packages/sdk
COPY services/x402-router services/x402-router

RUN bun run --cwd services/x402-router test

FROM oven/bun:1.3.11 AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=verify /app/node_modules node_modules
COPY package.json bun.lock tsconfig.base.json ./
COPY packages/sdk packages/sdk
COPY services/x402-router services/x402-router
COPY --from=verify /app/packages/sdk/node_modules packages/sdk/node_modules
COPY --from=verify /app/services/x402-router/node_modules services/x402-router/node_modules

RUN chmod a+rx . packages packages/sdk services services/x402-router \
  && chmod a+r package.json bun.lock tsconfig.base.json \
  && chmod -R a+rX packages/sdk services/x402-router

USER bun
EXPOSE 8788

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "const port = process.env.X402_ROUTER_PORT ?? '8788'; const response = await fetch(`http://127.0.0.1:${port}/health/live`); if (!response.ok) process.exit(1);"]

CMD ["bun", "run", "--cwd", "services/x402-router", "src/index.ts"]
