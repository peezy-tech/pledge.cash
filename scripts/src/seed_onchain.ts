#!/usr/bin/env bun

// Real Hyperliquid testnet seeding using funded keys.
// - Performs spot sends on testnet
// - Inserts/updates DB rows with real tx hashes and metadata

import * as hl from "@nktkas/hyperliquid";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { db, migrate } from "@repo/db";
import * as schema from "@repo/db/schema";
import { eq } from "drizzle-orm";
import path from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";

type Address = `0x${string}`;

const IS_TESTNET = true;
const transport = new hl.HttpTransport({ isTestnet: IS_TESTNET });
const infoClient = new hl.InfoClient({ transport });

// Prefer OPERATOR_PRIVATE_KEY as the funded account; fallback to HL_SEED_FROM_PRIVATE_KEY if explicitly set
const operatorPk = (process.env.OPERATOR_PRIVATE_KEY || "").trim() as
  | `0x${string}`
  | "";
const fromPk = (process.env.HL_SEED_FROM_PRIVATE_KEY || operatorPk || "").trim() as
  | `0x${string}`
  | "";
const toPk = (process.env.HL_SEED_TO_PRIVATE_KEY || "").trim() as `0x${string}` | "";
const toAddrEnv = (process.env.HL_SEED_TO_ADDRESS || "").trim() as Address | "";

const invoiceAmount = (process.env.HL_SEED_INVOICE_AMOUNT || "5").trim();
const donationAmount = (process.env.HL_SEED_DONATION_AMOUNT || "2").trim();
const recurringAmount = (process.env.HL_SEED_RECURRING_AMOUNT || "1").trim();

const CACHE_PATH = path.resolve(import.meta.dir, "../seed_onchain.cache.json");

type Cache = {
  version: 1;
  createdAt: string;
  token: string;
  operator: { address: Address };
  creator: { address: Address; privateKey?: `0x${string}` };
  // Canonical single transfers kept for backward compatibility
  transfers?: {
    invoice?: { amount: string; txHash: Address };
    donation?: { amount: string; txHash: Address };
    recurring?: { amount: string; txHash: Address };
  };
  // New: history arrays appended by update_cache_from_db.ts
  transfersHistory?: {
    invoices?: Array<{ amount: string; txHash: Address }>;
    donations?: Array<{ amount: string; txHash: Address }>;
    recurrings?: Array<{ amount: string; txHash: Address }>;
  };
  pledgeWallet: {
    user: { address: Address; privateKey: `0x${string}` };
    operator: { address: Address; privateKey: `0x${string}` };
    pledge: { address: Address; privateKey: `0x${string}` };
    agent: { address: Address; privateKey: `0x${string}` };
    approveAgentTxHash?: Address;
    convertToMultiSigTxHash?: Address;
  };
};

function requireEnv(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`❌ ${msg}`);
    process.exit(1);
  }
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function findUsdcToken(): Promise<string> {
  const meta = await infoClient.spotMeta();
  const usdc = meta.tokens.find((t) => t.name.toUpperCase() === "USDC");
  if (!usdc) throw new Error("USDC token not found on testnet spotMeta");
  return `${usdc.name}:${usdc.tokenId}`;
}

async function awaitLatestSpotSend(
  from: Address,
  destination: Address,
  token: string,
  amount: string,
  timeoutMs = 30_000,
): Promise<hl.TransactionDetails> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = await infoClient.userDetails({ user: from });
    const tx = list
      .filter(
        (tx: any) =>
          tx.action?.type === "spotSend" &&
          (tx.action.destination || "").toLowerCase() === destination.toLowerCase() &&
          tx.action.token === token &&
          String(tx.action.amount) === String(amount) &&
          tx.error === null,
      )
      .sort((a: any, b: any) => b.time - a.time)[0];
    if (tx) {
      // fetch full details by hash to store as metadata
      const details = await infoClient.txDetails({ hash: tx.hash as Address });
      return details as hl.TransactionDetails;
    }
    await sleep(2_000);
  }
  throw new Error("Timed out waiting for matching spotSend transaction");
}

