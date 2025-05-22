FROM oven/bun:1 AS build

WORKDIR /app

# Cache packages
COPY package.json package.json
COPY bun.lockb bun.lockb

COPY /apps/api/package.json ./apps/api/package.json
COPY /packages/db/package.json ./packages/db/package.json

RUN bun install

COPY /apps/api ./apps/api
COPY /packages/db ./packages/db

ENV NODE_ENV=production

RUN bun build \
	--compile \
	--minify-whitespace \
	--minify-syntax \
	--target bun \
	--outfile server \
	./apps/api/src/index.ts

FROM gcr.io/distroless/base

WORKDIR /app

COPY --from=build /app/server server

ENV NODE_ENV=production

CMD ["./server"]

EXPOSE 3000