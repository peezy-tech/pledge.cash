#!/usr/bin/env bun

import * as hl from "@nktkas/hyperliquid";
import { db } from "@repo/db";
import * as schema from "@repo/db/schema";
import { eq } from "drizzle-orm";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";

type Address = `0x${string}`;

const IS_TESTNET = true;
const transport = new hl.HttpTransport({ isTestnet: IS_TESTNET });
const infoClient = new hl.InfoClient({ transport });

const CACHE_PATH = path.resolve(import.meta.dir, "../seed_onchain.cache.json");

type Cache = {
  version: 1;
  createdAt: string;
  token?: string;
  operator?: { address: Address };
  creator?: { address: Address; privateKey?: `0x${string}` };
  transfers?: {
    invoice?: { amount: string; txHash: Address };
    donation?: { amount: string; txHash: Address };
    recurring?: { amount: string; txHash: Address };
  };
  pledgeWallet?: {
    user?: { address: Address; privateKey?: `0x${string}` };
    operator?: { address: Address; privateKey?: `0x${string}` };
    pledge?: { address: Address; privateKey?: `0x${string}` };
    agent?: { address: Address; privateKey?: `0x${string}` };
    approveAgentTxHash?: Address;
    convertToMultiSigTxHash?: Address;
  };
};

function loadCache(): Cache {
  if (!existsSync(CACHE_PATH)) {
    return { version: 1, createdAt: new Date().toISOString() } as Cache;
  }
  const raw = readFileSync(CACHE_PATH, "utf8");
  const parsed = JSON.parse(raw) as Cache;
  return parsed;
}

function saveCache(cache: Cache) {
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

async function txOk(hash: Address, expected: { user?: Address; destination?: Address; token?: string; amount?: string }) {
  const d = await infoClient.txDetails({ hash });
  if (!d || (d as any).error) return false;
  const action = (d as any).action || {};
  const user = ((d as any).user || "").toLowerCase();
  const dest = ((action.destination || "") as string).toLowerCase();
  if (expected.user && user !== expected.user.toLowerCase()) return false;
  if (expected.destination && dest !== expected.destination.toLowerCase()) return false;
  if (expected.token && action.token !== expected.token) return false;
  if (expected.amount && String(action.amount) !== String(expected.amount)) return false;
  return true;
}

async function main() {
  const cache = loadCache();

  const operatorPk = (process.env.OPERATOR_PRIVATE_KEY || "").trim();
  const operatorAddress = operatorPk ? privateKeyToAccount(operatorPk as `0x${string}`).address : undefined;
  if (!operatorAddress) {
    console.warn("OPERATOR_PRIVATE_KEY not set; proceeding without operator address constraint.");
  }

  // Build simple maps for lookups
  const users = await db.select().from(schema.users);
  const userById = new Map(users.map((u) => [u.id, u]));
  const userByAddress = new Map(users.map((u) => [String(u.evm_address).toLowerCase(), u]));

  // 1) Invoice (paid)
  const invoices = await db.select().from(schema.hyperliquidInvoices);
  const paidInvoices = invoices
    .filter((i) => i.status === "paid" && i.txHash)
    .sort((a, b) => (b.paidAt ?? 0) - (a.paidAt ?? 0));
  let chosenInvoice: typeof paidInvoices[number] | undefined;
  for (const inv of paidInvoices) {
    const creatorAddr = userById.get(inv.creatorId)?.evm_address as Address | undefined;
    if (!creatorAddr) continue;
    const ok = await txOk(inv.txHash as Address, {
      destination: creatorAddr,
      token: inv.token,
      amount: inv.amount,
      user: operatorAddress, // if available
    });
    if (ok) {
      chosenInvoice = inv;
      cache.creator = cache.creator ?? { address: creatorAddr };
      cache.creator.address = creatorAddr;
      cache.transfers = cache.transfers ?? {};
      cache.transfers.invoice = { amount: inv.amount, txHash: inv.txHash as Address };
      cache.token = cache.token ?? inv.token;
      break;
    }
  }

  // 2) Donation (paid)
  const donations = await db.select().from(schema.donations);
  const paidDonations = donations
    .filter((d) => !!d.txHash)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  for (const d of paidDonations) {
    const creatorAddr = userById.get(d.creatorId)?.evm_address as Address | undefined;
    if (!creatorAddr || !d.txHash) continue;
    const ok = await txOk(d.txHash as Address, {
      destination: creatorAddr,
      token: d.token,
      amount: d.amount,
      user: operatorAddress,
    });
    if (ok) {
      cache.transfers = cache.transfers ?? {};
      cache.transfers.donation = { amount: d.amount, txHash: d.txHash as Address };
      if (!cache.token) cache.token = d.token;
      break;
    }
  }

  // 3) Recurring charge (paid)
  const plans = await db.select().from(schema.recurringPlans);
  const plansById = new Map(plans.map((p) => [p.id, p]));
  const charges = await db.select().from(schema.recurringCharges);
  const paidCharges = charges
    .filter((c) => c.status === "paid" && c.txHash)
    .sort((a, b) => (b.runAt ?? 0) - (a.runAt ?? 0));
  for (const c of paidCharges) {
    const plan = plansById.get(c.planId);
    if (!plan || !c.txHash) continue;
    const creatorAddr = userById.get(plan.creatorId)?.evm_address as Address | undefined;
    if (!creatorAddr) continue;
    const ok = await txOk(c.txHash as Address, {
      destination: creatorAddr,
      token: c.token,
      amount: c.amount,
      user: operatorAddress,
    });
    if (ok) {
      cache.transfers = cache.transfers ?? {};
      cache.transfers.recurring = { amount: c.amount, txHash: c.txHash as Address };
      if (!cache.token) cache.token = c.token;
      break;
    }
  }

  // 4) Pledge wallet + agent
  const pledgeWallets = await db.select().from(schema.pledgeWalletAccounts);
  // Pick the newest by createdAt
  const latestPw = pledgeWallets.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0];
  if (latestPw) {
    cache.pledgeWallet = cache.pledgeWallet ?? {};
    cache.pledgeWallet.user = cache.pledgeWallet.user ?? ({} as any);
    cache.pledgeWallet.operator = cache.pledgeWallet.operator ?? ({} as any);
    cache.pledgeWallet.pledge = cache.pledgeWallet.pledge ?? ({} as any);

    cache.pledgeWallet.user.address = latestPw.userAddress as Address;
    cache.pledgeWallet.operator.address = latestPw.operatorAddress as Address;
    cache.pledgeWallet.operator.privateKey = latestPw.operatorPrivateKey as `0x${string}`;
    cache.pledgeWallet.pledge.address = latestPw.address as Address;

    // Agent wallet (if any)
    const agents = await db.select().from(schema.agentWallets);
    const agent = agents.find((a) => a.pledgeWalletId === latestPw.id);
    if (agent) {
      cache.pledgeWallet.agent = cache.pledgeWallet.agent ?? ({} as any);
      cache.pledgeWallet.agent.address = agent.address as Address;
    }
  }

  // Set/refresh operator
  if (operatorAddress) {
    cache.operator = { address: operatorAddress as Address };
  }

  // Update timestamp and save
  cache.createdAt = new Date().toISOString();
  cache.version = 1;
  saveCache(cache);
  console.log("✅ Cache updated:", CACHE_PATH);
}

main().catch((e) => {
  console.error("❌ Failed to update cache:", e);
  process.exit(1);
});

