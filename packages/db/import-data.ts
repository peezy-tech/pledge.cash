#!/usr/bin/env bun

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate as runLibsqlMigrations } from "drizzle-orm/libsql/migrator";
import * as schema from "./schema.js";
import path from "path";
import { readFileSync, existsSync } from "fs";

async function importData(targetDbName: string = "imported.db") {
  console.log(`Starting database migration and data import to ${targetDbName}...`);
  
  const targetDbPath = path.resolve(import.meta.dir, targetDbName);
  const extractedDataDir = path.resolve(import.meta.dir, "extracted-data");
  
  // Check if extracted data directory exists
  if (!existsSync(extractedDataDir)) {
    console.error(`❌ Error: extracted-data directory not found at ${extractedDataDir}`);
    console.error("Please run the extract-data script first to generate JSON files.");
    process.exit(1);
  }

  // Create database connection
  const client = createClient({
    url: `file:${targetDbPath}`,
  });

  const db = drizzle(client, { schema });

  try {
    // Step 1: Run migrations to set up the schema
    console.log("📋 Running database migrations...");
    await runLibsqlMigrations(db, {
      migrationsFolder: `${import.meta.dir}/drizzle`,
    });
    console.log("✓ Database schema migrated successfully");

    // Step 2: Import data from JSON files
    console.log("\n📥 Starting data import...");

    // Helper function to read and parse JSON files
    const readJsonFile = (filename: string) => {
      const filePath = path.join(extractedDataDir, filename);
      if (!existsSync(filePath)) {
        console.warn(`⚠️  Warning: ${filename} not found, skipping...`);
        return [];
      }
      const content = readFileSync(filePath, "utf-8");
      return JSON.parse(content);
    };

    // Import users
    console.log("Importing users...");
    const users = readJsonFile("users.json");
    if (users.length > 0) {
      await db.insert(schema.users).values(users);
      console.log(`✓ Imported ${users.length} users`);
    } else {
      console.log("⊝ No users to import");
    }

    // Import txHashes
    console.log("Importing transaction hashes...");
    const txHashes = readJsonFile("txHashes.json");
    if (txHashes.length > 0) {
      await db.insert(schema.txHashes).values(txHashes);
      console.log(`✓ Imported ${txHashes.length} transaction hashes`);
    } else {
      console.log("⊝ No transaction hashes to import");
    }

    // Import multisigAccounts
    console.log("Importing multisig accounts...");
    const multisigAccounts = readJsonFile("multisigAccounts.json");
    if (multisigAccounts.length > 0) {
      await db.insert(schema.multisigAccounts).values(multisigAccounts);
      console.log(`✓ Imported ${multisigAccounts.length} multisig accounts`);
    } else {
      console.log("⊝ No multisig accounts to import");
    }

    // Import hyperliquidInvoices
    console.log("Importing hyperliquid invoices...");
    const hyperliquidInvoices = readJsonFile("hyperliquidInvoices.json");
    if (hyperliquidInvoices.length > 0) {
      await db.insert(schema.hyperliquidInvoices).values(hyperliquidInvoices);
      console.log(`✓ Imported ${hyperliquidInvoices.length} hyperliquid invoices`);
    } else {
      console.log("⊝ No hyperliquid invoices to import");
    }

    // Import invoiceHooks
    console.log("Importing invoice hooks...");
    const invoiceHooks = readJsonFile("invoiceHooks.json");
    if (invoiceHooks.length > 0) {
      await db.insert(schema.invoiceHooks).values(invoiceHooks);
      console.log(`✓ Imported ${invoiceHooks.length} invoice hooks`);
    } else {
      console.log("⊝ No invoice hooks to import");
    }

    // Import agentWallets
    console.log("Importing agent wallets...");
    const agentWallets = readJsonFile("agentWallets.json");
    if (agentWallets.length > 0) {
      await db.insert(schema.agentWallets).values(agentWallets);
      console.log(`✓ Imported ${agentWallets.length} agent wallets`);
    } else {
      console.log("⊝ No agent wallets to import");
    }

    // Calculate totals
    const totalRecords = users.length + txHashes.length + multisigAccounts.length + 
                        hyperliquidInvoices.length + invoiceHooks.length + agentWallets.length;

    console.log("\n🎉 Database migration and data import completed successfully!");
    console.log(`📁 New database: ${targetDbPath}`);
    console.log(`📊 Total records imported: ${totalRecords}`);
    
    // Verify the import by counting records
    console.log("\n🔍 Verifying import...");
    const verification = {
      users: (await db.select().from(schema.users)).length,
      txHashes: (await db.select().from(schema.txHashes)).length,
      multisigAccounts: (await db.select().from(schema.multisigAccounts)).length,
      hyperliquidInvoices: (await db.select().from(schema.hyperliquidInvoices)).length,
      invoiceHooks: (await db.select().from(schema.invoiceHooks)).length,
      agentWallets: (await db.select().from(schema.agentWallets)).length,
    };

    console.log("Verification results:");
    Object.entries(verification).forEach(([table, count]) => {
      console.log(`  ${table}: ${count} records`);
    });

    const totalVerified = Object.values(verification).reduce((sum, count) => sum + count, 0);
    if (totalVerified === totalRecords) {
      console.log(`✅ Verification successful: ${totalVerified} records confirmed`);
    } else {
      console.log(`⚠️  Verification mismatch: Expected ${totalRecords}, found ${totalVerified}`);
    }

  } catch (error) {
    console.error("❌ Error during migration or import:", error);
    process.exit(1);
  } finally {
    // Close the database connection
    client.close();
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const targetDbName = args[0] || "imported.db";

if (args.includes("--help") || args.includes("-h")) {
  console.log("Usage: bun run import-data.ts [database-name]");
  console.log("  database-name: Name of the target database file (default: imported.db)");
  console.log("");
  console.log("Examples:");
  console.log("  bun run import-data.ts");
  console.log("  bun run import-data.ts new-database.db");
  console.log("  bun run import-data.ts production.db");
  process.exit(0);
}

// Run the import
importData(targetDbName); 