# Hyperliquid & Full-Stack API Debug Playbook

## Overview
This playbook documents the systematic approach for debugging Hyperliquid integration issues and can be adapted for other external API integrations.

## 🚨 When to Use This Playbook
- Transactions appear successful but frontend shows pending/failed status
- API responses don't match expected format
- External service integration is behaving unexpectedly
- Need to understand the actual data structure returned by an API

## 📋 Step-by-Step Process

### 1. Identify the Problem Precisely
- **Document the expected behavior** vs actual behavior
- **Identify the failure point** in the flow (frontend, backend, external API)
- **Check if it's a data format mismatch** or missing data issue

**Example:**
```
Expected: Invoice should be marked as "paid" after successful payment
Actual: Invoices stuck in "pending" despite successful Hyperliquid transactions
Failure point: Frontend payment confirmation logic
```

### 2. Create Diagnostic Scripts

Create standalone scripts to explore API responses without the complexity of the full application.

**Script Template:**
```typescript
// apps/api/src/debug_[feature].ts
import * as hl from "@nktkas/hyperliquid";
import * as fs from "fs/promises";
import * as path from "path";

async function main() {
  const targetAddress = "0x..."; // Use real addresses from your testing
  
  try {
    console.log("Initializing Hyperliquid client...");
    const transport = new hl.HttpTransport();
    const infoClient = new hl.InfoClient({ transport });
    
    // Call the API method you're investigating
    const result = await infoClient.methodName({ param: targetAddress });
    
    // Write to file for analysis
    const outputDir = path.resolve(__dirname, "debug_output");
    await fs.mkdir(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `methodName_${targetAddress}.json`);
    await fs.writeFile(outputPath, JSON.stringify(result, null, 2), "utf-8");
    console.log(`Output written to ${outputPath}`);
    
    // Quick analysis
    console.log(`\n--- Quick Analysis ---`);
    console.log(`Keys available: ${Object.keys(result)}`);
    if (Array.isArray(result)) {
      console.log(`Array length: ${result.length}`);
      if (result.length > 0) {
        console.log(`First item keys: ${Object.keys(result[0])}`);
      }
    }
    
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
```

### 3. Dump and Analyze API Responses

**Key Commands:**
```bash
# Run diagnostic script
cd apps/api && bun src/debug_[feature].ts

# Examine the output file
cat apps/api/src/debug_output/methodName_address.json | jq '.' | less
```

**What to Look For:**
- ✅ **Data structure** - What keys/fields are available?
- ✅ **Data types** - Are IDs strings or numbers? Timestamps in ms or seconds?
- ✅ **Filtering criteria** - What fields can you use to identify specific transactions?
- ✅ **Error handling** - How are failed transactions represented?
- ✅ **Timing** - How are timestamps structured?

### 4. Compare Multiple API Methods

Often you need to compare different API endpoints to understand where your data lives:

```typescript
// Compare multiple methods in one script
const userFills = await infoClient.userFills({ user: address });
const userDetails = await infoClient.userDetails({ user: address });

// Write both to separate files
await fs.writeFile("userFills.json", JSON.stringify(userFills, null, 2));
await fs.writeFile("userDetails.json", JSON.stringify(userDetails, null, 2));

console.log(`UserFills count: ${userFills.length}`);
console.log(`UserDetails count: ${userDetails.length}`);
```

### 5. Create Search Utilities

Add helper functions to find specific data patterns:

```typescript
// Utility to find transaction hashes
const findTxHashes = (obj: any, path = ""): void => {
  if (typeof obj === 'object' && obj !== null) {
    Object.entries(obj).forEach(([key, value]) => {
      const currentPath = path ? `${path}.${key}` : key;
      if (typeof value === 'string' && value.startsWith('0x') && value.length > 10) {
        console.log(`Potential tx hash at ${currentPath}: ${value}`);
      } else if (typeof value === 'object') {
        findTxHashes(value, currentPath);
      }
    });
  }
};

// Utility to find specific transaction types
const findTransactionType = (transactions: any[], type: string) => {
  return transactions.filter(tx => 
    tx.action?.type === type ||
    tx.type === type
  );
};
```

### 6. Fix Implementation Based on Findings

