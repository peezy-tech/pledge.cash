# Database

This package contains the database schema and configuration for the application.

## Installation

```bash
bun install
```

## Usage

### Database Operations

```bash
# Push schema changes to database
bun run db:push

# Generate migrations
bun run db:generate

# Run migrations
bun run db:migrate

# Open Drizzle Studio
bun run db:studio
```

### Data Management

#### Seed Sample Data
Create a fresh, valid dataset across all tables:

```bash
# fresh rebuild (migrate + clear tables + seed)
bun run seed --fresh

# or seed into existing DB (clears tables only)
bun run seed
```

From the repo root, you can also run:

```bash
bun run db:seed --fresh
```

The seed includes:
- Users (admin + users with unique EVM addresses)
- Transaction hashes
- Hyperliquid invoices (pending, paid, expired) + hooks
- Pledge wallet + agent wallets
- Recurring plans + charges
- Pledge campaigns, pledges + contributions
- Donations
- Normalized payments corresponding to the above

#### Extract Data to JSON
Extract all data from `seed.db` to individual JSON files:

```bash
bun run extract-data
```

This creates an `extracted-data/` directory with:
- `users.json`
- `txHashes.json`
- `hyperliquidInvoices.json`
- `invoiceHooks.json`
- `pledgeWalletAccounts.json`
- `agentWallets.json`
- `extraction-summary.json`

#### Import Data from JSON
Migrate a new database and import JSON data:

```bash
# Create imported.db (default)
bun run import-data

# Create custom database name
bun run import-data custom-database.db

# Get help
bun run import-data --help
```

This script:
1. Runs database migrations to set up the schema
2. Imports data from the `extracted-data/` JSON files
3. Verifies the import was successful

### Complete Workflow Example

```bash
# 1. Extract data from seed.db
bun run extract-data

# 2. Create a new database with the extracted data
bun run import-data production.db

# 3. Verify the new database has the correct data
bun run db:studio
```

#### On-Chain Testnet Seed (Hyperliquid)
Use real Hyperliquid L1 testnet transactions to populate the DB with live tx hashes:

```bash
# Required env
# HL_SEED_FROM_PRIVATE_KEY=0x<funded_testnet_key>
# HL_SEED_TO_PRIVATE_KEY=0x<receiver_key>  # or set HL_SEED_TO_ADDRESS=0x...
# Optional: HL_SEED_INVOICE_AMOUNT=5, HL_SEED_DONATION_AMOUNT=2, HL_SEED_RECURRING_AMOUNT=1

# Run from repo root
bun run db:seed:onchain
```

This script will:
- Discover USDC testnet token via Hyperliquid `spotMeta`
- Send three spot transfers (invoice, donation, recurring charge)
- Insert `tx_hashes` with full metadata from `txDetails`
- Create/mark entities as paid and add normalized `payments`

Note: Requires network access and funded testnet USDC on the `HL_SEED_FROM_PRIVATE_KEY` account.

---

This project was created using `bun init` in bun v1.2.10. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.
