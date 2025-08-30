// convex/address.ts
import { query } from "./_generated/server";
import { v } from "convex/values";
import { operatorAccount } from "./lib/hyperliquid";

export const resolveAddressToUser = query({
  args: { address: v.string() },
  handler: async (ctx, { address }) => {
    const normalized = address.toLowerCase();

    // Try direct personal wallet match
    const direct = await ctx.db
      .query("users")
      .withIndex("by_evm", (q) => q.eq("evmAddress", normalized))
      .unique();
    if (direct) {
      return {
        userId: direct._id,
        paymentType: "personal" as const,
        resolvedAddress: normalized,
        userPersonalAddress: direct.evmAddress,
        pledgeWalletAddress: undefined as string | undefined,
      };
    }

    // Try pledge wallet match
    const pledgeMatch = await ctx.db
      .query("pledgeWalletAccounts")
      .withIndex("by_address", (q) => q.eq("address", normalized))
      .unique();
    if (pledgeMatch) {
      const user = await ctx.db
        .query("users")
        .withIndex("by_evm", (q) => q.eq("evmAddress", pledgeMatch.userAddress.toLowerCase()))
        .unique();
      if (user) {
        return {
          userId: user._id,
          paymentType: "pledge-wallet" as const,
          resolvedAddress: normalized,
          userPersonalAddress: user.evmAddress,
          pledgeWalletAddress: pledgeMatch.address,
        };
      }
    }
    return null;
  },
});

export const isOperatorAddress = query({
  args: { address: v.string() },
  handler: async (_ctx, { address }) => {
    try {
      const op = operatorAccount();
      return address.toLowerCase() === op.address.toLowerCase();
    } catch {
      return false;
    }
  },
});

export const resolvePaymentWithEdgeCases = query({
  args: { address: v.string(), invoicePayerAddress: v.optional(v.string()) },
  handler: async (ctx, { address, invoicePayerAddress }) => {
    const normalized = address.toLowerCase();
    const resolution = await ctx.runQuery(resolveAddressToUser, { address: normalized });
    const isOperator = await ctx.runQuery(isOperatorAddress, { address: normalized });

    const edgeCases = {
      isOperatorPayment: isOperator,
      isUnauthorizedPayment: false,
      isValidPayment: false,
      warningMessage: undefined as string | undefined,
    };

    if (edgeCases.isOperatorPayment) {
      edgeCases.warningMessage = "Payment comes from system operator address";
      edgeCases.isValidPayment = false;
      return { resolution, edgeCases };
    }

    if (!resolution) {
      edgeCases.isUnauthorizedPayment = true;
      if (!invoicePayerAddress) {
        edgeCases.isValidPayment = true;
        edgeCases.warningMessage = "Payment address is not associated with any known user - will register via payment";
      } else if (invoicePayerAddress.toLowerCase() === normalized) {
        edgeCases.isValidPayment = true;
        edgeCases.warningMessage = "Payment address is not associated with any known user - will register via payment";
      } else {
        edgeCases.isValidPayment = false;
        edgeCases.warningMessage = "Payment address is not associated with any known user and does not match designated payer";
      }
      return { resolution, edgeCases };
    }

    if (invoicePayerAddress) {
      const target = await ctx.runQuery(resolveAddressToUser, { address: invoicePayerAddress });
      if (!target) {
        edgeCases.isValidPayment = false;
        edgeCases.warningMessage = "Designated payer address cannot be resolved";
        return { resolution, edgeCases };
      }
      edgeCases.isValidPayment = resolution.userId === target.userId;
      if (!edgeCases.isValidPayment) {
        edgeCases.isUnauthorizedPayment = true;
        edgeCases.warningMessage = "Payment from address is not authorized for designated payer";
      }
    } else {
      edgeCases.isValidPayment = true;
    }

    return { resolution, edgeCases };
  },
});

export const isAddressAuthorizedForUser = query({
  args: { address: v.string(), targetUserId: v.id("users") },
  handler: async (ctx, { address, targetUserId }) => {
    const res = await ctx.runQuery(resolveAddressToUser, { address });
    return res?.userId === targetUserId;
  },
});

export const getPledgeWalletDetails = query({
  args: { pledgeWalletAddress: v.string() },
  handler: async (ctx, { pledgeWalletAddress }) => {
    const normalized = pledgeWalletAddress.toLowerCase();
    const pledgeWalletAccount = await ctx.db
      .query("pledgeWalletAccounts")
      .withIndex("by_address", (q) => q.eq("address", normalized))
      .unique();
    if (!pledgeWalletAccount) {
      return { pledgeWalletAccount: null, primaryUser: null, operatorAddress: null };
    }
    const primaryUser = await ctx.db
      .query("users")
      .withIndex("by_evm", (q) => q.eq("evmAddress", pledgeWalletAccount.userAddress.toLowerCase()))
      .unique();
    return {
      pledgeWalletAccount,
      primaryUser,
      operatorAddress: pledgeWalletAccount.operatorAddress,
    };
  },
});
