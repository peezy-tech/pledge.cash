# ---------- build stage ----------
FROM oven/bun:1 AS build
WORKDIR /app

# install deps
COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/evm/package.json ./packages/evm/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY scripts/package.json ./scripts/package.json
RUN bun install

# copy sources
COPY apps/api ./apps/api
COPY packages/db ./packages/db
COPY packages/evm ./packages/evm
COPY apps/web ./apps/web
COPY scripts ./scripts

# build web
WORKDIR /app/apps/web
ARG VITE_BASE_DOMAIN
ENV VITE_BASE_DOMAIN=${VITE_BASE_DOMAIN}
RUN bun run build

# ---------- runtime stage ----------
FROM oven/bun:1 AS runtime
WORKDIR /app

# pull compiled server + depsw
# COPY --from=build /app/server        ./server
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/bun.lock     ./bun.lock
COPY --from=build /app/node_modules  ./node_modules
COPY --from=build /app/apps/api      ./apps/api
COPY --from=build /app/packages/db   ./packages/db
COPY --from=build /app/apps/web/dist ./public
COPY --from=build /app/apps/web/dist ./apps/api/public
COPY --from=build /app/scripts ./scripts

ENV NODE_ENV=production
EXPOSE 3000
CMD ["bun", "run", "apps/api/src/index.ts"]
