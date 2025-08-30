# Migration Guide: Move API Server and DB to Convex

This guide describes an end-to-end migration of the existing API server and the `@repo/db` package to Convex, using the `apps/convex` project. It explains how to map endpoints and data models to Convex functions and tables, how to handle auth, pagination, background work, and migrations, and how to cut over safely. It also includes a decision and blueprint for recurring payments scheduling.

## Goals

- Replace custom API server endpoints with Convex functions (queries, mutations, actions) and optional `httpEndpoint`s.
- Replace `@repo/db` with Convex tables, schemas, and generated types.
- Keep the React app fully reactive via `convex/react` while preserving existing UX.
- Provide a robust, auditable workflow for scheduled/recurring payments.

## What You’ll Build in Convex

- Convex tables + schema for all entities previously managed by `@repo/db`.
- Query functions for read paths (reactive, cached by Convex).
- Mutation functions for transactional updates inside the DB.
- Action functions for side effects (webhooks, external APIs like exchanges or payment providers).
- `httpEndpoint`s for third-party webhooks/callbacks (only if needed).
- Scheduling for recurring payments using `ctx.scheduler.runAt` (decision explained below).

## Client Integration (React)

- Use the Convex React provider and hooks for data access.
  - Provider example: `apps/convex/docs/demo_react/provider.tsx:1`
  - Query example: `apps/convex/docs/demo_react/page.tsx:1`

Key patterns:

- Wrap the app with `ConvexProvider` using a `ConvexQueryClient` targeting `VITE_CONVEX_URL`.
- Read data in components with `useQuery(api.namespace.fn)`.
- For list UIs, use `usePaginatedQuery` (see pagination section below).

## Mapping Concepts and Endpoints

Existing server responsibilities map as follows:

- Reads (GET endpoints) → Convex queries: `query({ args, handler })`
- Writes/transactions (POST/PUT/DELETE) → Convex mutations: `mutation({ args, handler })`
- Side effects (calling Hyperliquid, third-party services, file I/O, long-running tasks) → Convex actions: `action({ args, handler })`
- Webhooks and external callbacks → `httpEndpoint` in Convex (minimal HTTP server surface)

Where a legacy HTTP surface must be maintained temporarily, create `httpEndpoint`s that internally call the new Convex mutations/actions. This provides a migration bridge without keeping the old server runtime.

## Database and Schemas

Define tables and their validators in `convex/schema.ts`. See Convex schema guidance:

- Types and validators: `apps/convex/docs/CONVEX-DATA-TYPES.md:1`
- Schema authoring and validation: `apps/convex/docs/SCHEMAS.md:1`

Recommendations:

- Define a strict schema from day one; evolve with schema updates as needed.
- Index fields you read by, especially foreign keys and status/date composites.
- Keep document size <1MB and nesting depth reasonable; prefer normalized relations.

Example snippet (adapt to your domain):

```ts
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    evmAddress: v.string(),
    // add more user profile fields as needed
  }).index("by_evm", ["evmAddress"]),

  subscriptions: defineTable({
    userId: v.id("users"),
    amount: v.string(),               // consider numeric strategy
    token: v.string(),
    cadence: v.union(
      v.literal("monthly"),
      v.literal("weekly"),
      v.literal("daily")
    ),
    autopayEnabled: v.boolean(),
    nextChargeAtMs: v.number(),       // UTC timestamp ms
    status: v.string(),               // active|canceled|paused
    // idempotency keys / last charge metadata as optional fields
    lastAttemptKey: v.optional(v.string()),
  }).index("by_next", ["nextChargeAtMs"]).index("by_user", ["userId"]),

  payments: defineTable({
    subscriptionId: v.union(v.id("subscriptions"), v.null()),
    userId: v.id("users"),
    type: v.union(
      v.literal("invoice"),
      v.literal("donation"),
      v.literal("recurring")
    ),
    token: v.string(),
    amount: v.string(),
    status: v.string(),               // pending|paid|failed|refunded
    txHash: v.optional(v.string()),
  }).index("by_user", ["userId"]).index("by_status", ["status"]),
});
```

Notes:

- Prefer using `_creationTime` for creation timestamps; for other times, store UTC ms numbers to align with scheduling APIs.
- For money, choose one representation consistently: string of decimal, integer smallest unit, or bigint. Convex supports `v.int64()` if you prefer integer smallest units.

## Function Types and When to Use Them

- Query: pure reads from Convex DB (reactive, cached).
- Mutation: transactional, atomic changes (Convex retries internal conflicts; schedule from here when you need atomicity).
- Action: non-transactional side effects (HTTP, SDKs, long-running). Not retried automatically; design idempotency.

See: `apps/convex/docs/SCHEDULING.md:1` (atomic scheduling from mutations), `apps/convex/docs/CRONS.md:1` (cron jobs overview).

## Pagination

- Server: implement queries that call `.paginate(paginationOpts)`.
- Client: use `usePaginatedQuery`.

Reference: `apps/convex/docs/PAGINATED-QUERIES.md:1`.

## Auth Strategy (SIWE in Convex)

Implement SIWE verification in a Convex action and store the user in `users`. Issue a Convex session and use `ctx.auth.getUserIdentity()` inside functions. Normalize users by `evmAddress` (index `by_evm`) and attach domain-specific identities to Convex documents.

## Scheduling and Background Work

Two tools in Convex:

- Scheduled functions: `ctx.scheduler.runAt(dateOrMs, fn, args)` and `runAfter(ms, ...)` to run a function at a point in time. Durable, persisted in `_scheduled_functions` and great for per-entity workflows. See `apps/convex/docs/SCHEDULING.md:1`.
- Cron jobs: define static recurring schedules in `convex/crons.ts` for global periodic tasks (cleanup, cache warms, reports). See `apps/convex/docs/CRONS.md:1`.
- Optional dynamic crons: `@convex-dev/crons` if you must register crons at runtime (see `apps/convex/docs/CRON-ON-RUNTIME.md:1`).

