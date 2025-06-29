### **Technical Specification: Hyperliquid Invoicing and Payments (Multi-Asset)**

#### **1. Overview**

This document outlines the plan to integrate a multi-asset Hyperliquid payment system into the existing platform. The feature will allow users to create, view, and pay invoices using various spot-tradable tokens on Hyperliquid. This integration will leverage the `spotSend` functionality from the Hyperliquid SDK and will be built upon our existing monorepo structure (Elysia API, React frontend, Drizzle DB).

The core payment flow remains client-initiated. The user's browser will directly interact with the Hyperliquid network via their connected wallet to send funds. The backend's primary role is to manage invoice state, persist records, and critically, to verify the on-chain transactions.

---

#### **2. Database Schema (`packages/db/schema.ts`)**

The `hyperliquidInvoices` table will be updated to include the token being invoiced.

```typescript
// In packages/db/schema.ts

// ... existing tables

export const hyperliquidInvoices = table("hyperliquid_invoices", {
  id: t.text().primaryKey().$default(() => `hlinv_${generateUniqueString(16)}`),
  
  // The user who created the invoice
  creatorId: t.text().references(() => users.id).notNull(), 
  
  // The EVM address of the user who is expected to pay the invoice
  payerAddress: t.text().notNull(),

  // The string identifier for the Hyperliquid spot asset (e.g., "USDC:0x...")
  token: t.text().notNull(), 

  // The amount to be paid, stored as a human-readable string (e.g., "1.5"). The Hyperliquid SDK is expected
  // to handle decimal conversion for sending, but the backend will need to handle it for verification.
  amount: t.text().notNull(),
  description: t.text(),
  
  status: t.text().$type<"pending" | "paid" | "expired">().default("pending").notNull(),
  
  txHash: t.text().unique(), // The Hyperliquid transaction hash, unique
  
  createdAt: t.integer().default(Date.now()).notNull(),
  paidAt: t.integer(),
  expiresAt: t.integer(), // Optional: for future implementation
});
```

**Design Choices & Justification:**

*   **`token`**: A new `text` field stores the Hyperliquid-specific identifier for the spot asset. This is crucial for initiating the payment and verifying it.
*   **`amount`**: Storing the amount as a human-readable string (e.g., "1.5", "1000") simplifies the frontend and invoice creation process, as we can rely on the Hyperliquid SDK to correctly interpret this value when sending.

---

#### **3. API Endpoints (`apps/api`)**

The API endpoints will be updated to handle multiple assets.

**File Location:** `apps/api/src/hyperliquid_routes.ts`

**Endpoints:**

*   **`POST /hyperliquid/invoices`**: Create a new invoice.
    *   **Body:** `{ payerAddress: string, amount: string, token: string, description?: string }`
    *   **Logic:**
        1.  Validates input, especially the `token` format.
        2.  Creates a new `hyperliquidInvoices` record.
    *   **Returns:** The newly created invoice object.

*   **`GET /hyperliquid/invoices`**: Get invoices for the authenticated user (no change in logic).

*   **`PUT /hyperliquid/invoices/:id/confirm`**: Confirms that an invoice has been paid.
    *   **Body:** `{ txHash: string }`
    *   **Logic:**
        1.  This endpoint is called by the **payer** after their client-side `spotSend` transaction succeeds.
        2.  **CRITICAL:** Before updating the database, the backend **must** use the `InfoClient`'s `txDetails({ hash: txHash })` method to fetch the definitive transaction data from the chain.
        3.  The verification must compare fields from the returned `TxDetails` object with the invoice record. `TxDetails.user` must match the invoice `payerAddress`. Inside the `TxDetails.action` object, `destination` must match the invoice creator's address, and `token` must match the invoice `token`. It's also best practice to verify that `TxDetails.action.type` is `'spotSend'`.
        4.  For the `amount`, the backend must fetch the token's decimal information, convert the stored human-readable invoice amount (e.g., "1.5") to its smallest unit, and then compare it with the raw `amount` from the `TxDetails.action` object.
        5.  If verification passes, update the invoice `status` to `'paid'`, sets `paidAt`, and stores the `txHash`.
    *   **Returns:** The updated invoice object.

*   **`GET /hyperliquid/spot-balances`**: Get the user's spot balances.
    *   **Logic:**
        1.  Gets the authenticated user's `evm_address`.
        2.  Uses the `InfoClient`'s `spotClearinghouseState` method to fetch the user's complete spot state, which includes balances for all held tokens.
    *   **Returns:** An object or array detailing the user's spot token balances.

---

#### **4. Frontend Implementation (`apps/web`)**

