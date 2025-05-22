FROM oven/bun:1

# Set the working directory for the application
WORKDIR /app

# Create a non-root user and group first
USER root
RUN groupadd --gid 1001 nodeuser && \
    useradd --uid 1001 --gid nodeuser --shell /bin/bash --create-home nodeuser

# Copy the application's package.json
COPY package.json ./

# Copy the monorepo's lockfile from the root
# This assumes your Docker build context is the root of the monorepo.
# If your context is apps/web, this path needs to be ../../bun.lockb
# For Docker build context as apps/web, it should be:
# COPY ../bun.lockb ./
# If bun.lockb is not found, bun install will not use --frozen-lockfile effectively.

# Install dependencies using the lockfile
# Bun will automatically use bun.lockb if present in the workdir
RUN bun install --frozen-lockfile

# Install serve globally
RUN bun add -g serve

# Copy all source files for the specific application (apps/web)
COPY . .

# Build the application
RUN bun run build

# Set environment variables
ARG COMMIT_HASH=local
ENV COMMIT_HASH=${COMMIT_HASH:-local} \
    NODE_ENV=production

# Change ownership of app files to the non-root user
RUN chown -R nodeuser:nodeuser /app

# Expose the port (vite preview default is 4173)
EXPOSE 4173

USER nodeuser

# Start the application using the 'serve' script (vite preview)
CMD ["serve", "-s", "dist", "-l", "tcp://0.0.0.0:4173"] 