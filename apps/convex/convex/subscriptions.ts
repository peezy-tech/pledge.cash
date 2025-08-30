// convex/subscriptions.ts
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const listByUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
  },
});

export const update = mutation({
  args: {
    id: v.id("subscriptions"),
    autopayEnabled: v.optional(v.boolean()),
    status: v.optional(v.union(v.literal("active"), v.literal("paused"), v.literal("canceled"))),
    nextChargeAtMs: v.optional(v.number()),
  },
  handler: async (ctx, { id, ...patch }) => {
    await ctx.db.patch(id, patch);
    return await ctx.db.get(id);
  },
});