**Hooks (`apps/web/src/hooks/useHyperliquid.tsx`):**

*   `useHyperliquidSpotBalances()`: Wraps the `GET /hyperliquid/spot-balances` query.
*   `useHyperliquidInvoices()`: Wraps the `GET /hyperliquid/invoices` query.
*   `useCreateInvoiceMutation()`: Wraps the `POST /hyperliquid/invoices` mutation.
*   `useConfirmPaymentMutation()`: Wraps the `PUT /hyperliquid/invoices/:id/confirm` mutation.

**Payment Hook (`usePayInvoice.tsx`):**

A dedicated hook will encapsulate the `spotSend` logic.

```javascript
// Example structure for a payment hook
function usePayInvoice() {
  const { address, chain } = useAccount();
  const confirmPayment = useConfirmPaymentMutation();

  const pay = async (invoice) => {
    // 1. Initialize Hyperliquid WalletClient with window.ethereum
    const hlClient = new hl.ExchangeClient({ wallet: window.ethereum, ... });

    // 2. Execute the spotSend transaction
    const { txHash } = await hlClient.spotSend({
        destination: invoice.creator.evmAddress, // requires creator's address
        token: invoice.token,
        amount: invoice.amount,
    });
    
    // 3. If successful, notify our backend for verification and confirmation
    await confirmPayment.mutateAsync({ id: invoice.id, txHash });
  };

  return { pay };
}
```

**Components:**

*   `InvoicesDashboard.tsx`: A new page/component that displays a list of incoming and outgoing invoices using `useHyperliquidInvoices`.
*   `CreateInvoiceForm.tsx`: The form must now include a way to select the `token` for the invoice (e.g., a dropdown populated from a list of supported assets) and input the `amount`. The user can enter a standard decimal amount (e.g., "1.5").
*   `InvoiceListItem.tsx`: A component to display a single invoice. It will show a "Pay Invoice" button if the current user is the payer and the status is `pending`. Clicking this button will trigger the `usePayInvoice` hook.

---

#### **5. Tradeoffs and Edge Cases**

*   **Transaction Verification (Enhanced):**
    *   **Problem:** The backend must not blindly trust the `txHash` from the client. It must independently verify the transaction details.
    *   **Solution:** The `InfoClient.txDetails` method provides a definitive and structured way to solve this. The verification step in the `/confirm` endpoint is the most critical part of the flow. It prevents users from confirming an invoice with an incorrect or unrelated transaction and makes our backend the authoritative source of truth. here is an example TxDetails output
```
--- Transaction Details ---
{
  "time": 1750867716660,
  "user": "0x79ee8e179b9d8115a5116cc3a8b95f8d92f0a36b",
  "action": {
    "type": "spotSend",
    "signatureChainId": "0xa4b1",
    "hyperliquidChain": "Mainnet",
    "destination": "0xe60f03d22bc1d0bff96f31578a5744f863b6d5b0",
    "token": "USDC:0x6d1e7cde53ba9467b783cb7c530ce054",
    "amount": "1.123456",
    "time": 1750867716260
  },
  "block": 641269987,
  "hash": "0x2b007758e38ad209be4e04263900e301ef00c6dacaac3b80578c0cd76d1657d9",
  "error": null
}
---------------------------
```

*   **Payment Confirmation Lag:** The risk of a state mismatch still exists if the user's connection fails after the `spotSend` call but before the `/confirm` call. The UI must handle this gracefully, and a "re-verify" option on pending invoices remains a valuable mitigation.

---

#### **6. Implementation Plan**

1.  **DB Migration:** Add the `token` column to the `hyperliquidInvoices` table and create a new Drizzle migration.
2.  **API Development (`apps/api`):**
    *   Install `@nktkas/hyperliquid` and initialize both an `ExchangeClient` (for sending, if ever needed by the backend) and an `InfoClient` (for reading data).
    *   Update API endpoints to accept/use the `token` identifier.
    *   Implement the `GET /hyperliquid/spot-balances` endpoint using `InfoClient`.
    *   **Crucially, implement the robust on-chain transaction verification in the `confirm` endpoint using `InfoClient.txDetails`, including the logic for handling token decimals during amount comparison.**
3.  **Frontend Development (`apps/web`):**
    *   Update hooks to align with the new API.
    *   Modify UI components to allow token selection and amount input in human-readable format.
    *   Replace `usdSend` with `spotSend` in the payment flow.
4.  **Testing:**
    *   Test the end-to-end flow with multiple different tokens, especially those with different decimal counts.
    *   Test verification failures (e.g., submitting a `txHash` with the wrong amount, wrong token, or to the wrong recipient). 