// convex/campaigns.ts
import { query, mutation, action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { infoClient } from "./lib/hyperliquid";

// -------- Campaigns ---------

export const createCampaign = mutation({
  args: {
    creatorId: v.id("users"),
    name: v.string(),
    description: v.optional(v.string()),
    goalToken: v.string(),
    goalAmount: v.string(),
  },
  handler: async (ctx, args) => {
    const campaignId = await ctx.db.insert("pledgeCampaigns", {
      creatorId: args.creatorId,
      name: args.name,
      description: args.description,
      goalToken: args.goalToken,
      goalAmount: args.goalAmount,
      raisedAmount: "0",
      status: "active",
    });
    return campaignId;
  },
});

export const listActiveCampaigns = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("pledgeCampaigns")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
  },
});

export const listCampaignsByCreator = query({
  args: { creatorId: v.id("users") },
  handler: async (ctx, { creatorId }) => {
    return await ctx.db
      .query("pledgeCampaigns")
      .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
      .collect();
  },
});

export const getCampaign = query({
  args: { id: v.id("pledgeCampaigns") },
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

export const updateCampaign = mutation({
  args: {
    id: v.id("pledgeCampaigns"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    status: v.optional(v.union(v.literal("active"), v.literal("paused"), v.literal("completed"))),
  },
  handler: async (ctx, { id, ...patch }) => {
    await ctx.db.patch(id, patch);
    return await ctx.db.get(id);
  },
});

// -------- Pledges ---------

export const createPledge = mutation({
  args: {
    campaignId: v.id("pledgeCampaigns"),
    pledgerUserId: v.optional(v.id("users")),
    pledgerAddress: v.optional(v.string()),
    token: v.string(),
    amountPerCadence: v.string(),
    cadence: v.union(v.literal("daily"), v.literal("weekly"), v.literal("monthly")),
    startAt: v.optional(v.number()),
    autopayEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const pledgeId = await ctx.db.insert("pledges", {
      campaignId: args.campaignId,
      pledgerUserId: args.pledgerUserId,
      pledgerAddress: args.pledgerAddress?.toLowerCase(),
      token: args.token,
      amountPerCadence: args.amountPerCadence,
      cadence: args.cadence,
      autopayEnabled: args.autopayEnabled ?? true,
      nextRunAt: args.startAt ?? now,
      status: "active",
    });
    return pledgeId;
  },
});

export const listPledgesByCampaign = query({
  args: { campaignId: v.id("pledgeCampaigns") },
  handler: async (ctx, { campaignId }) => {
    return await ctx.db
      .query("pledges")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
      .collect();
  },
});

export const listPledgesByPledgerUser = query({
  args: { pledgerUserId: v.id("users") },
  handler: async (ctx, { pledgerUserId }) => {
    return await ctx.db
      .query("pledges")
      .withIndex("by_pledger", (q) => q.eq("pledgerUserId", pledgerUserId))
      .collect();
  },
});

export const listPledgesByPledgerAddress = query({
  args: { address: v.string() },
  handler: async (ctx, { address }) => {
    return await ctx.db
      .query("pledges")
      .withIndex("by_address", (q) => q.eq("pledgerAddress", address.toLowerCase()))
      .collect();
  },
});

// -------- Contributions ---------

export const preparePledgePayment = mutation({
  args: { pledgeId: v.id("pledges") },
  handler: async (ctx, { pledgeId }) => {
    const pledge = await ctx.db.get(pledgeId);
    if (!pledge) return null;
    const contribId = await ctx.db.insert("pledgeContributions", {
      pledgeId,
      campaignId: pledge.campaignId,
      token: pledge.token,
      amount: pledge.amountPerCadence,
      status: "pending",
    });
    return contribId;
  },
});

export const confirmPledgeContribution = action({
  args: { contributionId: v.id("pledgeContributions"), txHash: v.string() },
  handler: async (ctx, { contributionId, txHash }) => {
    const contrib = await ctx.runQuery(api.campaigns.getContribution, { id: contributionId });
    if (!contrib) return { ok: false, error: "not_found" };
    const campaign = await ctx.runQuery(api.campaigns.getCampaign, { id: contrib.campaignId });
    if (!campaign) return { ok: false, error: "campaign_not_found" };
    const creator = await ctx.db.get(campaign.creatorId);
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
    if (action.token !== contrib.token) {
      return { ok: false, error: "token_mismatch" };
    }
    if (parseFloat(action.amount) !== parseFloat(contrib.amount)) {
      return { ok: false, error: "amount_mismatch" };
    }

    await ctx.runMutation(api.campaigns.markContributionPaid, { id: contributionId, txHash });

    // Update raisedAmount (best-effort)
    const raised = parseFloat(campaign.raisedAmount || "0");
    const amt = parseFloat(contrib.amount);
    const newRaised = (raised + amt).toString();
    await ctx.runMutation(api.campaigns.updateCampaign, { id: campaign._id, status: campaign.status, description: campaign.description, name: campaign.name });
    await ctx.db.patch(campaign._id, { raisedAmount: newRaised });

    // Normalized payment if payer is known
    if (contrib.payerUserId) {
      await ctx.runMutation(api.campaigns.recordPayment, {
        userId: contrib.payerUserId,
        creatorId: campaign.creatorId,
        type: "pledge",
        token: contrib.token,
        amount: contrib.amount,
        status: "paid",
        txHash,
        payerAddress: (contrib.fromAddress ?? tx.user ?? null) ?? undefined,
      });
    }
    return { ok: true };
  },
});

export const getContribution = query({
  args: { id: v.id("pledgeContributions") },
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

export const markContributionPaid = mutation({
  args: { id: v.id("pledgeContributions"), txHash: v.optional(v.string()) },
  handler: async (ctx, { id, txHash }) => {
    await ctx.db.patch(id, { status: "paid", txHash });
    return await ctx.db.get(id);
  },
});

// -------- Donations ---------

export const recordDonation = mutation({
  args: {
    creatorId: v.id("users"),
    payerUserId: v.optional(v.id("users")),
    fromAddress: v.optional(v.string()),
    token: v.string(),
    amount: v.string(),
    txHash: v.optional(v.string()),
    txMetadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    if (args.txHash) {
      const existing = await ctx.db
        .query("txHashes")
        .withIndex("by_hash", (q) => q.eq("hash", args.txHash!))
        .unique();
      if (!existing) {
        await ctx.db.insert("txHashes", { hash: args.txHash!, metadata: args.txMetadata });
      }
    }
    const donationId = await ctx.db.insert("donations", {
      creatorId: args.creatorId,
      payerUserId: args.payerUserId,
      fromAddress: args.fromAddress?.toLowerCase(),
      token: args.token,
      amount: args.amount,
      txHash: args.txHash,
    });

    if (args.payerUserId) {
      await ctx.db.insert("payments", {
        userId: args.payerUserId,
        creatorId: args.creatorId,
        type: "donation",
        token: args.token,
        amount: args.amount,
        status: "paid",
        txHash: args.txHash,
        payerAddress: args.fromAddress?.toLowerCase(),
      });
    }

    return donationId;
  },
});

export const listDonationsByCreator = query({
  args: { creatorId: v.id("users") },
  handler: async (ctx, { creatorId }) => {
    return await ctx.db
      .query("donations")
      .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
      .collect();
  },
});

// -------- Shared Payment Writer --------

export const recordPayment = mutation({
  args: {
    userId: v.id("users"),
    creatorId: v.optional(v.id("users")),
    type: v.union(v.literal("donation"), v.literal("pledge")),
    token: v.string(),
    amount: v.string(),
    status: v.union(v.literal("pending"), v.literal("paid"), v.literal("failed"), v.literal("refunded")),
    txHash: v.optional(v.string()),
    payerAddress: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("payments", args);
  },
});