async function getOrCreateUserByAddress(address: Address, name?: string, userType: "user" | "admin" = "user") {
  const existing = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.evm_address, address))
    .get();
  if (existing) return existing;
  const created = await db
    .insert(schema.users)
    .values({ name, evm_address: address })
    .returning()
    .get();
  return created;
}

async function clearTables() {
  await db.delete(schema.invoiceHooks);
  await db.delete(schema.recurringCharges);
  await db.delete(schema.pledgeContributions);
  await db.delete(schema.pledges);
  await db.delete(schema.pledgeCampaigns);
  await db.delete(schema.donations);
  await db.delete(schema.payments);
  await db.delete(schema.hyperliquidInvoices);
  await db.delete(schema.agentWallets);
  await db.delete(schema.pledgeWalletAccounts);
  await db.delete(schema.txHashes);
  await db.delete(schema.recurringPlans);
  await db.delete(schema.users);
}

function loadCache(): Cache | null {
  if (!existsSync(CACHE_PATH)) return null;
  try {
    const raw = readFileSync(CACHE_PATH, "utf8");
    const c = JSON.parse(raw) as Cache;
    if (c.version !== 1) throw new Error("Unsupported cache version");
    return c;
  } catch (e) {
    console.error("Failed to load cache:", e);
    return null;
  }
}

async function validateCache(cache: Cache) {
  const check = async (
    label: string,
    txHash: Address,
    expected: { user: Address; destination: Address; token: string; amount: string },
  ) => {
    const d = await infoClient.txDetails({ hash: txHash });
    if (!d || (d as any).error) throw new Error(`${label}: tx not found or error`);
    const action = (d as any).action || {};
    const user = ((d as any).user || "").toLowerCase();
    const dest = ((action.destination || "") as string).toLowerCase();
    if (
      action.type !== "spotSend" ||
      user !== expected.user.toLowerCase() ||
      dest !== expected.destination.toLowerCase() ||
      action.token !== expected.token ||
      String(action.amount) !== String(expected.amount)
    ) {
      throw new Error(`${label}: tx details mismatch`);
    }
  };

  const invoices = cache.transfersHistory?.invoices || [];
  const donations = cache.transfersHistory?.donations || [];
  const recurrings = cache.transfersHistory?.recurrings || [];

  if (invoices.length === 0 && donations.length === 0 && recurrings.length === 0) {
    throw new Error("Cache has no transfersHistory entries to validate");
  }

  for (const [idx, inv] of invoices.entries()) {
    await check(`invoice[${idx}]`, inv.txHash, {
      user: cache.operator.address,
      destination: cache.creator.address,
      token: cache.token,
      amount: inv.amount,
    });
  }
  for (const [idx, d] of donations.entries()) {
    await check(`donation[${idx}]`, d.txHash, {
      user: cache.operator.address,
      destination: cache.creator.address,
      token: cache.token,
      amount: d.amount,
    });
  }
  for (const [idx, r] of recurrings.entries()) {
    await check(`recurring[${idx}]`, r.txHash, {
      user: cache.operator.address,
      destination: cache.creator.address,
      token: cache.token,
      amount: r.amount,
    });
  }
}

