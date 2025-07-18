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

---

This project was created using `bun init` in bun v1.2.10. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.
