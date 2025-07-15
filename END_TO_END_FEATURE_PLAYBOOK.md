# End-to-End Feature Playbook (Elysia + React + TanStack Query)

## Overview

This document provides a step-by-step guide for creating a new end-to-end feature in the drama.haus monorepo. It covers the entire development lifecycle, from creating a backend API endpoint with Elysia, ensuring type safety with Elysia Treaty, and consuming it on the frontend with React, TanStack Router, and TanStack Query.

## Core Philosophy

- **Type-Safety First**: We leverage Elysia Treaty to generate types from our backend API, which the frontend consumes. This eliminates a whole class of bugs and ensures the client and server are always in sync.
- **Modular & Organized**: Features are organized into modular routes on the backend and dedicated components/hooks on the frontend.
- **Server State Management**: TanStack Query is the source of truth for all server state on the client. We do not store server data in `useState` or other client-state managers.

---

## 📋 Step-by-Step Implementation Guide

### 1. Backend: Database & API Setup

#### 1.1. Database: Define the Schema (Drizzle ORM)

If your feature requires new data models, start by defining them in the database schema.

1.  **Modify the schema file**: Open `packages/db/schema.ts` and add your new table definition using Drizzle ORM's syntax.

    ```typescript
    // packages/db/schema.ts
    import {
      sqliteTable as table,
      text,
      integer,
    } from "drizzle-orm/sqlite-core";

    // ... existing table definitions (users, pools, etc.)

    // Add your new table
    export const featureItems = table("feature_items", {
      id: text("id")
        .primaryKey()
        .$default(() => `feat_${generateUniqueString(16)}`),
      name: text("name").notNull(),
      createdAt: integer("created_at").default(Date.now()).notNull(),
      // Add foreign keys if needed, e.g., to the users table
      // userId: text("user_id").references(() => users.id),
    });
    ```

2.  **Generate Migrations**: After saving your schema changes, you must generate a migration file.

    ```bash
    # From packages/db
    bun db:generate
    ```

    This command inspects schema changes and creates a new SQL migration file in `packages/db/drizzle/`.

3.  **Run Migrations**: To apply the changes to your local database, run the migration script. The `migrate()` function is exported from `packages/db/index.ts` and should be part of a startup script or a dedicated command.

    _Note: Ensure your API server startup logic calls the `migrate()` function to apply pending migrations._

#### 1.2. Backend: Create the API Endpoint (Elysia)

With the database schema updated, you can now create the API endpoint.

1.  **Create a new route file**: Create a file in `apps/api/src/` named `feature_routes.ts`.

2.  **Define the route with DB calls**: Import the `db` and `orm` helpers from `packages/db` and use them within your route handlers.

    ```typescript
    // apps/api/src/feature_routes.ts
    import { Elysia, t } from "elysia";
    import { db, orm } from "db"; // Import drizzle db and orm helpers
    import { featureItems } from "db/schema"; // Import your new table schema

    // Define the data structures for API responses
    const FeatureItem = t.Object({
      id: t.String(),
      name: t.String(),
      createdAt: t.Date(),
    });
    const FeatureResponse = t.Array(FeatureItem);

    export const featureRoutes = new Elysia({ prefix: "/feature" })
      .get(
        "/",
        async () => {
          // Fetch items from the database
          const items = await db.select().from(featureItems);
          return items.map((item) => ({
            ...item,
            createdAt: new Date(item.createdAt),
          }));
        },
        {
          response: FeatureResponse,
          detail: { summary: "Get all feature items" },
        },
      )
      .post(
        "/",
        async ({ body }) => {
          // Insert a new item into the database
          const [newItem] = await db
            .insert(featureItems)
            .values({ name: body.name })
            .returning();
          return { ...newItem, createdAt: new Date(newItem.createdAt) };
        },
        {
          body: t.Object({ name: t.String() }),
          response: FeatureItem,
          detail: { summary: "Create a new feature item" },
        },
      );
    ```

3.  **Integrate into the main app**: Mount your new routes in `apps/api/src/index.ts`.

    ```typescript
    // apps/api/src/index.ts
    import { Elysia } from "elysia";
    import { featureRoutes } from "./feature_routes"; // Import your new routes

    const app = new Elysia()
      // ... other middleware (cors, etc.)
      .use(featureRoutes) // Use your new routes
      .listen(3005);

    console.log(`API running at ${app.server?.hostname}:${app.server?.port}`);

    export type App = typeof app; // Export the app type for Treaty
    ```

4.  **Integrate into the main app**: Mount your new routes in `apps/api/src/index.ts`.

    ```typescript
    // apps/api/src/index.ts
    import { Elysia } from "elysia";
    import { featureRoutes } from "./routes/feature_routes"; // Import your new routes

    const app = new Elysia()
      // ... other middleware (cors, etc.)
      .use(featureRoutes) // Use your new routes
      .listen(3005);

    console.log(`API running at ${app.server?.hostname}:${app.server?.port}`);

    export type App = typeof app; // Export the app type for Treaty
    ```

### 2. Backend: Testing Setup (Elysia + Eden Treaty)

