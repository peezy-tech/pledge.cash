FROM oven/bun:1 AS build

WORKDIR /app

# Cache packages
COPY package.json package.json
COPY bun.lock bun.lock

COPY /apps/api/package.json ./apps/api/package.json
COPY /packages/db/package.json ./packages/db/package.json
COPY /apps/web/package.json ./apps/web/package.json

RUN bun install

COPY /apps/api ./apps/api
COPY /packages/db ./packages/db
COPY /apps/web ./apps/web
# COPY /apps/api/public ./apps/api/public


ENV NODE_ENV=production

# Build web app
WORKDIR /app/apps/web
RUN bun run build

# Move web dist to api public folder
# RUN mkdir -p /app/apps/api/public
# RUN cp -r /app/apps/web/dist/* /app/public/
COPY /apps/web/dist /app/public

# Reset workdir
WORKDIR /app


RUN bun build \
	--compile \
	--minify-whitespace \
	--minify-syntax \
	--target bun \
	--outfile server \
	./apps/api/src/index.ts



# FROM gcr.io/distroless/base

WORKDIR /app

# COPY --from=build /app/server server
# COPY /apps/api/public /app/public

ENV NODE_ENV=production

CMD ["./server"]

EXPOSE 3000