async function seedFromCache(cache: Cache) {
  console.log("📦 Using existing on-chain cache to seed DB...");
  await migrate();
  await clearTables();

  const operatorUser = await getOrCreateUserByAddress(cache.operator.address, "Operator", "admin");
  const creatorUser = await getOrCreateUserByAddress(cache.creator.address, "Creator");
  const pledgeUser = await getOrCreateUserByAddress(cache.pledgeWallet.user.address, "Pledge User");

  const invoices = cache.transfersHistory?.invoices || [];
  const donations = cache.transfersHistory?.donations || [];
  const recurrings = cache.transfersHistory?.recurrings || [];
  if (invoices.length === 0 && donations.length === 0 && recurrings.length === 0) {
    throw new Error("Cache has no transfersHistory entries to seed");
  }

  // tx hashes
  const hashSet = new Set<Address>();
  for (const x of invoices) hashSet.add(x.txHash);
  for (const x of donations) hashSet.add(x.txHash);
  for (const x of recurrings) hashSet.add(x.txHash);
  for (const h of hashSet) {
    const d = await infoClient.txDetails({ hash: h });
    await db.insert(schema.txHashes).values({ hash: h, metadata: d }).onConflictDoNothing?.();
  }

  // Invoices (paid)
  for (const inv of invoices) {
    const invoiceRow = await db
      .insert(schema.hyperliquidInvoices)
      .values({
        creatorId: creatorUser.id,
        payerUserId: operatorUser.id,
        payerAddress: cache.operator.address,
        token: cache.token,
        amount: inv.amount,
        description: "On-chain seeded invoice",
        status: "paid",
        txHash: inv.txHash,
        paidAt: Date.now(),
        actualPayerAddress: cache.operator.address,
        paymentType: "personal",
      })
      .returning()
      .get();

    await db.insert(schema.payments).values({
      type: "invoice",
      sourceId: invoiceRow.id,
      creatorId: creatorUser.id,
      payerUserId: operatorUser.id,
      payerAddress: cache.operator.address,
      token: cache.token,
      amount: inv.amount,
      status: "paid",
      txHash: inv.txHash,
      paidAt: Date.now(),
      metadata: { via: "seed_onchain_cache", context: "invoice" },
    });
  }

  // Donation
  for (const d of donations) {
    const donationRow = await db
      .insert(schema.donations)
      .values({
        creatorId: creatorUser.id,
        payerUserId: operatorUser.id,
        fromAddress: cache.operator.address,
        token: cache.token,
        amount: d.amount,
        txHash: d.txHash,
      })
      .returning()
      .get();

    await db.insert(schema.payments).values({
      type: "donation",
      sourceId: donationRow.id,
      creatorId: creatorUser.id,
      payerUserId: operatorUser.id,
      payerAddress: cache.operator.address,
      token: cache.token,
      amount: d.amount,
      status: "paid",
      txHash: d.txHash,
      paidAt: Date.now(),
      metadata: { via: "seed_onchain_cache", context: "donation" },
    });
  }

  // Recurring
  for (const r of recurrings) {
    const plan = await db
      .insert(schema.recurringPlans)
      .values({
        creatorId: creatorUser.id,
        payerUserId: operatorUser.id,
        payerAddress: cache.operator.address,
        token: cache.token,
        amount: r.amount,
        cadence: "monthly",
        nextRunAt: Date.now(),
        autopayEnabled: false,
        status: "active",
      })
      .returning()
      .get();

    const charge = await db
      .insert(schema.recurringCharges)
      .values({
        planId: plan.id,
        token: cache.token,
        amount: r.amount,
        dueAt: Date.now(),
        runAt: Date.now(),
        status: "paid",
        txHash: r.txHash,
      })
      .returning()
      .get();

    await db.insert(schema.payments).values({
      type: "recurring",
      sourceId: charge.id,
      creatorId: creatorUser.id,
      payerUserId: operatorUser.id,
      payerAddress: cache.operator.address,
      token: cache.token,
      amount: r.amount,
      status: "paid",
      txHash: r.txHash,
      paidAt: Date.now(),
      metadata: { via: "seed_onchain_cache", context: "recurring" },
    });
  }

  // Pledge wallet + agent wallet
  const pw = await db
    .insert(schema.pledgeWalletAccounts)
    .values({
      userAddress: cache.pledgeWallet.user.address,
      operatorAddress: cache.pledgeWallet.operator.address,
      operatorPrivateKey: cache.pledgeWallet.operator.privateKey,
      address: cache.pledgeWallet.pledge.address,
    })
    .returning()
    .get();

  await db.insert(schema.agentWallets).values({
    pledgeWalletId: pw.id,
    userId: pledgeUser.id,
    address: cache.pledgeWallet.agent.address,
  });
}

