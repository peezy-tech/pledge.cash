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

# build server
WORKDIR /app
RUN bun build \
	--compile --minify-whitespace --minify-syntax \
	--target bun --outfile server \
	./apps/api/src/index.ts

# ---------- runtime stage ----------
FROM oven/bun:1 AS runtime
WORKDIR /app

# pull compiled server + deps
COPY --from=build /app/server        ./server
COPY --from=build /app/node_modules  ./node_modules
COPY --from=build /app/apps/web/dist ./public

ENV NODE_ENV=production
EXPOSE 3000
CMD ["./server"]
