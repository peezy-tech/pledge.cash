# ---------- build stage ----------
FROM oven/bun:1 AS build
WORKDIR /app

# install deps
COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN bun install

# copy sources
COPY apps/api ./apps/api
COPY packages/db ./packages/db
COPY apps/web ./apps/web

# build web
WORKDIR /app/apps/web
RUN bun run build

# ---------- runtime stage ----------
FROM oven/bun:1 AS runtime
WORKDIR /app

# pull compiled server + deps
# COPY --from=build /app/server        ./server
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/bun.lock     ./bun.lock
COPY --from=build /app/node_modules  ./node_modules
COPY --from=build /app/apps/api      ./apps/api
COPY --from=build /app/packages/db   ./packages/db
COPY --from=build /app/apps/web/dist ./apps/api/public

ENV NODE_ENV=production
EXPOSE 3000
CMD ["bun", "run", "apps/api/src/index.ts"]
