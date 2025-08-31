// convex/pledgeWallet.ts
import { query, mutation, action } from "./_generated/server";
import { api } from "./_generated/api";
import { v } from "convex/values";
import { infoClient, operatorAccount, operatorExchangeClient, usdcTokenString, transport, isTestnet } from "./lib/hyperliquid";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

// NOTE: These functions provide a Convex-based surface for pledge wallet
// operations. External provider calls are omitted; this module simulates the
// necessary DB changes and returns placeholder addresses.

export const getOperator = query({
  args: {},
  handler: async () => {
    const op = operatorAccount();
    return { operator: op.address };
  },
});

export const getByUserAddress = query({
  args: { userAddress: v.optional(v.string()) },
  handler: async (ctx, { userAddress }) => {
    if (!userAddress) return null;
    return await ctx.db
      .query("pledgeWalletAccounts")
      .withIndex("by_user_address", (q) => q.eq("userAddress", userAddress))
      .unique();
  },
});

export const init = action({
  args: { userAddress: v.string(), agentWalletAddress: v.string(), txHash: v.string() },
  handler: async (ctx, { userAddress, agentWalletAddress, txHash }) => {
    // Validate funding tx: user -> operator funding address, token USDC, amount '5'
    const ic = infoClient();
    const op = operatorAccount();
    const tx = await ic.txDetails({ hash: txHash });
    if (!tx || tx.error || tx.action.type !== "spotSend") {
      return { success: false, error: "invalid_tx" };
    }
    if ((tx.action as any).destination?.toLowerCase() !== op.address.toLowerCase()) {
      return { success: false, error: "destination_mismatch" };
    }
    const token = await usdcTokenString();
    if ((tx.action as any).token !== token) {
      return { success: false, error: "token_mismatch" };
    }
    if ((tx.action as any).amount !== "5") {
      return { success: false, error: "amount_mismatch" };
    }
    if ((tx as any).user?.toLowerCase() !== userAddress.toLowerCase()) {
      return { success: false, error: "user_mismatch" };
    }

    // Ensure Convex user exists for this address (idempotent)
    await ctx.runMutation(api.users.ensure, { evmAddress: userAddress });

    // Ensure no existing pledge wallet
    const existing = await ctx.runQuery(api.pledgeWallet.getByUserAddress, { userAddress });
    if (existing) return { success: false, error: "already_initialized" };

    // Generate operator + pledge wallet accounts
    const userOperatorWalletPrivateKey = generatePrivateKey();
    const userOperatorWallet = privateKeyToAccount(userOperatorWalletPrivateKey);
    const pledgeWalletAccountPrivateKey = generatePrivateKey();
    const pledgeWalletAccount = privateKeyToAccount(pledgeWalletAccountPrivateKey);

    // Insert record
    const recordId = await ctx.runMutation(api.pledgeWallet.createAccount, {
      userAddress,
      operatorAddress: userOperatorWallet.address,
      operatorPrivateKey: userOperatorWalletPrivateKey,
      address: pledgeWalletAccount.address,
    });
    const pledgeRecord = await ctx.db.get(recordId);

    // Seed/register via operator exchange client (0 USDC sends)
    const operatorClient = operatorExchangeClient();
    await operatorClient.spotSend({ destination: userOperatorWallet.address, token, amount: "1" });
    await operatorClient.spotSend({ destination: pledgeWalletAccount.address, token, amount: "1" });

    // Approve agent and convert to multisig using pledge wallet account
    const { ExchangeClient } = await import("@nktkas/hyperliquid");
    const pledgeClient = new ExchangeClient({
      transport: transport(),
      wallet: pledgeWalletAccount,
      isTestnet: isTestnet(),
    });
    await pledgeClient.approveAgent({ agentAddress: agentWalletAddress as `0x${string}`, agentName: "Frontend" });
    await pledgeClient.convertToMultiSigUser({ authorizedUsers: [userAddress as `0x${string}`, userOperatorWallet.address as `0x${string}`], threshold: 1 });

    // Link agent wallet
    if (pledgeRecord) {
      await ctx.runMutation(api.pledgeWallet.addAgentWallet, {
        pledgeWalletId: pledgeRecord._id,
        userAddress,
        agentWalletAddress,
      });
    }

    return {
      success: true,
      pledgeWallet: pledgeWalletAccount.address,
      operator: userOperatorWallet.address,
    };
  },
});

export const createAccount = mutation({
  args: { userAddress: v.string(), operatorAddress: v.string(), operatorPrivateKey: v.string(), address: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.insert("pledgeWalletAccounts", args);
  },
});

export const addAgentWallet = mutation({
  args: { pledgeWalletId: v.id("pledgeWalletAccounts"), userAddress: v.string(), agentWalletAddress: v.string() },
  handler: async (ctx, { pledgeWalletId, userAddress, agentWalletAddress }) => {
    // Find the user by address if present in Convex users
    const user = await ctx.db
      .query("users")
      .withIndex("by_evm", (q) => q.eq("evmAddress", userAddress.toLowerCase()))
      .unique();
    if (!user) return null;
    return await ctx.db.insert("agentWallets", {
      pledgeWalletId,
      userId: user._id,
      address: agentWalletAddress,
    });
  },
});
