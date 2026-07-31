FROM oven/bun:1.3.11 AS deps

WORKDIR /app

COPY package.json bun.lock tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY docs/package.json docs/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY services/sentinel/package.json services/sentinel/package.json

RUN bun install --frozen-lockfile

FROM deps AS verify

COPY packages/sdk packages/sdk
COPY services/sentinel services/sentinel

RUN bun --cwd services/sentinel typecheck

FROM oven/bun:1.3.11 AS runtime

ARG SENTINEL_HARNESS_CLI=none

WORKDIR /app
ENV NODE_ENV=production

RUN if [ "$SENTINEL_HARNESS_CLI" = "claude" ]; then \
      bun add --global @anthropic-ai/claude-code; \
    elif [ "$SENTINEL_HARNESS_CLI" = "codex" ]; then \
      bun add --global @openai/codex; \
    elif [ "$SENTINEL_HARNESS_CLI" != "none" ]; then \
      echo "SENTINEL_HARNESS_CLI must be one of: none, claude, codex" >&2; \
      exit 1; \
    fi

COPY --from=deps /app/node_modules node_modules
COPY package.json bun.lock tsconfig.base.json ./
COPY docs docs
COPY packages/sdk packages/sdk
COPY services/sentinel services/sentinel
COPY --from=deps /app/packages/sdk/node_modules packages/sdk/node_modules
COPY --from=deps /app/services/sentinel/node_modules services/sentinel/node_modules

RUN chmod a+rx . docs packages packages/sdk services services/sentinel \
  && chmod a+r package.json bun.lock tsconfig.base.json \
  && chmod -R a+rX docs packages/sdk services/sentinel

USER bun
EXPOSE 8787

CMD ["bun", "--cwd", "services/sentinel", "src/index.ts"]
