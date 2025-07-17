# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Turborepo monorepo for drama.haus, containing:
- **Web App** (`/apps/web`): React 19 + Vite frontend with 3D avatars and Solana integration
- **API App** (`/apps/api`): Elysia (Bun) backend with JWT auth and Docker support

## Essential Commands

### Development
```bash
# Install dependencies (uses Bun)
bun install

# Start all apps in development mode
bun dev

# Start specific app
cd apps/web && bun dev    # Web on http://localhost:3000
cd apps/api && bun dev    # API on http://localhost:3005

# Build all apps
bun build

# Lint and format
bun lint          # Run ESLint across workspaces
bun format        # Prettier format all files
cd apps/web && bun check  # Run both ESLint and Prettier for web app
```

### Testing
```bash
# Web app tests (uses Vitest)
cd apps/web && bun test
```

### Docker (API only)
```bash
bun docker:build  # Build Docker image
bun docker:tag    # Tag as latest
bun docker:push   # Push to Docker Hub
```

## Architecture

### Web App (`/apps/web`)
- **Routing**: TanStack Router with code-based routing in `/src/routes/`
- **State**: TanStack Query for server state management
- **UI Components**: Shadcn UI pattern in `/src/components/ui/`
  - Add new components: `bun shadcn@latest add <component>`
- **3D/VRM**: Avatar system using Three.js and React Three Fiber
- **API Communication**: Uses `/src/utils/api.ts` for backend calls
- **Path Alias**: `@/*` maps to `./src/*`

### API App (`/apps/api`)
- **Framework**: Elysia with plugins for CORS, JWT, OAuth2, static serving
- **Entry**: `/src/index.ts`
- **Routes**: Modularized in `*_routes.ts` files
- **Build**: Compiles to native binary with `bun build`

### Key Dependencies
- **Runtime**: Bun 1.1.42
- **Monorepo**: Turborepo for task orchestration
- **Blockchain**: Solana wallet adapters and Meteora SDK
- **3D**: Three.js ecosystem for avatar rendering

## Development Patterns

### API Endpoints
The API uses Elysia's chain-based routing:
```typescript
app.use(cors())
   .use(jwt({ secret: process.env.JWT_SECRET }))
   .get('/path', handler)
```

### Frontend Components
Follow existing patterns in the codebase:
- Use TypeScript with proper typing
- Components in PascalCase
- Utilities in camelCase
- Tailwind for styling

### Environment Variables
- Web app expects API URL configuration
- API requires JWT_SECRET and other auth tokens

## Static Assets
Both apps serve static files from their `public/` directories, including:
- VRM avatar models
- GLB 3D environments
- HDR lighting files
- UI assets

## Claude Development Session Memory
- Let me spin up the app server if needed, because it will affect the current claude code session