// convex/billing.ts
import { internalMutation, mutation, action } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { v } from "convex/values";

// Utility: compute next charge time based on cadence
function computeNext(cadence: "daily" | "weekly" | "monthly", fromMs: number) {
  const d = new Date(fromMs);
  if (cadence === "daily") d.setDate(d.getDate() + 1);
  else if (cadence === "weekly") d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return d.getTime();
}

// Create a subscription and schedule the first charge
export const createSubscription = mutation({
  args: {
    userId: v.id("users"),
    token: v.string(),
    amount: v.string(),
    cadence: v.union(v.literal("daily"), v.literal("weekly"), v.literal("monthly")),
    autopayEnabled: v.boolean(),
    firstChargeAtMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const firstAt = args.firstChargeAtMs ?? Date.now();
    const subId = await ctx.db.insert("subscriptions", {
      userId: args.userId,
      token: args.token,
      amount: args.amount,
      cadence: args.cadence,
      autopayEnabled: args.autopayEnabled,
      nextChargeAtMs: firstAt,
      status: "active",
    });
    await ctx.scheduler.runAt(firstAt, internal.billing.chargeSubscription, {
      subscriptionId: subId,
    });
    return subId;
  },
});

// Internal mutation invoked by scheduler to initiate a charge attempt
export const chargeSubscription = internalMutation({
  args: { subscriptionId: v.id("subscriptions") },
  handler: async (ctx, { subscriptionId }) => {
    const sub = await ctx.db.get(subscriptionId);
    if (!sub) return;
    if (sub.status !== "active" || !sub.autopayEnabled) return;

    const attemptKey = `${subscriptionId}:${sub.nextChargeAtMs}`;
    if (sub.lastAttemptKey === attemptKey) return; // idempotent

    await ctx.db.patch(subscriptionId, { lastAttemptKey: attemptKey });

    // Kick off the side-effect in an action immediately
    await ctx.scheduler.runAfter(0, api.billing.chargeAction, {
      subscriptionId,
      attemptKey,
    });
  },
});

// Side effects (call external provider) then record payment + schedule next
export const chargeAction = action({
  args: { subscriptionId: v.id("subscriptions"), attemptKey: v.string() },
  handler: async (ctx, { subscriptionId }) => {
    // In a real implementation: call an external provider.
    // This sandbox omits network I/O and simply simulates a successful charge.
    const now = Date.now();

    // Simulate work then write payment and schedule next
    await ctx.runMutation(internal.billing.recordPayment, {
      subscriptionId,
      status: "paid",
      txHash: undefined,
    });

    const sub = await ctx.runMutation(internal.billing.scheduleNextFromNow, {
      subscriptionId,
      fromMs: now,
    });
    return sub;
  },
});

export const recordPayment = internalMutation({
  args: {
    subscriptionId: v.id("subscriptions"),
    status: v.union(v.literal("paid"), v.literal("failed")),
    txHash: v.optional(v.string()),
  },
  handler: async (ctx, { subscriptionId, status, txHash }) => {
    const sub = await ctx.db.get(subscriptionId);
    if (!sub) return;
    await ctx.db.insert("payments", {
      subscriptionId,
      userId: sub.userId,
      creatorId: sub.creatorId,
      type: "recurring",
      token: sub.token,
      amount: sub.amount,
      status,
      txHash,
    });
  },
});

export const scheduleNext = internalMutation({
  args: { subscriptionId: v.id("subscriptions"), nextMs: v.number() },
  handler: async (ctx, { subscriptionId, nextMs }) => {
    await ctx.db.patch(subscriptionId, { nextChargeAtMs: nextMs });
    await ctx.scheduler.runAt(nextMs, internal.billing.chargeSubscription, { subscriptionId });
  },
});

export const scheduleNextFromNow = internalMutation({
  args: { subscriptionId: v.id("subscriptions"), fromMs: v.number() },
  handler: async (ctx, { subscriptionId, fromMs }) => {
    const sub = await ctx.db.get(subscriptionId);
    if (!sub) return null;
    const next = computeNext(sub.cadence as any, fromMs);
    await ctx.db.patch(subscriptionId, { nextChargeAtMs: next });
    await ctx.scheduler.runAt(next, internal.billing.chargeSubscription, { subscriptionId });
    return await ctx.db.get(subscriptionId);
  },
});
