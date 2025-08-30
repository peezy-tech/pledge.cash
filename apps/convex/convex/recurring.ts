// convex/recurring.ts
import { internalMutation, mutation, query, action } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { infoClient, multiSignClient } from "./lib/hyperliquid";
import { v } from "convex/values";

function addCadence(from: number, cadence: "daily" | "weekly" | "monthly"): number {
  const d = new Date(from);
  if (cadence === "daily") d.setDate(d.getDate() + 1);
  else if (cadence === "weekly") d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return d.getTime();
}

// Schema assumed in convex/schema.ts:
// recurringPlans + recurringCharges mirror the legacy DB.

export const createPlan = mutation({
  args: {
    creatorId: v.id("users"),
    payerUserId: v.optional(v.id("users")),
    payerAddress: v.optional(v.string()),
    token: v.string(),
    amount: v.string(),
    cadence: v.union(v.literal("daily"), v.literal("weekly"), v.literal("monthly")),
    startAt: v.optional(v.number()),
    endAt: v.optional(v.number()),
    autopayEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const nextRunAt = args.startAt ?? Date.now();
    const id = await ctx.db.insert("recurringPlans", {
      creatorId: args.creatorId,
      payerUserId: args.payerUserId,
      payerAddress: args.payerAddress?.toLowerCase(),
      token: args.token,
      amount: args.amount,
      cadence: args.cadence,
      startAt: nextRunAt,
      endAt: args.endAt,
      autopayEnabled: args.autopayEnabled ?? true,
      nextRunAt,
      status: "active",
    });
    await ctx.scheduler.runAt(nextRunAt, internal.recurring.processPlan, { planId: id });
    return id;
  },
});

export const updatePlan = mutation({
  args: {
    id: v.id("recurringPlans"),
    status: v.optional(v.union(v.literal("active"), v.literal("paused"), v.literal("cancelled"))),
    autopayEnabled: v.optional(v.boolean()),
    endAt: v.optional(v.number()),
  },
  handler: async (ctx, { id, ...patch }) => {
    await ctx.db.patch(id, patch);
    return await ctx.db.get(id);
  },
});

export const listPlansForUser = query({
  args: { userId: v.id("users"), walletAddress: v.string() },
  handler: async (ctx, { userId, walletAddress }) => {
    const created = await ctx.db
      .query("recurringPlans")
      .withIndex("by_creator", (q) => q.eq("creatorId", userId))
      .collect();
    const asPayerUser = await ctx.db
      .query("recurringPlans")
      .withIndex("by_payerUser", (q) => q.eq("payerUserId", userId))
      .collect();
    const asPayerAddress = await ctx.db
      .query("recurringPlans")
      .withIndex("by_payerAddress", (q) => q.eq("payerAddress", walletAddress.toLowerCase()))
      .collect();
    return { created, asPayer: [...asPayerUser, ...asPayerAddress] };
  },
});

export const listCharges = query({
  args: { planId: v.id("recurringPlans") },
  handler: async (ctx, { planId }) => {
    return await ctx.db
      .query("recurringCharges")
      .withIndex("by_plan", (q) => q.eq("planId", planId))
      .collect();
  },
});

export const runNow = action({
  args: { planId: v.id("recurringPlans") },
  handler: async (ctx, { planId }) => {
    // Create a charge and mark as paid in a best-effort simulation
    const plan = await ctx.runQuery(api.recurring.getPlan, { planId });
    if (!plan) return { ok: false, error: "not_found" };
    const charge = await ctx.runMutation(api.recurring.createCharge, {
      planId,
      token: plan.token,
      amount: plan.amount,
      dueAt: Date.now(),
    });
    // Try autopay immediately; if disabled/fails, leave charge as pending
    const result = await ctx.runAction(api.recurring.autopayAction, { planId, chargeId: charge });
    return { ok: true, chargeId: charge, autopay: result };
  },
});

