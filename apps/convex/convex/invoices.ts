// convex/invoices.ts
import { query, mutation, action, internalMutation, internalQuery } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { infoClient } from "./lib/hyperliquid";
import { v } from "convex/values";

export const create = mutation({
  args: {
    creatorId: v.id("users"),
    payerUserId: v.optional(v.id("users")),
    payerAddress: v.optional(v.string()),
    token: v.string(),
    amount: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("invoices", {
      creatorId: args.creatorId,
      payerUserId: args.payerUserId,
      payerAddress: args.payerAddress?.toLowerCase(),
      token: args.token,
      amount: args.amount,
      description: args.description,
      status: "pending",
    });
    return id;
  },
});

export const get = query({
  args: { id: v.id("invoices") },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.get(id);
    if (!doc) return null as any;
    const creator = await ctx.db.get(doc.creatorId);
    return {
      ...doc,
      id,
      createdAt: (doc as any)._creationTime,
      creatorAddress: creator?.evmAddress ?? null,
    } as any;
  },
});

export const listByCreator = query({
  args: { creatorId: v.id("users") },
  handler: async (ctx, { creatorId }) => {
    return await ctx.db
      .query("invoices")
      .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
      .collect();
  },
});

export const listForUser = query({
  args: { userId: v.optional(v.id("users")), walletAddress: v.optional(v.string()) },
  handler: async (ctx, { userId, walletAddress }) => {
    // If unauthenticated, return empty lists instead of throwing
    if (!userId && !walletAddress) return { created: [], received: [] } as any;

    const createdRaw = userId
      ? await ctx.db
          .query("invoices")
          .withIndex("by_creator", (q) => q.eq("creatorId", userId))
          .collect()
      : [];

    // Filter received by userId or walletAddress
    const all = await ctx.db.query("invoices").collect();
    const receivedRaw = all.filter((i) => {
      if (userId && i.payerUserId && i.payerUserId === userId) return true;
      if (walletAddress && i.payerAddress && i.payerAddress.toLowerCase() === walletAddress.toLowerCase()) return true;
      return false;
    });

    // Map to client-friendly shape with id/createdAt and creatorAddress
    const mapInvoice = async (i: any) => {
      const creator = await ctx.db.get(i.creatorId);
      return {
        ...i,
        id: i._id,
        createdAt: i._creationTime,
        creatorAddress: creator?.evmAddress ?? null,
      } as any;
    };

    const created = await Promise.all(createdRaw.map(mapInvoice));
    const received = await Promise.all(receivedRaw.map(mapInvoice));

    return { created, received } as any;
  },
});

