// convex/invoices.ts
import { query, mutation, action } from "./_generated/server";
import { api } from "./_generated/api";
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
  handler: async (ctx, { id }) => await ctx.db.get(id),
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
  args: { userId: v.id("users"), walletAddress: v.optional(v.string()) },
  handler: async (ctx, { userId, walletAddress }) => {
    const created = await ctx.db
      .query("invoices")
      .withIndex("by_creator", (q) => q.eq("creatorId", userId))
      .collect();
    // Filter received by userId or walletAddress
    const all = await ctx.db.query("invoices").collect();
    const received = all.filter((i) => {
      if (i.payerUserId && i.payerUserId === userId) return true;
      if (walletAddress && i.payerAddress && i.payerAddress.toLowerCase() === walletAddress.toLowerCase()) return true;
      return false;
    });
    return { created, received };
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
    const creator = await ctx.db.get(invoice.creatorId);
    if (!creator?.evmAddress) return { ok: false, error: "creator_not_found" };

    // Validate HL tx
    const ic = infoClient();
    const tx = await ic.txDetails({ hash: txHash });
    if (!tx || tx.error || tx.action.type !== "spotSend") {
      return { ok: false, error: "invalid_tx" };
    }
    const action: any = tx.action;
    if (action.destination?.toLowerCase() !== creator.evmAddress.toLowerCase()) {
      return { ok: false, error: "destination_mismatch" };
    }
    if (action.token !== invoice.token) {
      return { ok: false, error: "token_mismatch" };
    }
    if (parseFloat(action.amount) !== parseFloat(invoice.amount)) {
      return { ok: false, error: "amount_mismatch" };
    }

    // Upsert tx hash record
    const existing = await ctx.db
      .query("txHashes")
      .withIndex("by_hash", (q) => q.eq("hash", txHash))
      .unique();
    if (!existing) {
      await ctx.db.insert("txHashes", { hash: txHash, metadata: tx });
    }

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

    await ctx.db.patch(id, {
      status: "paid",
      txHash,
      paidAt: Date.now(),
      payerUserId: payerUserId ?? undefined,
      payerAddress: payerAddress ?? undefined,
      paymentType: paymentType ?? undefined,
      actualPayerAddress: actualPayer?.toLowerCase(),
    });

    if (payerUserId) {
      await ctx.db.insert("payments", {
        userId: payerUserId,
        creatorId: invoice.creatorId,
        type: "invoice",
        token: invoice.token,
        amount: invoice.amount,
        status: "paid",
        txHash,
        payerAddress: payerAddress ?? undefined,
      });
    }

    return { ok: true };
  },
});
