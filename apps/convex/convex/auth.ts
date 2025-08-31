// convex/auth.ts
import { action, query, internalMutation, internalQuery } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { v } from "convex/values";
import { recoverMessageAddress } from "viem";

function randomNonce(): string {
  // 17-char base36 (~80 bits). SIWE nonces are typically 17-128 chars.
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2, 6);
}

export const nonce = action({
  args: {},
  handler: async (ctx) => {
    const n = randomNonce();
    await ctx.runMutation(internal.auth.insertNonce, { nonce: n });
    return { nonce: n };
  },
});

export const verify = action({
  args: {
    message: v.string(),
    signature: v.string(),
    address: v.string(),
    nonce: v.string(),
  },
  handler: async (ctx, { message, signature, address, nonce }) => {
    const normalizedAddress = address.toLowerCase();

    // 1) Ensure nonce exists and is unused
    const nonceDoc = await ctx.runQuery(internal.auth.getNonceByValue, { nonce });
    if (!nonceDoc || nonceDoc.used) {
      return { success: false, error: "invalid_or_used_nonce" } as const;
    }

    // 2) Basic SIWE message integrity checks without importing siwe pkg
    //    - Verify the message contains the nonce and the address
    //    - Recover the signer from the signed raw message and match the address
    const hasNonce = new RegExp(`\\b${nonce}\\b`).test(message);
    const hasAddress = new RegExp(normalizedAddress, "i").test(message);
    if (!hasNonce || !hasAddress) {
      return { success: false, error: "message_mismatch" } as const;
    }

    let recovered: string | null = null;
    try {
      recovered = (await recoverMessageAddress({ message, signature })).toLowerCase();
    } catch (e) {
      return { success: false, error: "recover_failed" } as const;
    }
    if (recovered !== normalizedAddress) {
      return { success: false, error: "address_mismatch" } as const;
    }

    // 3) Mark nonce as used
    await ctx.runMutation(internal.auth.markNonceUsed, { nonce });

    // 4) Ensure the user exists in Convex `users`
    await ctx.runMutation(api.users.ensure, { evmAddress: normalizedAddress });

    // 5) Return success; front-end manages local session
    return { success: true, address: normalizedAddress } as const;
  },
});

export const status = query({
  args: { address: v.optional(v.string()) },
  handler: async (_ctx, { address }) => {
    // Stateless; the frontend manages session. This is a stub to match the provider API.
    return { address: address ?? null };
  },
});

// Internal helpers
export const insertNonce = internalMutation({
  args: { nonce: v.string() },
  handler: async (ctx, { nonce }) => {
    await ctx.db.insert("siweNonces", { nonce, used: false, createdAt: Date.now() });
  },
});

export const getNonceByValue = internalQuery({
  args: { nonce: v.string() },
  handler: async (ctx, { nonce }) => {
    return await ctx.db
      .query("siweNonces")
      .withIndex("by_nonce", (q) => q.eq("nonce", nonce))
      .unique();
  },
});

export const markNonceUsed = internalMutation({
  args: { nonce: v.string() },
  handler: async (ctx, { nonce }) => {
    const doc = await ctx.db
      .query("siweNonces")
      .withIndex("by_nonce", (q) => q.eq("nonce", nonce))
      .unique();
    if (doc && !doc.used) {
      await ctx.db.patch(doc._id, { used: true });
    }
  },
});
