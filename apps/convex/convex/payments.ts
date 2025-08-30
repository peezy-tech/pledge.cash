// convex/payments.ts
import { query } from "./_generated/server";
import { v } from "convex/values";

export const listByUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db.query("payments").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
  },
});

export const listLatest = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    // No createdAt in schema; rely on system ordering by _creationTime
    const items = await ctx.db.query("payments").collect();
    return items
      .sort((a, b) => (b._creationTime ?? 0) - (a._creationTime ?? 0))
      .slice(0, limit ?? 10);
  },
});

export const listSummaryForUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const asCreator = await ctx.db
      .query("payments")
      .withIndex("by_creator", (q) => q.eq("creatorId", userId))
      .collect();
    const asPayer = await ctx.db
      .query("payments")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return { asCreator, asPayer };
  },
});