export const confirm = action({
  args: {
    id: v.id("invoices"),
    txHash: v.string(),
  },
  handler: async (ctx, { id, txHash }) => {
    const invoice = await ctx.runQuery(api.invoices.get, { id });
    if (!invoice) return { ok: false, error: "not_found" };

    // Load creator to validate destination
    const creatorAddress = invoice.creatorAddress
      ? (invoice.creatorAddress as string)
      : ((await ctx.runQuery(internal.invoices.getCreatorById, { id: invoice.creatorId }))?.evmAddress ?? null);
    if (!creatorAddress) return { ok: false, error: "creator_not_found" };

    // Validate HL tx
    const ic = infoClient();
    const tx = await ic.txDetails({ hash: txHash });
    if (!tx || tx.error || tx.action.type !== "spotSend") {
      return { ok: false, error: "invalid_tx" };
    }
    const action: any = tx.action;
    if (action.destination?.toLowerCase() !== (creatorAddress as string).toLowerCase()) {
      return { ok: false, error: "destination_mismatch" };
    }
    if (action.token !== invoice.token) {
      return { ok: false, error: "token_mismatch" };
    }
    if (parseFloat(action.amount) !== parseFloat(invoice.amount)) {
      return { ok: false, error: "amount_mismatch" };
    }

    // Upsert tx hash record
    await ctx.runMutation(internal.invoices.upsertTxHash, { hash: txHash, metadata: tx as any });

    const actualPayer = (tx.user ?? null) as string | null;

    // Address resolution & edge cases: decide if valid and get/ensure user
    const edge = await ctx.runQuery(api.address.resolvePaymentWithEdgeCases, {
      address: actualPayer || "0x",
      invoicePayerAddress: invoice.payerAddress ?? undefined,
    });
    if (!edge.edgeCases.isValidPayment) {
      return { ok: false, error: "unauthorized_payer", details: edge.edgeCases };
    }

    let payerUserId = invoice.payerUserId ?? null;
    let paymentType = invoice.paymentType ?? null;
    let payerAddress = (invoice.payerAddress ?? actualPayer ?? null)?.toLowerCase() ?? null;

    if (edge.resolution) {
      payerUserId = edge.resolution.userId;
      paymentType = edge.resolution.paymentType;
      // Prefer resolved pledge wallet or provided address
      payerAddress = (edge.resolution.pledgeWalletAddress ?? payerAddress ?? edge.resolution.userPersonalAddress).toLowerCase();
    } else if (actualPayer && (!invoice.payerAddress || invoice.payerAddress.toLowerCase() === actualPayer.toLowerCase())) {
      // Open invoice or exact designated match: register new user by payment
      const ensured = await ctx.runMutation(api.users.ensure, { evmAddress: actualPayer });
      const ensuredUser = await ctx.db.get(ensured);
      payerUserId = ensuredUser?._id ?? null;
      paymentType = "personal";
      payerAddress = actualPayer.toLowerCase();
    }

    await ctx.runMutation(internal.invoices.markInvoicePaid, {
      id,
      txHash,
      paidAt: Date.now(),
      payerUserId: (payerUserId ?? undefined) as any,
      payerAddress: payerAddress ?? undefined,
      paymentType: (paymentType ?? undefined) as any,
      actualPayerAddress: actualPayer?.toLowerCase(),
    });

    if (payerUserId) {
      await ctx.runMutation(internal.invoices.insertPaymentRecord, {
        userId: payerUserId as any,
        creatorId: invoice.creatorId as any,
        type: "invoice",
        token: invoice.token,
        amount: invoice.amount,
        status: "paid",
        txHash,
        payerAddress: payerAddress ?? undefined,
      });
    }

    // Return the updated invoice so callers can reflect new state immediately
    const updated = await ctx.runQuery(api.invoices.get, { id });
    return { ok: true, invoice: updated };
  },
});

// Internal helpers used by the confirm action
export const getCreatorById = internalQuery({
  args: { id: v.id("users") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const upsertTxHash = internalMutation({
  args: { hash: v.string(), metadata: v.optional(v.any()) },
  handler: async (ctx, { hash, metadata }) => {
    const existing = await ctx.db
      .query("txHashes")
      .withIndex("by_hash", (q) => q.eq("hash", hash))
      .unique();
    if (!existing) {
      await ctx.db.insert("txHashes", { hash, metadata });
    }
  },
});

export const markInvoicePaid = internalMutation({
  args: {
    id: v.id("invoices"),
    txHash: v.string(),
    paidAt: v.number(),
    payerUserId: v.optional(v.id("users")),
    payerAddress: v.optional(v.string()),
    paymentType: v.optional(v.union(v.literal("personal"), v.literal("pledge-wallet"))),
    actualPayerAddress: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...patch }) => {
    await ctx.db.patch(id, { status: "paid", ...patch });
  },
});

export const insertPaymentRecord = internalMutation({
  args: {
    userId: v.id("users"),
    creatorId: v.optional(v.id("users")),
    type: v.union(v.literal("invoice"), v.literal("donation"), v.literal("recurring"), v.literal("pledge")),
    token: v.string(),
    amount: v.string(),
    status: v.union(v.literal("pending"), v.literal("paid"), v.literal("failed"), v.literal("refunded")),
    txHash: v.optional(v.string()),
    payerAddress: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("payments", args);
  },
});