**Common Patterns:**

```typescript
// Before (incorrect assumption)
const userFills = await infoClient.userFills({ user: address });
const transaction = userFills.find(fill => /* criteria */);

// After (based on API exploration)
const userDetails = await infoClient.userDetails({ user: address });
const transaction = userDetails
  .filter(tx => 
    tx.action.type === 'spotSend' && 
    tx.time > sendTimestamp && 
    tx.action.destination.toLowerCase() === targetAddress.toLowerCase() &&
    tx.error === null
  )
  .sort((a, b) => b.time - a.time)[0];
```

### 7. Add Proper Error Handling

```typescript
if (!transaction || !transaction.hash) {
  throw new Error(`Could not find ${transactionType} transaction. Please try again or verify manually.`);
}

// Handle type conversions based on API analysis
const txHash = typeof transaction.hash === 'number' 
  ? transaction.hash.toString() 
  : transaction.hash;
```

## 🛠️ Specific Hyperliquid Patterns

### Transaction Types and Where They Appear

| Transaction Type | Found In | Key Fields |
|------------------|----------|------------|
| `spotSend` | `userDetails` | `action.type`, `hash`, `action.amount`, `action.destination` |
| Trading fills | `userFills` | `dir`, `px`, `sz`, `tid` |
| Orders | `userDetails` | `action.type: "order"` |
| Withdrawals | `userDetails` | `action.type: "withdraw3"` |

### Common Gotchas
- ❌ **Don't look for `spotSend` in `userFills`** - they only appear in `userDetails`
- ❌ **Don't assume transaction IDs are strings** - some are numbers, convert with `.toString()`
- ❌ **Don't ignore the `error` field** - transactions can appear in results even if they failed
- ✅ **Always filter by timestamp** - use `Date.now()` before API calls and filter results
- ✅ **Use case-insensitive address comparison** - Ethereum addresses can have different casing

### Timing Best Practices
```typescript
// Record timestamp before transaction
const sendTimestamp = Date.now();

// Execute transaction
const result = await exchangeClient.spotSend(params);

// Wait for indexing (Hyperliquid specific)
await new Promise(resolve => setTimeout(resolve, 3000));

// Query with timestamp filter
const recentTransactions = await infoClient.userDetails({ user: address });
const ourTransaction = recentTransactions.filter(tx => tx.time > sendTimestamp);
```

## 🧹 Cleanup Checklist

- [ ] Remove debugging scripts from production code
- [ ] Delete temporary output files
- [ ] Remove console.log statements used for debugging
- [ ] Update error messages to be user-friendly
- [ ] Add proper TypeScript types based on discovered data structures

## 📚 Reusable Code Snippets

### Generic API Explorer Script
```typescript
async function exploreAPI(methodName: string, params: any, outputPrefix: string) {
  const transport = new hl.HttpTransport();
  const client = new hl.InfoClient({ transport });
  
  const result = await (client as any)[methodName](params);
  
  const outputPath = `debug_output/${outputPrefix}_${JSON.stringify(params)}.json`;
  await fs.writeFile(outputPath, JSON.stringify(result, null, 2));
  
  console.log(`${methodName} output written to ${outputPath}`);
  return result;
}
```

### Transaction Finder
```typescript
function findTransactionAfterTimestamp(
  transactions: any[], 
  timestamp: number, 
  criteria: Record<string, any>
) {
  return transactions
    .filter(tx => tx.time > timestamp)
    .filter(tx => {
      return Object.entries(criteria).every(([key, value]) => {
        const txValue = key.includes('.') 
          ? key.split('.').reduce((obj, prop) => obj?.[prop], tx)
          : tx[key];
        return txValue === value;
      });
    })
    .sort((a, b) => b.time - a.time)[0];
}
```

## 🎯 Success Metrics

You've successfully debugged when:
- ✅ You understand the exact data structure returned by the API
- ✅ You can reliably identify your specific transaction
- ✅ The frontend correctly reflects the actual transaction status
- ✅ Error cases are properly handled
- ✅ The solution is robust against timing issues

---

*This playbook should be updated whenever new Hyperliquid APIs are integrated or when new debugging patterns are discovered.* 