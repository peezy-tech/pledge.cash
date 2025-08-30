// convex/users.ts
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const ensure = mutation({
  args: { evmAddress: v.string() },
  handler: async (ctx, { evmAddress }) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_evm", (q) => q.eq("evmAddress", evmAddress.toLowerCase()))
      .unique();
    if (existing) return existing._id;
    const id = await ctx.db.insert("users", { evmAddress: evmAddress.toLowerCase() });
    return id;
  },
});

export const findByEvm = query({
  args: { evmAddress: v.string() },
  handler: async (ctx, { evmAddress }) => {
    return await ctx.db
      .query("users")
      .withIndex("by_evm", (q) => q.eq("evmAddress", evmAddress.toLowerCase()))
      .unique();
  },
});

export const listAddresses = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user) return { personalAddress: null, pledgeWalletAddresses: [] as string[] };
    const pledge = await ctx.db
      .query("pledgeWalletAccounts")
      .withIndex("by_user_address", (q) => q.eq("userAddress", user.evmAddress))
      .collect();
    return {
      userId,
      personalAddress: user.evmAddress,
      pledgeWalletAddresses: pledge.map((p) => p.address),
      totalAddresses: 1 + pledge.length,
    };
  },
});

export const getById = query({
  args: { id: v.id("users") },
  handler: async (ctx, { id }) => await ctx.db.get(id),
});