Before moving to the frontend, ensure your backend API is properly tested. Our API uses a comprehensive testing setup with Bun Test and Eden Treaty.

#### 2.1. Read the Testing Documentation

**📖 IMPORTANT**: Before writing tests, read the comprehensive testing guide:

```bash
# Read the complete testing setup documentation
cat apps/api/test/README.md
```

This README covers:
- Testing architecture and best practices
- How to use the test utilities
- Examples of authentication and endpoint testing
- Type-safe testing with Eden Treaty
- Common testing patterns and utilities

#### 2.2. Write Tests for Your New Feature

1. **Create feature-specific test file**: Create a test file for your new feature routes.

    ```typescript
    // apps/api/test/feature.test.ts
    import { describe, expect, it, beforeEach } from 'bun:test';
    import { treaty } from '@elysiajs/eden';
    import { createTestApp, type TestApp } from './setup';
    import { requestUtils, assertUtils, mockAuth } from './test-utils';

    describe('Feature Routes', () => {
      let app: TestApp;
      let api: ReturnType<typeof treaty<TestApp>>;

      beforeEach(() => {
        app = createTestApp();
        api = treaty(app);
      });

      describe('GET /feature - List Items', () => {
        it('should return empty array initially', async () => {
          const response = await app.handle(
            requestUtils.createGetRequest('/feature')
          );
          
          const data = await assertUtils.assertJsonResponse(response, 200);
          expect(Array.isArray(data)).toBe(true);
          expect(data.length).toBe(0);
        });

        it('should work with Eden Treaty', async () => {
          const { data, error } = await api.feature.get();
          expect(error).toBeNull();
          expect(data).toBeDefined();
          expect(Array.isArray(data)).toBe(true);
        });
      });

      describe('POST /feature - Create Item', () => {
        it('should create new item with valid data', async () => {
          const itemData = { name: 'Test Item' };
          
          const response = await app.handle(
            requestUtils.createPostRequest('/feature', itemData)
          );
          
          const data = await assertUtils.assertJsonResponse(response, 200);
          expect(data.name).toBe(itemData.name);
          expect(data.id).toBeDefined();
        });

        it('should validate required fields', async () => {
          const response = await app.handle(
            requestUtils.createPostRequest('/feature', {})
          );
          
          await assertUtils.assertValidationError(response);
        });
      });
    });
    ```

2. **Test protected routes**: If your feature has authentication requirements, use the auth utilities.

    ```typescript
    describe('Protected Feature Routes', () => {
      it('should require authentication', async () => {
        const response = await app.handle(
          requestUtils.createGetRequest('/feature/protected')
        );
        
        expect(response.status).toBe(401);
      });

      // Note: For full auth testing, you'd need to mock the JWT verification
      // See apps/api/test/auth.test.ts for examples
    });
    ```

3. **Run your tests**: Ensure your new tests pass.

    ```bash
    # Run your specific test file
    cd apps/api && bun test feature.test.ts

    # Run all tests
    cd apps/api && bun test

    # Run tests in watch mode while developing
    cd apps/api && bun test --watch
    ```

#### 2.3. Test Coverage Guidelines

Follow these testing principles from the test README:

- **Test both success and error cases**
- **Use descriptive test names**
- **Group related tests in describe blocks**
- **Test validation and error handling**
- **Use Eden Treaty for type-safe testing**
- **Test authentication and authorization**

### 3. Frontend: Create the API Client (Eden Treaty)

Set up the type-safe client in the `apps/web` workspace. Eden Treaty provides automatic type safety without code generation.

1.  **Create the client instance**: In `apps/web/src/utils/api.ts`, use `edenTreaty` to create the client.

    ```typescript
    // apps/web/src/utils/api.ts
    import { edenTreaty } from "@elysiajs/eden";
    import type { App } from "api"; // Import the App type from the API workspace

    // API configuration
    export const API_BASE_URL = location.origin === "http://localhost:5173" ? "http://localhost:3000" : location.origin;

    export const api = edenTreaty<App>(API_BASE_URL, { $fetch: { credentials: 'include' } });
    ```

    _Note: Eden Treaty automatically provides end-to-end type safety without any code generation step. The `App` type is imported directly from the `api` workspace, and TypeScript handles the rest._

### 4. Frontend: Data Fetching Hooks (TanStack Query)

Create custom hooks to encapsulate data fetching logic. This is a best practice for reusability and separation of concerns.

1.  **Create a query hook**: For fetching data (`GET` requests).

    ```typescript
    // apps/web/src/hooks/useFeatureItems.ts
    import { useQuery } from "@tanstack/react-query";
    import { api } from "../utils/api";

    export const featureKeys = {
      all: ["features"] as const,
      lists: () => [...featureKeys.all, "list"] as const,
    };

    export function useFeatureItems() {
      return useQuery({
        queryKey: featureKeys.lists(),
        queryFn: async () => {
          const { data, error } = await api.feature.get(); // Type-safe call!
          if (error) throw error.value;
          return data;
        },
      });
    }
    ```