async function main() {
  console.log(`🔗 On-chain seed starting (Hyperliquid testnet)...
Assumptions: OPERATOR_PRIVATE_KEY is the only funded key.`);

  const cache = loadCache();
  if (cache) {
    console.log("Found cache:", CACHE_PATH);
    await validateCache(cache);
    await seedFromCache(cache);
    console.log("✅ Seeded from cache");
    return;
  }

  requireEnv(!!fromPk, "Set OPERATOR_PRIVATE_KEY (or HL_SEED_FROM_PRIVATE_KEY) with a funded testnet key");

  // Ensure DB schema exists
  await migrate();

  const fromAccount = privateKeyToAccount(fromPk);
  // Choose a receiver (creator). If not specified, generate a new account.
  const creatorAccount = toPk
    ? privateKeyToAccount(toPk)
    : toAddrEnv
    ? ({ address: toAddrEnv } as any)
    : privateKeyToAccount(generatePrivateKey());
  const toAddress: Address = creatorAccount.address as Address;

  const token = await findUsdcToken();
  console.log("USDC token:", token);

  const fromExchange = new hl.ExchangeClient({
    transport,
    wallet: fromAccount,
    isTestnet: IS_TESTNET,
  });

  // Upsert users
  const payer = await getOrCreateUserByAddress(fromAccount.address, "Operator");
  const creator = await getOrCreateUserByAddress(toAddress, "Creator");

  // 1) Create an invoice (pending), then pay it on-chain, then confirm it in DB
  console.log("🧾 Creating invoice and paying on-chain...");
  const invoice = await db
    .insert(schema.hyperliquidInvoices)
    .values({
      creatorId: creator.id,
      payerUserId: payer.id,
      payerAddress: fromAccount.address,
      token,
      amount: invoiceAmount,
      description: "On-chain seeded invoice",
      status: "pending",
    })
    .returning()
    .get();

  await fromExchange.spotSend({
    destination: toAddress,
    token: token as `${string}:0x${string}`,
    amount: invoiceAmount,
  });
  const invTx = await awaitLatestSpotSend(
    fromAccount.address,
    toAddress,
    token,
    invoiceAmount,
  );

  // txHashes insert
  await db
    .insert(schema.txHashes)
    .values({ hash: invTx.hash as Address, metadata: invTx })
    .onConflictDoNothing?.();

  const updatedInvoice = await db
    .update(schema.hyperliquidInvoices)
    .set({
      status: "paid",
      txHash: invTx.hash as Address,
      paidAt: Date.now(),
      actualPayerAddress: fromAccount.address,
      paymentType: "personal",
    })
    .where(eq(schema.hyperliquidInvoices.id, invoice.id))
    .returning()
    .get();

  await db.insert(schema.payments).values({
    type: "invoice",
    sourceId: invoice.id,
    creatorId: creator.id,
    payerUserId: payer.id,
    payerAddress: fromAccount.address,
    token,
    amount: invoiceAmount,
    status: "paid",
    txHash: invTx.hash as Address,
    paidAt: Date.now(),
    metadata: { via: "seed_onchain", context: "invoice" },
  });

  console.log("✅ Invoice paid with tx:", invTx.hash);

  // 2) Donation (simple on-chain transfer recorded as donation)
  console.log("🎁 Creating donation and sending on-chain...");
  await fromExchange.spotSend({
    destination: toAddress,
    token: token as `${string}:0x${string}`,
    amount: donationAmount,
  });
  const donationTx = await awaitLatestSpotSend(
    fromAccount.address,
    toAddress,
    token,
    donationAmount,
  );

  await db
    .insert(schema.txHashes)
    .values({ hash: donationTx.hash as Address, metadata: donationTx })
    .onConflictDoNothing?.();

  const donation = await db
    .insert(schema.donations)
    .values({
      creatorId: creator.id,
      payerUserId: payer.id,
      fromAddress: fromAccount.address,
      token,
      amount: donationAmount,
      txHash: donationTx.hash as Address,
    })
    .returning()
    .get();

  await db.insert(schema.payments).values({
    type: "donation",
    sourceId: donation.id,
    creatorId: creator.id,
    payerUserId: payer.id,
    payerAddress: fromAccount.address,
    token,
    amount: donationAmount,
    status: "paid",
    txHash: donationTx.hash as Address,
    paidAt: Date.now(),
    metadata: { via: "seed_onchain", context: "donation" },
  });

  console.log("✅ Donation sent with tx:", donationTx.hash);

  // 3) Recurring plan + immediate charge (paid)
  console.log("🔁 Creating recurring plan + paid charge...");
  const plan = await db
    .insert(schema.recurringPlans)
    .values({
      creatorId: creator.id,
      payerUserId: payer.id,
      payerAddress: fromAccount.address,
      token,
      amount: recurringAmount,
      cadence: "monthly",
      nextRunAt: Date.now(),
      autopayEnabled: false,
      status: "active",
    })
    .returning()
    .get();

  await fromExchange.spotSend({
    destination: toAddress,
    token: token as `${string}:0x${string}`,
    amount: recurringAmount,
  });
  const chargeTx = await awaitLatestSpotSend(
    fromAccount.address,
    toAddress,
    token,
    recurringAmount,
  );

  await db
    .insert(schema.txHashes)
    .values({ hash: chargeTx.hash as Address, metadata: chargeTx })
    .onConflictDoNothing?.();

  const charge = await db
    .insert(schema.recurringCharges)
    .values({
      planId: plan.id,
      token,
      amount: recurringAmount,
      dueAt: Date.now(),
      runAt: Date.now(),
      status: "paid",
      txHash: chargeTx.hash as Address,
    })
    .returning()
    .get();

  await db.insert(schema.payments).values({
    type: "recurring",
    sourceId: charge.id,
    creatorId: creator.id,
    payerUserId: payer.id,
    payerAddress: fromAccount.address,
    token,
    amount: recurringAmount,
    status: "paid",
    txHash: chargeTx.hash as Address,
    paidAt: Date.now(),
    metadata: { via: "seed_onchain", context: "recurring" },
  });

  // 4) Pledge wallet init: user + operator + pledge account + agent + conversions
  console.log("👛 Initializing pledge wallet (approveAgent + convertToMultiSigUser)...");
  const pledgeUserPk = generatePrivateKey();
  const pledgeUser = privateKeyToAccount(pledgeUserPk);
  const userOperatorPk = generatePrivateKey();
  const userOperator = privateKeyToAccount(userOperatorPk);
  const pledgeWalletPk = generatePrivateKey();
  const pledgeWallet = privateKeyToAccount(pledgeWalletPk);
  const agentPk = generatePrivateKey();
  const agent = privateKeyToAccount(agentPk);

  // Ensure authorized users and pledge wallet exist on L1 by sending a small non-zero amount
  try {
    await fromExchange.spotSend({ destination: pledgeUser.address, token: token as any, amount: "1" });
    await awaitLatestSpotSend(fromAccount.address, pledgeUser.address as Address, token, "1");

    await fromExchange.spotSend({ destination: userOperator.address, token: token as any, amount: "1" });
    await awaitLatestSpotSend(fromAccount.address, userOperator.address as Address, token, "1");

    await fromExchange.spotSend({ destination: pledgeWallet.address, token: token as any, amount: "1" });
    await awaitLatestSpotSend(fromAccount.address, pledgeWallet.address as Address, token, "1");
  } catch (e) {
    console.warn("Registration sends failed:", e);
  }

  const pledgeWalletExchange = new hl.ExchangeClient({
    transport,
    wallet: pledgeWallet,
    isTestnet: IS_TESTNET,
  });

  let approveAgentTxHash: Address | undefined;
  let convertToMultiSigTxHash: Address | undefined;
  try {
    const approveRes = await pledgeWalletExchange.approveAgent({
      agentAddress: agent.address,
      agentName: "SeedAgent",
    });
    approveAgentTxHash = (approveRes as any)?.hash as Address | undefined;
    console.log("✅ approveAgent done", approveAgentTxHash || "(no hash)");
  } catch (e) {
    console.warn("approveAgent failed:", e);
  }

  try {
    const convertRes = await pledgeWalletExchange.convertToMultiSigUser({
      authorizedUsers: [pledgeUser.address, userOperator.address],
      threshold: 1,
    });
    convertToMultiSigTxHash = (convertRes as any)?.hash as Address | undefined;
    console.log("✅ convertToMultiSigUser done", convertToMultiSigTxHash || "(no hash)");
  } catch (e) {
    console.warn("convertToMultiSigUser failed:", e);
  }

  // Insert pledge wallet + agent into DB
  const pledgeDbUser = await getOrCreateUserByAddress(pledgeUser.address, "Pledge User");
  const pw = await db
    .insert(schema.pledgeWalletAccounts)
    .values({
      userAddress: pledgeUser.address,
      operatorAddress: userOperator.address,
      operatorPrivateKey: userOperatorPk,
      address: pledgeWallet.address,
    })
    .returning()
    .get();

  await db.insert(schema.agentWallets).values({
    pledgeWalletId: pw.id,
    userId: pledgeDbUser.id,
    address: agent.address,
  });

  // Write cache for idempotency
  const newCache: Cache = {
    version: 1,
    createdAt: new Date().toISOString(),
    token,
    operator: { address: fromAccount.address as Address },
    creator: { address: toAddress, privateKey: (toPk || !toAddrEnv ? (creatorAccount as any).privateKey : undefined) },
    transfers: {
      invoice: { amount: invoiceAmount, txHash: invTx.hash as Address },
      donation: { amount: donationAmount, txHash: donationTx.hash as Address },
      recurring: { amount: recurringAmount, txHash: chargeTx.hash as Address },
    },
    transfersHistory: {
      invoices: [{ amount: invoiceAmount, txHash: invTx.hash as Address }],
      donations: [{ amount: donationAmount, txHash: donationTx.hash as Address }],
      recurrings: [{ amount: recurringAmount, txHash: chargeTx.hash as Address }],
    },
    pledgeWallet: {
      user: { address: pledgeUser.address as Address, privateKey: pledgeUserPk },
      operator: { address: userOperator.address as Address, privateKey: userOperatorPk },
      pledge: { address: pledgeWallet.address as Address, privateKey: pledgeWalletPk },
      agent: { address: agent.address as Address, privateKey: agentPk },
      approveAgentTxHash,
      convertToMultiSigTxHash,
    },
  };
  try {
    writeFileSync(CACHE_PATH, JSON.stringify(newCache, null, 2));
    console.log("📝 Wrote cache:", CACHE_PATH);
  } catch (e) {
    console.warn("Failed to write cache:", e);
  }

  // Summary
  const counts = {
    users: (await db.select().from(schema.users)).length,
    txHashes: (await db.select().from(schema.txHashes)).length,
    invoices: (await db.select().from(schema.hyperliquidInvoices)).length,
    donations: (await db.select().from(schema.donations)).length,
    recPlans: (await db.select().from(schema.recurringPlans)).length,
    recCharges: (await db.select().from(schema.recurringCharges)).length,
    payments: (await db.select().from(schema.payments)).length,
  };
  console.log("\n🎉 On-chain seed complete:");
  Object.entries(counts).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
}

main().catch((err) => {
  console.error("❌ On-chain seed failed:", err);
  process.exit(1);
});
