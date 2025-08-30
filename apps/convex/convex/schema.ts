// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// NOTE: This schema is a focused subset of the existing @repo/db models,
// tailored for Convex. It covers users, subscriptions (recurring), and
// normalized payments to support the scheduling pattern from the guide.

export default defineSchema({
  users: defineTable({
    evmAddress: v.string(),
    // Extend with profile fields as needed
  }).index("by_evm", ["evmAddress"]),

  subscriptions: defineTable({
    // Payer (subscriber)
    userId: v.id("users"),
    // Optional recipient for recurring transfers
    creatorId: v.optional(v.id("users")),
    amount: v.string(),
    token: v.string(),
    cadence: v.union(
      v.literal("monthly"),
      v.literal("weekly"),
      v.literal("daily")
    ),
    autopayEnabled: v.boolean(),
    nextChargeAtMs: v.number(),
    status: v.union(
      v.literal("active"),
      v.literal("paused"),
      v.literal("canceled")
    ),
    lastAttemptKey: v.optional(v.string()),
  })
    .index("by_next", ["nextChargeAtMs"])
    .index("by_user", ["userId"]),

  payments: defineTable({
    subscriptionId: v.optional(v.id("subscriptions")),
    // Payer
    userId: v.id("users"),
    // Optional recipient for reporting
    creatorId: v.optional(v.id("users")),
    payerAddress: v.optional(v.string()),
    type: v.union(
      v.literal("invoice"),
      v.literal("donation"),
      v.literal("recurring"),
      v.literal("pledge")
    ),
    token: v.string(),
    amount: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("paid"),
      v.literal("failed"),
      v.literal("refunded")
    ),
    txHash: v.optional(v.string()),
  })
    .index("by_user", ["userId"]) 
    .index("by_status", ["status"]) 
    .index("by_creator", ["creatorId"]),

  txHashes: defineTable({
    hash: v.string(),
    metadata: v.optional(v.any()),
  }).index("by_hash", ["hash"]),

  // Pledge campaigns and pledges
  pledgeCampaigns: defineTable({
    creatorId: v.id("users"),
    name: v.string(),
    description: v.optional(v.string()),
    goalToken: v.string(),
    goalAmount: v.string(),
    raisedAmount: v.string(), // store as decimal string
    status: v.union(v.literal("active"), v.literal("paused"), v.literal("completed")),
  })
    .index("by_creator", ["creatorId"]) 
    .index("by_status", ["status"]),

  pledges: defineTable({
    campaignId: v.id("pledgeCampaigns"),
    pledgerUserId: v.optional(v.id("users")),
    pledgerAddress: v.optional(v.string()),
    token: v.string(),
    amountPerCadence: v.string(),
    cadence: v.union(v.literal("daily"), v.literal("weekly"), v.literal("monthly")),
    autopayEnabled: v.boolean(),
    nextRunAt: v.number(),
    status: v.union(v.literal("active"), v.literal("paused"), v.literal("cancelled")),
  })
    .index("by_campaign", ["campaignId"]) 
    .index("by_pledger", ["pledgerUserId"]) 
    .index("by_address", ["pledgerAddress"]),

  pledgeContributions: defineTable({
    pledgeId: v.optional(v.id("pledges")),
    campaignId: v.id("pledgeCampaigns"),
    payerUserId: v.optional(v.id("users")),
    fromAddress: v.optional(v.string()),
    token: v.string(),
    amount: v.string(),
    status: v.union(v.literal("pending"), v.literal("paid"), v.literal("failed")),
    txHash: v.optional(v.string()),
  })
    .index("by_campaign", ["campaignId"]) 
    .index("by_pledge", ["pledgeId"]),

  donations: defineTable({
    creatorId: v.id("users"),
    payerUserId: v.optional(v.id("users")),
    fromAddress: v.optional(v.string()),
    token: v.string(),
    amount: v.string(),
    txHash: v.optional(v.string()),
  })
    .index("by_creator", ["creatorId"]),

  invoices: defineTable({
    creatorId: v.id("users"),
    payerUserId: v.optional(v.id("users")),
    payerAddress: v.optional(v.string()),
    paymentType: v.optional(v.union(v.literal("personal"), v.literal("pledge-wallet"))),
    actualPayerAddress: v.optional(v.string()),
    token: v.string(),
    amount: v.string(),
    description: v.optional(v.string()),
    status: v.union(v.literal("pending"), v.literal("paid"), v.literal("expired")),
    txHash: v.optional(v.string()),
    paidAt: v.optional(v.number()),
  })
    .index("by_creator", ["creatorId"]) 
    .index("by_status", ["status"]),

  // Recurring plans & charges (for parity with legacy endpoints)
  recurringPlans: defineTable({
    creatorId: v.id("users"),
    payerUserId: v.optional(v.id("users")),
    payerAddress: v.optional(v.string()),
    token: v.string(),
    amount: v.string(),
    cadence: v.union(v.literal("daily"), v.literal("weekly"), v.literal("monthly")),
    startAt: v.number(),
    endAt: v.optional(v.number()),
    autopayEnabled: v.boolean(),
    nextRunAt: v.number(),
    status: v.union(v.literal("active"), v.literal("paused"), v.literal("cancelled")),
  })
    .index("by_creator", ["creatorId"]) 
    .index("by_payerUser", ["payerUserId"]) 
    .index("by_payerAddress", ["payerAddress"]) 
    .index("by_nextRunAt", ["nextRunAt"]),

  recurringCharges: defineTable({
    planId: v.id("recurringPlans"),
    token: v.string(),
    amount: v.string(),
    dueAt: v.number(),
    runAt: v.optional(v.number()),
    status: v.union(v.literal("pending"), v.literal("paid"), v.literal("failed"), v.literal("skipped")),
    txHash: v.optional(v.string()),
    error: v.optional(v.string()),
  }).index("by_plan", ["planId"]),

  // Pledge wallet accounts & agents (ported structures)
  pledgeWalletAccounts: defineTable({
    userAddress: v.string(),
    operatorAddress: v.string(),
    operatorPrivateKey: v.string(),
    address: v.string(),
  }).index("by_user_address", ["userAddress"]).index("by_address", ["address"]),

  agentWallets: defineTable({
    pledgeWalletId: v.id("pledgeWalletAccounts"),
    userId: v.id("users"),
    address: v.string(),
  }).index("by_pledge_wallet", ["pledgeWalletId"]).index("by_user", ["userId"]),
});