2.  **Create a mutation hook**: For creating, updating, or deleting data (`POST`, `PUT`, `DELETE`).

    ```typescript
    // apps/web/src/hooks/useCreateFeatureItem.ts
    import { useMutation, useQueryClient } from "@tanstack/react-query";
    import { api } from "../utils/api";
    import { featureKeys } from "./useFeatureItems";

    export function useCreateFeatureItem() {
      const queryClient = useQueryClient();

      return useMutation({
        mutationFn: async (name: string) => {
          const { data, error } = await api.feature.post({ name }); // Type-safe call with body
          if (error) throw error.value;
          return data;
        },
        onSuccess: () => {
          // Invalidate the list query to refetch fresh data
          queryClient.invalidateQueries({ queryKey: featureKeys.lists() });
        },
      });
    }
    ```

### 5. Frontend: UI Component Integration

Use the hooks in your React components to display data and handle user actions.

1.  **Create the feature component**:

    ```tsx
    // apps/web/src/components/features/FeatureList.tsx
    import React from "react";
    import { useFeatureItems } from "../../hooks/useFeatureItems";
    import { useCreateFeatureItem } from "../../hooks/useCreateFeatureItem";

    export function FeatureList() {
      const { data: items, isLoading, isError, error } = useFeatureItems();
      const createItem = useCreateFeatureItem();

      const handleAddItem = () => {
        const name = prompt("Enter item name:");
        if (name) {
          createItem.mutate(name);
        }
      };

      if (isLoading) return <div>Loading...</div>;
      if (isError) return <div>Error: {error.message}</div>;

      return (
        <div>
          <h2>Feature Items</h2>
          <button onClick={handleAddItem} disabled={createItem.isPending}>
            {createItem.isPending ? "Adding..." : "Add Item"}
          </button>
          <ul>
            {items?.map((item) => (
              // Note: item properties are fully typed!
              <li key={item.id}>
                {item.name} - {item.createdAt.toLocaleDateString()}
              </li>
            ))}
          </ul>
        </div>
      );
    }
    ```

If you ever need a Toaster component, thats `sonner.tsx`

### 6. Frontend: Add a Route (TanStack Router)

Expose your new feature component on a dedicated page. Our project uses a programmatic route definition pattern instead of file-based routing.

1.  **Create a new route file**: In `apps/web/src/pages/`, create a new directory and file for your feature. For example: `apps/web/src/pages/feature/feature.tsx`.

    ```tsx
    // apps/web/src/pages/feature/feature.tsx
    import { createRoute, type RootRoute } from '@tanstack/react-router'
    import { FeatureList } from '@/components/features/FeatureList' // Assuming this component exists

    // The main component for your feature page
    function FeaturePage() {
      return (
        <div>
          <h1>My New Feature</h1>
          <FeatureList />
        </div>
      )
    }

    // Route definition
    export default (rootRoute: RootRoute) =>
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/feature', // URL path for the new page
        component: FeaturePage,
      })
    ```
    _Note: The `@` alias typically points to `apps/web/src/`._

2.  **Integrate the new route**: Mount your new route in `apps/web/src/pages/router.tsx`.

    ```typescript
    // apps/web/src/pages/router.tsx
    import { Outlet, createRootRoute, createRouter } from '@tanstack/react-router'
    // ... other imports like HomePage, etc.
    import MultisigPage from './multisig/multisig'
    import FeaturePageRoute from './feature/feature' // 1. Import your new route module

    // ... rootRoute definition

    const routes = rootRoute.addChildren([
      // ... other routes
      MultisigPage(rootRoute),
      FeaturePageRoute(rootRoute), // 2. Add your new route to the array
    ])

    export const router = createRouter({
      routeTree: routes,
      // ... other router config
    })
    ```

---

## ✅ Definition of Done Checklist

### Backend & Testing
- [ ] Backend route is created in its own `[feature]_routes.ts` file.
- [ ] Route includes validation schemas for `body`, `params`, and `response`.
- [ ] New route module is imported and used in `apps/api/src/index.ts`.
- [ ] `export type App = typeof app;` is present in `index.ts`.
- [ ] **Testing documentation has been read** (`apps/api/test/README.md`).
- [ ] **Feature-specific test file is created** (`apps/api/test/[feature].test.ts`).
- [ ] **Tests cover both success and error cases** for all endpoints.
- [ ] **Tests use Eden Treaty for type-safe testing**.
- [ ] **Authentication/authorization is tested** if applicable.
- [ ] **All tests pass** (`bun test` from `apps/api/`).

### Frontend
- [ ] Type-safe client has been regenerated via the sync script.
- [ ] Custom `useQuery` and/or `useMutation` hooks are created for the endpoint.
- [ ] Query keys are managed in a structured way.
- [ ] Mutations correctly invalidate relevant queries on success.
- [ ] UI component uses the hooks to handle loading, error, and success states.
- [ ] A new route module is created in `apps/web/src/pages/` and linked in `router.tsx`.

### Final Validation
- [ ] All code passes linting (`bun lint`) and type-checking (`bun check`).
- [ ] Feature works end-to-end from API to UI.
