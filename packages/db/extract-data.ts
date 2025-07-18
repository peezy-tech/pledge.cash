#!/usr/bin/env bun

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema.js";
import path from "path";
import { writeFileSync, mkdirSync, existsSync } from "fs";

// Create the database connection specifically for seed.db
const seedDbPath = path.resolve(import.meta.dir, "seed.db");

// Check if seed.db exists
if (!existsSync(seedDbPath)) {
  console.error(`❌ Error: seed.db file not found at ${seedDbPath}`);
  console.error("Please ensure the seed.db file exists in the packages/db directory.");
  process.exit(1);
}

const client = createClient({
  url: `file:${seedDbPath}`,
});

const db = drizzle(client, { schema });

async function extractData() {
  console.log("Starting data extraction from seed.db...");
  
  // Create output directory
  const outputDir = path.resolve(import.meta.dir, "extracted-data");
  mkdirSync(outputDir, { recursive: true });

  try {
    // Extract users
    console.log("Extracting users...");
    const users = await db.select().from(schema.users);
    writeFileSync(
      path.join(outputDir, "users.json"),
      JSON.stringify(users, null, 2)
    );
    console.log(`✓ Extracted ${users.length} users`);

    // Extract txHashes
    console.log("Extracting transaction hashes...");
    const txHashes = await db.select().from(schema.txHashes);
    writeFileSync(
      path.join(outputDir, "txHashes.json"),
      JSON.stringify(txHashes, null, 2)
    );
    console.log(`✓ Extracted ${txHashes.length} transaction hashes`);

    // Extract hyperliquidInvoices
    console.log("Extracting hyperliquid invoices...");
    const hyperliquidInvoices = await db.select().from(schema.hyperliquidInvoices);
    writeFileSync(
      path.join(outputDir, "hyperliquidInvoices.json"),
      JSON.stringify(hyperliquidInvoices, null, 2)
    );
    console.log(`✓ Extracted ${hyperliquidInvoices.length} hyperliquid invoices`);

    // Extract invoiceHooks
    console.log("Extracting invoice hooks...");
    const invoiceHooks = await db.select().from(schema.invoiceHooks);
    writeFileSync(
      path.join(outputDir, "invoiceHooks.json"),
      JSON.stringify(invoiceHooks, null, 2)
    );
    console.log(`✓ Extracted ${invoiceHooks.length} invoice hooks`);

    // Extract pledgeWalletAccounts
    console.log("Extracting pledge wallet accounts...");
    const pledgeWalletAccounts = await db.select().from(schema.pledgeWalletAccounts);
    writeFileSync(
      path.join(outputDir, "pledgeWalletAccounts.json"),
      JSON.stringify(pledgeWalletAccounts, null, 2)
    );
    console.log(`✓ Extracted ${pledgeWalletAccounts.length} pledge wallet accounts`);

    // Extract agentWallets
    console.log("Extracting agent wallets...");
    const agentWallets = await db.select().from(schema.agentWallets);
    writeFileSync(
      path.join(outputDir, "agentWallets.json"),
      JSON.stringify(agentWallets, null, 2)
    );
    console.log(`✓ Extracted ${agentWallets.length} agent wallets`);

    // Create a summary file
    const summary = {
      extractedAt: new Date().toISOString(),
      sourceDatabase: "seed.db",
      tables: {
        users: users.length,
        txHashes: txHashes.length,
        hyperliquidInvoices: hyperliquidInvoices.length,
        invoiceHooks: invoiceHooks.length,
        pledgeWalletAccounts: pledgeWalletAccounts.length,
        agentWallets: agentWallets.length,
      },
      totalRecords: users.length + txHashes.length + hyperliquidInvoices.length + 
                   invoiceHooks.length + pledgeWalletAccounts.length + agentWallets.length,
    };

    writeFileSync(
      path.join(outputDir, "extraction-summary.json"),
      JSON.stringify(summary, null, 2)
    );

    console.log("\n🎉 Data extraction completed successfully!");
    console.log(`📁 Output directory: ${outputDir}`);
    console.log(`📊 Total records extracted: ${summary.totalRecords}`);
    console.log("\nFiles created:");
    console.log("  - users.json");
    console.log("  - txHashes.json");
    console.log("  - hyperliquidInvoices.json");
    console.log("  - invoiceHooks.json");
    console.log("  - pledgeWalletAccounts.json");
    console.log("  - agentWallets.json");
    console.log("  - extraction-summary.json");

  } catch (error) {
    console.error("❌ Error during data extraction:", error);
    process.exit(1);
  } finally {
    // Close the database connection
    client.close();
  }
}

// Run the extraction
extractData(); 