### Decision: Recurring Payments

Use scheduled functions with `runAt`, not cron, as the primary mechanism for recurring payments.

Why:

- Per-subscription cadence and start dates vary; `runAt` naturally schedules the next specific renewal for each subscription.
- Workflows can chain: after a successful charge, schedule the next `runAt` based on cadence; after failure, schedule a retry with backoff.
- Atomicity: schedule from a mutation to guarantee the next run is persisted only if state changes succeed.
- Scale: one scheduled function per subscription occurrence avoids a global cron scanning all subscriptions and simplifies concurrency.

Pattern:

1) On create/update of a subscription, set `nextChargeAtMs` and schedule an internal mutation at that time.
2) The scheduled mutation loads the subscription, performs idempotency checks, writes an attempt record, and atomically schedules an action via `runAfter(0)` to call the external provider (Hyperliquid or equivalent).
3) The action performs the side effect (charge or create invoice), writes the `payments` record and updates the subscription.
4) The mutation schedules the next renewal with `runAt(nextMs, internal.billing.chargeSubscription, { id })`.

Sketch:

```ts
// convex/billing.ts
import { internalMutation, action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

export const chargeSubscription = internalMutation({
  args: { subscriptionId: v.id("subscriptions") },
  handler: async (ctx, { subscriptionId }) => {
    const sub = await ctx.db.get(subscriptionId);
    if (!sub || sub.status !== "active") return;

    // Idempotency: bail if an attempt already exists for the current window
    const attemptKey = `${subscriptionId}:${sub.nextChargeAtMs}`;
    if (sub.lastAttemptKey === attemptKey) return;
    await ctx.db.patch(subscriptionId, { lastAttemptKey: attemptKey });

    // Kick off external charge as an action (side effect)
    await ctx.scheduler.runAfter(0, internal.billing.chargeAction, {
      subscriptionId,
      attemptKey,
    });
  },
});

export const chargeAction = action({
  args: { subscriptionId: v.id("subscriptions"), attemptKey: v.string() },
  handler: async (ctx, { subscriptionId, attemptKey }) => {
    // 1) Re-read subscription (non-transactional context) and call external API
    // 2) Write payment record and update subscription status
    // 3) Compute next charge time and schedule next run
    // Pseudocode:
    const now = Date.now();
    const next = /* computeNext(sub.cadence, now) */ now + 30 * 24 * 3600 * 1000;

    // e.g., 
    // await callExternalProvider(...)
    // await ctx.runMutation(internal.billing.recordPayment, {...})
    await ctx.runMutation(internal.billing.scheduleNext, { subscriptionId, nextMs: next });
  },
});

export const scheduleNext = internalMutation({
  args: { subscriptionId: v.id("subscriptions"), nextMs: v.number() },
  handler: async (ctx, { subscriptionId, nextMs }) => {
    await ctx.db.patch(subscriptionId, { nextChargeAtMs: nextMs });
    await ctx.scheduler.runAt(nextMs, internal.billing.chargeSubscription, { subscriptionId });
  },
});
```

This pattern ensures the schedule is durable, each run is idempotent by `attemptKey`, and external calls happen in actions. You may also add a daily cron as a reconciliation watchdog (optional) to catch any missed schedules by scanning `subscriptions` where `nextChargeAtMs < now` and (re)scheduling.

When to use cron:

- Global, uniform tasks: data cleanups, periodic reports, cache warms, backfills, metrics. Define these in `convex/crons.ts`.
- Dynamic crons at runtime only when you truly need user-defined repeating schedules and accept managing many named jobs (`@convex-dev/crons`). For per-subscription billing, prefer `runAt` as above.

<!-- Online data migrations omitted for greenfield. Introduce @convex-dev/migrations only when reshaping existing data later. -->

## HTTP Endpoints and Webhooks

- Implement `httpEndpoint` for incoming third-party callbacks (e.g., payment provider webhooks) only if needed. Inside, call internal mutations/actions.
- For outbound calls, always use actions.

## Testing and Verification

- Test Convex functions by calling them via the generated API or `npx convex run` against a dev deployment.
- For UI E2E, test the new React app wired to Convex (no transitional shims).

## Build Plan

1) Define initial schema/tables.
2) Implement queries for reads and wire React with `useQuery`/`usePaginatedQuery` (optional initially).
3) Implement mutations for writes and actions for side effects (idempotent).
4) Implement scheduled functions for recurring payments and verify chaining/retries.
5) Add `httpEndpoint`s only for webhooks if required, then deploy.

## Operational Notes

- Monitor scheduled functions via `_scheduled_functions` and Convex dashboard. See `apps/convex/docs/SCHEDULING.md:1` for querying status.
- At-most-once vs retries: actions are at-most-once; implement idempotency and compensations. Mutations are retried automatically on internal conflicts.
- Be mindful of Convex limits (document size, depth, transaction). See `apps/convex/docs/CONVEX-DATA-TYPES.md:1`.

## Appendix: Additional Patterns

- Paginated queries: `apps/convex/docs/PAGINATED-QUERIES.md:1`
- Crons reference: `apps/convex/docs/CRONS.md:1`


---

Summary decision for recurring payments: use scheduled functions (`runAt`) per-subscription to precisely schedule and chain renewals, with optional light cron-based reconciliation. This provides correctness, scalability, and per-user flexibility compared to global cron sweeps or many dynamic crons.