export const processPlan = internalMutation({
  args: { planId: v.id("recurringPlans") },
  handler: async (ctx, { planId }) => {
    const plan = await ctx.db.get(planId);
    if (!plan) return;
    const now = Date.now();
    if (plan.status !== "active" || plan.nextRunAt > now) return;

    const chargeId = await ctx.db.insert("recurringCharges", {
      planId,
      token: plan.token,
      amount: plan.amount,
      dueAt: now,
      status: "pending",
    });
    // Schedule autopay attempt via action (side effect)
    await ctx.scheduler.runAfter(0, api.recurring.autopayAction, { planId, chargeId });
    const next = addCadence(now, plan.cadence as any);
    await ctx.db.patch(planId, { nextRunAt: next });
    await ctx.scheduler.runAt(next, internal.recurring.processPlan, { planId });
  },
});

export const getPlan = query({
  args: { planId: v.id("recurringPlans") },
  handler: async (ctx, { planId }) => await ctx.db.get(planId),
});

export const createCharge = mutation({
  args: { planId: v.id("recurringPlans"), token: v.string(), amount: v.string(), dueAt: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db.insert("recurringCharges", {
      planId: args.planId,
      token: args.token,
      amount: args.amount,
      dueAt: args.dueAt,
      status: "pending",
    });
  },
});

export const markChargePaid = mutation({
  args: { id: v.id("recurringCharges") },
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { status: "paid", runAt: Date.now() });
    return await ctx.db.get(id);
  },
});

export const autopayAction = action({
  args: { planId: v.id("recurringPlans"), chargeId: v.id("recurringCharges") },
  handler: async (ctx, { planId, chargeId }) => {
    const plan = await ctx.db.get(planId);
    if (!plan) return { ok: false, error: "not_found" };
    if (!plan.autopayEnabled || !plan.payerUserId) return { ok: false, error: "autopay_disabled" };

    // Load payer user & pledge wallet
    const payer = await ctx.db.get(plan.payerUserId);
    if (!payer?.evmAddress) return { ok: false, error: "payer_not_found" };
    const pledge = await ctx.db
      .query("pledgeWalletAccounts")
      .withIndex("by_user_address", (q) => q.eq("userAddress", payer.evmAddress))
      .unique();
    if (!pledge) return { ok: false, error: "pledge_wallet_not_found" };

    // Load creator (destination)
    const creator = await ctx.db.get(plan.creatorId!);
    if (!creator?.evmAddress) return { ok: false, error: "creator_not_found" };

    try {
      const multi = multiSignClient({ multiSignAddress: pledge.address as `0x${string}`, operatorPrivateKey: pledge.operatorPrivateKey as `0x${string}` });
      await multi.spotSend({
        destination: creator.evmAddress as `0x${string}`,
        token: plan.token as `${string}:0x${string}`,
        amount: plan.amount,
      });

      // Best-effort: fetch recent details and infer tx hash
      const ic = infoClient();
      await new Promise((r) => setTimeout(r, 1500));
      const details = await ic.userDetails({ user: pledge.address as `0x${string}` });
      const tx = (details as any[])
        .filter((t) =>
          t.action?.type === "spotSend" &&
          t.action?.destination?.toLowerCase() === creator.evmAddress.toLowerCase() &&
          t.action?.token === plan.token &&
          t.action?.amount === plan.amount &&
          t.error === null
        )
        .sort((a, b) => (b.time ?? 0) - (a.time ?? 0))[0];

      await ctx.runMutation(api.recurring.markChargePaid, { id: chargeId });
      await ctx.db.insert("payments", {
        userId: plan.payerUserId,
        creatorId: plan.creatorId ?? undefined,
        type: "recurring",
        token: plan.token,
        amount: plan.amount,
        status: "paid",
        txHash: tx?.hash,
        payerAddress: pledge.address,
      });
      return { ok: true, txHash: tx?.hash };
    } catch (e: any) {
      await ctx.db.patch(chargeId, { status: "failed", runAt: Date.now(), error: String(e?.message ?? e) });
      return { ok: false, error: "autopay_failed" };
    }
  },
});
