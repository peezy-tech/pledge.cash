import { describe, expect, test } from "bun:test";
import {
  ammRouterAbi,
  fixedPriceSaleAbi,
  type Address,
} from "@pledge.cash/sdk";
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import type {
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
} from "@x402/core/types";
import {
  PAYMENT_IDENTIFIER,
  declarePaymentIdentifierExtension,
  extractPaymentIdentifier,
} from "@x402/extensions/payment-identifier";
import {
  encodeFunctionData,
  keccak256,
  type Hex,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  X402_HL_INTENTS_EXTENSION,
  X402_HL_INTENTS_EXTRA_KEY,
  createIntentDeclaration,
  createIntentPaymentExtra,
  hashExecutionIntent,
  type HyperEvmExecutionIntent,
} from "x402-hl/intents";
import {
  createX402ServerLayer,
  type PersistedX402Quote,
  type X402SettlementJournalRecord,
} from "../../../services/x402-router/src/x402";
import {
  HYPERCORE_TESTNET,
  HYPERCORE_TESTNET_USDC,
  HyperliquidPaymentClientError,
  assertHyperliquidIntentAuthorization,
  clearHyperliquidPendingPayment,
  createHyperliquidMarketplaceQuote,
  executeHyperliquidMarketplaceQuote,
  getX402RouterConfig,
  hyperliquidPendingPaymentStorageKey,
  loadHyperliquidPendingPayment,
  parseHyperliquidMarketplaceOrder,
  saveHyperliquidPendingPayment,
  shouldRetainHyperliquidPendingPayment,
  withExclusiveHyperliquidPayment,
  type FixedPriceSaleQuoteRequest,
  type HyperliquidMarketplaceQuote,
  type HyperliquidOrderStatus,
  type HyperliquidPaymentLockManager,
  type HyperliquidRouteExpectations,
  type X402RouterConfig,
} from "../src/lib/x402-router";

const boardroom = "0x1000000000000000000000000000000000000000" as Address;
const payer = "0x2000000000000000000000000000000000000000" as Address;
const shareToken = "0x3000000000000000000000000000000000000000" as Address;
const destinationUsdc = "0x4000000000000000000000000000000000000000" as Address;
const sale = "0x5000000000000000000000000000000000000000" as Address;
const router = "0x6000000000000000000000000000000000000000" as Address;
const pool = "0x7000000000000000000000000000000000000000" as Address;
const gateway = "0x8000000000000000000000000000000000000000" as Address;
const payTo = "0x9000000000000000000000000000000000000000" as Address;
const other = "0xa000000000000000000000000000000000000000" as Address;
const quoteId = "quote-1234567890abcdef";
const paymentId = "payment-1234567890abcdef";
const deadline = 4_102_444_800;
const zeroHash = `0x${"00".repeat(32)}` as Hex;

const config: X402RouterConfig = {
  application: "api.pledge.cash/x402-router/v1/execute",
  baseUrl: "https://x402.example",
  gateway,
  hyperevmUsdc: destinationUsdc,
};

const fixedRequest: FixedPriceSaleQuoteRequest = {
  boardroom,
  chainId: 998,
  kind: "fixed_price_sale",
  maxSlippageBps: 100,
  payer,
  recipient: payer,
  refundAddress: payer,
  sale,
  shareAmount: "1000000000000000000",
};

const fixedExpectations: HyperliquidRouteExpectations = {
  inputToken: destinationUsdc,
  outputToken: shareToken,
  target: sale,
};

describe("x402 router browser boundary", () => {
  test("fails closed until every trusted router setting is valid", () => {
    expect(getX402RouterConfig({})).toBeUndefined();
    expect(getX402RouterConfig({
      VITE_X402_ROUTER_API_URL: config.baseUrl,
      VITE_X402_ROUTER_APPLICATION: config.application,
      VITE_X402_ROUTER_GATEWAY_ADDRESS: gateway,
    })).toBeUndefined();
    expect(getX402RouterConfig({
      VITE_X402_ROUTER_API_URL: "https://x402.example/path",
      VITE_X402_ROUTER_APPLICATION: config.application,
      VITE_X402_ROUTER_GATEWAY_ADDRESS: gateway,
      VITE_X402_ROUTER_HYPEREVM_USDC_ADDRESS: destinationUsdc,
    })).toBeUndefined();
    expect(getX402RouterConfig({
      VITE_X402_ROUTER_API_URL: config.baseUrl,
      VITE_X402_ROUTER_APPLICATION: config.application,
      VITE_X402_ROUTER_GATEWAY_ADDRESS: "not-an-address",
      VITE_X402_ROUTER_HYPEREVM_USDC_ADDRESS: destinationUsdc,
    })).toBeUndefined();
    expect(getX402RouterConfig({
      VITE_X402_ROUTER_API_URL: "http://x402.example",
      VITE_X402_ROUTER_APPLICATION: config.application,
      VITE_X402_ROUTER_GATEWAY_ADDRESS: gateway,
      VITE_X402_ROUTER_HYPEREVM_USDC_ADDRESS: destinationUsdc,
    })).toBeUndefined();
    expect(getX402RouterConfig({
      VITE_X402_ROUTER_API_URL: `${config.baseUrl}/`,
      VITE_X402_ROUTER_APPLICATION: config.application,
      VITE_X402_ROUTER_GATEWAY_ADDRESS: gateway,
      VITE_X402_ROUTER_HYPEREVM_USDC_ADDRESS: destinationUsdc,
    })).toEqual(config);
  });

  test("persists a payment recovery identity by gateway, payer, and action", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem(key: string) {
        return values.get(key) ?? null;
      },
      removeItem(key: string) {
        values.delete(key);
      },
      setItem(key: string, value: string) {
        values.set(key, value);
      },
    };
    const quote = fixedQuote();
    const key = hyperliquidPendingPaymentStorageKey(
      config,
      payer,
      "fixed_price_sale",
    );

    saveHyperliquidPendingPayment(
      storage,
      config,
      payer,
      "fixed_price_sale",
      quote,
      { decimals: 18, symbol: "PLEDGE" },
    );
    expect(values.has(key)).toBe(true);
    expect(loadHyperliquidPendingPayment(
      storage,
      config,
      payer,
      "fixed_price_sale",
    )).toEqual({
      gateway,
      kind: "fixed_price_sale",
      output: { decimals: 18, symbol: "PLEDGE" },
      payer,
      quote,
      version: 1,
    });
    expect(loadHyperliquidPendingPayment(
      storage,
      config,
      payer,
      "amm_swap",
    )).toBeUndefined();

    clearHyperliquidPendingPayment(
      storage,
      config,
      payer,
      "fixed_price_sale",
    );
    expect(values.has(key)).toBe(false);
  });

  test("preserves malformed recovery data and fails closed", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem(key: string) {
        return values.get(key) ?? null;
      },
      removeItem(key: string) {
        values.delete(key);
      },
      setItem(key: string, value: string) {
        values.set(key, value);
      },
    };
    const key = hyperliquidPendingPaymentStorageKey(
      config,
      payer,
      "fixed_price_sale",
    );
    values.set(key, "{not-json");

    expect(() =>
      loadHyperliquidPendingPayment(
        storage,
        config,
        payer,
        "fixed_price_sale",
      ),
    ).toThrow("preserved for reconciliation");
    expect(values.get(key)).toBe("{not-json");
  });

  test("serializes tabs and refuses a second payment after the first is retained", async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem(key: string) {
        return values.get(key) ?? null;
      },
      removeItem(key: string) {
        values.delete(key);
      },
      setItem(key: string, value: string) {
        values.set(key, value);
      },
    };
    let tail = Promise.resolve();
    const locks: HyperliquidPaymentLockManager = {
      request<T>(
        _name: string,
        _options: { mode: "exclusive" },
        callback: () => Promise<T>,
      ): Promise<T> {
        const result = tail.then(callback);
        tail = result.then(() => undefined, () => undefined);
        return result;
      },
    };
    let firstEntered = () => {};
    let releaseFirst = () => {};
    const entered = new Promise<void>(resolve => {
      firstEntered = resolve;
    });
    const release = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    const retainedQuote = fixedQuote();
    const first = withExclusiveHyperliquidPayment(
      locks,
      storage,
      config,
      payer,
      async () => {
        firstEntered();
        await release;
        saveHyperliquidPendingPayment(
          storage,
          config,
          payer,
          "fixed_price_sale",
          retainedQuote,
          {},
        );
        return "first";
      },
    );
    await entered;

    let secondRan = false;
    const second = withExclusiveHyperliquidPayment(
      locks,
      storage,
      config,
      payer,
      async () => {
        secondRan = true;
        return "second";
      },
    ).then(
      value => ({ value }),
      error => ({ error }),
    );

    releaseFirst();
    expect(await first).toBe("first");
    const secondResult = await second;
    expect(secondRan).toBe(false);
    expect("error" in secondResult).toBe(true);
    if ("error" in secondResult) {
      expect(secondResult.error).toBeInstanceOf(HyperliquidPaymentClientError);
      expect((secondResult.error as HyperliquidPaymentClientError).retry).toBe(
        "locked",
      );
    }
    expect(
      loadHyperliquidPendingPayment(
        storage,
        config,
        payer,
        "fixed_price_sale",
      )?.quote.orderId,
    ).toBe(retainedQuote.orderId);
  });

  test("retains every unresolved state, including recovery and manual intervention", () => {
    expect(shouldRetainHyperliquidPendingPayment("quoted")).toBe(true);
    expect(shouldRetainHyperliquidPendingPayment("recovery_pending")).toBe(true);
    expect(shouldRetainHyperliquidPendingPayment("manual_intervention")).toBe(true);
    expect(shouldRetainHyperliquidPendingPayment("executed")).toBe(false);
    expect(shouldRetainHyperliquidPendingPayment("refunded")).toBe(false);
    expect(shouldRetainHyperliquidPendingPayment("payment_failed")).toBe(false);

    expect(parseHyperliquidMarketplaceOrder(
      fixedOrder("recovery_pending"),
    ).status).toBe("recovery_pending");
    expect(parseHyperliquidMarketplaceOrder(
      fixedOrder("payment_failed"),
    ).status).toBe("payment_failed");
  });

  test("posts only the v1 request and validates payment arithmetic and route identity", async () => {
    const quote = fixedQuote();
    let requestBody: unknown;
    const response = await createHyperliquidMarketplaceQuote(
      {
        config,
        walletClient: () => {
          throw new Error("not used while quoting");
        },
      },
      fixedRequest,
      fixedExpectations,
      {
        async fetch(_input, init) {
          requestBody = JSON.parse(String(init?.body)) as unknown;
          return Response.json(quote);
        },
      },
    );

    expect(requestBody).toEqual(fixedRequest);
    expect(response).toEqual(quote);

    await expect(createHyperliquidMarketplaceQuote(
      {
        config,
        walletClient: () => {
          throw new Error("not used while quoting");
        },
      },
      fixedRequest,
      fixedExpectations,
      {
        async fetch() {
          return Response.json({
            ...quote,
            payment: { ...quote.payment, amount: "302999999" },
          });
        },
      },
    )).rejects.toThrow("principal plus the disclosed fee");
  });

  test("authorizes an exact fixed-sale declaration and rejects changed recipient calldata", () => {
    const quote = fixedQuote();
    const intent = fixedIntent(quote);
    const wire = paymentWire(quote, intent);

    expect(() => assertHyperliquidIntentAuthorization({
      config,
      declaration: wire.declaration,
      executeUrl: wire.paymentRequired.resource.url,
      expectations: fixedExpectations,
      intent,
      paymentRequired: wire.paymentRequired,
      quote,
      request: fixedRequest,
      selected: wire.selected,
    })).not.toThrow();

    const changedCallData = encodeFunctionData({
      abi: fixedPriceSaleAbi,
      functionName: "buy",
      args: [
        BigInt(fixedRequest.shareAmount),
        other,
        3_030_000n,
        BigInt(deadline),
      ],
    });
    const changedQuote = {
      ...quote,
      execution: {
        ...quote.execution,
        callDataHash: keccak256(changedCallData),
      },
    };
    const changedIntent = {
      ...intent,
      callData: changedCallData,
    };
    const changedWire = paymentWire(changedQuote, changedIntent);
    expect(() => assertHyperliquidIntentAuthorization({
      config,
      declaration: changedWire.declaration,
      executeUrl: changedWire.paymentRequired.resource.url,
      expectations: fixedExpectations,
      intent: changedIntent,
      paymentRequired: changedWire.paymentRequired,
      quote: changedQuote,
      request: fixedRequest,
      selected: changedWire.selected,
    })).toThrow("sale calldata changed");
  });

  test("authorizes only the exact AMM path, amounts, and minimum output", () => {
    const amountIn = 5_000_000n;
    const expectedOutput = 10_000_000_000_000_000_000n;
    const minimumOutput = 9_900_000_000_000_000_000n;
    const request = {
      amountIn: amountIn.toString(),
      boardroom,
      chainId: 998 as const,
      kind: "amm_swap" as const,
      maxSlippageBps: 100,
      payer,
      pool,
      recipient: payer,
      refundAddress: payer,
      tokenIn: destinationUsdc,
      tokenOut: shareToken,
    };
    const expectations = {
      inputToken: destinationUsdc,
      outputToken: shareToken,
      target: router,
    };
    const callData = encodeFunctionData({
      abi: ammRouterAbi,
      functionName: "swapExactTokensForTokens",
      args: [
        amountIn,
        minimumOutput,
        [destinationUsdc, shareToken],
        payer,
        BigInt(deadline),
      ],
    });
    const quote: HyperliquidMarketplaceQuote = {
      ...fixedQuote(),
      execution: {
        callDataHash: keccak256(callData),
        chainId: 998,
        deadline,
        expectedOutput: expectedOutput.toString(),
        inputAmount: amountIn.toString(),
        inputToken: destinationUsdc,
        minimumOutput: minimumOutput.toString(),
        outputToken: shareToken,
        recipient: payer,
        selector: callData.slice(0, 10) as Hex,
        target: router,
      },
      kind: "amm_swap",
      payment: {
        ...fixedQuote().payment,
        amount: "505000000",
        principal: "500000000",
        serviceFee: "5000000",
      },
    };
    const intent = baseIntent(quote, callData);
    const wire = paymentWire(quote, intent);

    expect(() => assertHyperliquidIntentAuthorization({
      config,
      declaration: wire.declaration,
      executeUrl: wire.paymentRequired.resource.url,
      expectations,
      intent,
      paymentRequired: wire.paymentRequired,
      quote,
      request,
      selected: wire.selected,
    })).not.toThrow();
  });

  test("consumes a service-issued 402 through the real browser signing path", async () => {
    const paymentAccount = privateKeyToAccount(
      `0x${"01".repeat(32)}` as Hex,
    );
    const testPayer = paymentAccount.address;
    const request = {
      ...fixedRequest,
      payer: testPayer,
      recipient: testPayer,
      refundAddress: testPayer,
    };
    const quote = fixedQuote(testPayer);
    const intent = fixedIntent(quote);
    const events: string[] = [];
    let persistedQuote: PersistedX402Quote;
    let journalRecord: X402SettlementJournalRecord | undefined;
    const paymentTransaction = `0x${"ab".repeat(32)}`;
    const executionTransaction = `0x${"cd".repeat(32)}`;
    const layer = createX402ServerLayer({
      domain: {
        application: config.application,
        gateway: config.gateway,
      },
      paymentPayTo: payTo,
      installedX402HlVersion: "0.2.2",
      now: () => deadline - 300,
      settlementJournal: {
        async lookup(input) {
          if (
            journalRecord?.quoteId === input.quoteId
            && journalRecord.paymentPayloadHash === input.paymentPayloadHash
          ) {
            return journalRecord;
          }
          return undefined;
        },
        async lookupByQuoteId(quoteId) {
          return journalRecord?.quoteId === quoteId
            ? journalRecord
            : undefined;
        },
        async prepare(input) {
          events.push("journal:prepare");
          if (journalRecord) return journalRecord;
          journalRecord = {
            attemptId: input.paymentIdentityHash,
            quoteId: input.quoteId,
            paymentId: input.paymentId,
            paymentIdentityHash: input.paymentIdentityHash,
            paymentPayloadHash: input.paymentPayloadHash,
            paymentRequirementsHash: input.paymentRequirementsHash,
            paymentPayload: structuredClone(input.paymentPayload),
            paymentRequirements: structuredClone(input.paymentRequirements),
            status: "prepared",
          };
          return journalRecord;
        },
        async recordResult(input) {
          events.push("journal:record");
          if (!journalRecord) throw new Error("journal was not prepared");
          journalRecord = {
            ...journalRecord,
            settlement: structuredClone(input.settlement),
            status: input.settlement.success ? "settled" : "failed",
          };
          return journalRecord;
        },
      },
      facilitator: {
        async verify() {
          events.push("facilitator:verify");
          return { isValid: true, payer: testPayer };
        },
        async settle(_payload, requirements) {
          events.push("facilitator:settle");
          return {
            success: true,
            transaction: paymentTransaction,
            network: HYPERCORE_TESTNET,
            payer: testPayer,
            amount: requirements.amount,
          };
        },
      },
      executor: {
        async verifyBeforeSettlement() {
          events.push("intent:verify");
          return {
            ok: true,
            intent: persistedQuote.intent,
            intentHash: hashExecutionIntent(persistedQuote.intent, {
              paymentRequirementsHash:
                persistedQuote.paymentRequirementsHash,
            }),
            intentTemplateHash: persistedQuote.intentTemplateHash,
            paymentRequirementsHash: persistedQuote.paymentRequirementsHash,
            signer: testPayer,
            paymentPayer: testPayer,
          };
        },
        async execute(input) {
          events.push("executor:execute");
          const timestamp = new Date((deadline - 300) * 1_000).toISOString();
          return {
            version: 2,
            revision: 3,
            status: "executed" as const,
            intentHash: hashExecutionIntent(persistedQuote.intent, {
              paymentRequirementsHash:
                persistedQuote.paymentRequirementsHash,
            }),
            intentTemplateHash: persistedQuote.intentTemplateHash,
            paymentRequirementsHash: persistedQuote.paymentRequirementsHash,
            quoteId: persistedQuote.id,
            application: persistedQuote.intent.application,
            gateway: persistedQuote.intent.gateway,
            payer: testPayer,
            paymentScheme: "exact",
            paymentNetwork: HYPERCORE_TESTNET,
            paymentAsset: HYPERCORE_TESTNET_USDC,
            paymentAmount: persistedQuote.paymentRequirements.amount,
            paymentPayTo: payTo,
            paymentTransaction: input.settleResponse.transaction,
            executionNetwork: "eip155:998",
            executionTransaction,
            executionAttempts: 1,
            refundAttempts: 0,
            createdAt: timestamp,
            updatedAt: timestamp,
            intent: persistedQuote.intent,
          };
        },
      },
    });
    persistedQuote = layer.createQuote({
      id: quote.quoteId,
      paymentId: quote.paymentId,
      resourceUrl: `${config.baseUrl}/v1/quotes/${quote.quoteId}/execute`,
      payer: testPayer,
      target: sale,
      callData: intent.callData,
      paymentAmountAtomic: quote.payment.amount,
      maxGasCost: intent.maxGasCost,
      maxSlippageBps: request.maxSlippageBps,
      deadline,
      nonce: intent.nonce,
      metadata: { operation: request.kind },
    });

    let capturedPayload: PaymentPayload | undefined;
    let requestCount = 0;
    let signatureCount = 0;
    const result = await executeHyperliquidMarketplaceQuote(
      {
        config,
        walletClient: () => ({
          account: { address: testPayer },
          async signTypedData(parameters: unknown) {
            signatureCount += 1;
            return paymentAccount.signTypedData(
              parameters as Parameters<
                typeof paymentAccount.signTypedData
              >[0],
            );
          },
        }) as unknown as WalletClient,
      },
      quote,
      request,
      fixedExpectations,
      {
        onAfterPaymentCreation() {
          events.push("browser:persist");
        },
        async fetch(input, init) {
          const request =
            input instanceof Request ? input : new Request(input, init);
          requestCount += 1;
          const paymentSignature =
            request.headers.get("PAYMENT-SIGNATURE");
          if (!paymentSignature) {
            return new Response(
              JSON.stringify(persistedQuote.paymentRequired),
              {
                status: 402,
                headers: {
                  "content-type": "application/json",
                  "PAYMENT-REQUIRED": encodePaymentRequiredHeader(
                    persistedQuote.paymentRequired,
                  ),
                },
              },
            );
          }

          capturedPayload =
            decodePaymentSignatureHeader(paymentSignature);
          const settled = await layer.settleAndExecute({
            quote: persistedQuote,
            paymentPayload: capturedPayload,
            now: deadline - 299,
          });
          return Response.json(
            {
              order: {
                execution: quote.execution,
                expiresAt: quote.expiresAt,
                kind: quote.kind,
                orderId: quote.orderId,
                payer: quote.payer,
                paymentTransaction: settled.settlement.transaction,
                quoteId: quote.quoteId,
                recipient: quote.recipient,
                refundAddress: quote.refundAddress,
                sourcePayment: quote.payment,
                status: "paid",
              },
            },
            {
              headers: {
                "PAYMENT-RESPONSE": encodePaymentResponseHeader(
                  settled.settlement,
                ),
              },
            },
          );
        },
      },
    );

    expect(result.status).toBe("paid");
    expect(requestCount).toBe(2);
    expect(signatureCount).toBe(2);
    expect(extractPaymentIdentifier(capturedPayload!)).toBe(paymentId);
    expect(events).toEqual([
      "browser:persist",
      "intent:verify",
      "facilitator:verify",
      "journal:prepare",
      "facilitator:settle",
      "journal:record",
      "executor:execute",
    ]);
  });

  test("keeps the same quote retryable when the wallet rejects before payment creation", async () => {
    const quote = fixedQuote();
    const wire = paymentWire(quote, fixedIntent(quote));
    let paymentCreated = false;
    let requestCount = 0;
    let caught: unknown;

    try {
      await executeHyperliquidMarketplaceQuote(
        {
          config,
          walletClient: () => ({
            account: { address: payer },
            async signTypedData() {
              throw new Error("User rejected the wallet request.");
            },
          }) as unknown as WalletClient,
        },
        quote,
        fixedRequest,
        fixedExpectations,
        {
          onAfterPaymentCreation() {
            paymentCreated = true;
          },
          async fetch() {
            requestCount += 1;
            return paymentRequiredResponse(wire.paymentRequired);
          },
        },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HyperliquidPaymentClientError);
    expect(caught).toMatchObject({
      paymentCreated: false,
      retry: "same_quote",
    });
    expect(String((caught as Error).message)).toContain("Failed to sign");
    expect(paymentCreated).toBe(false);
    expect(requestCount).toBe(1);
  });

  test("forces a fresh quote when the checkout identity changes before payment creation", async () => {
    let caught: unknown;
    try {
      await executeHyperliquidMarketplaceQuote(
        {
          config,
          walletClient: () => {
            throw new Error("The stale quote must fail before opening the wallet.");
          },
        },
        fixedQuote(),
        { ...fixedRequest, shareAmount: "2" },
        fixedExpectations,
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HyperliquidPaymentClientError);
    expect(caught).toMatchObject({
      paymentCreated: false,
      paymentMoved: false,
      retry: "fresh_quote",
    });
  });

  test("forces a fresh quote for nested paymentMoved:false responses", async () => {
    const quote = fixedQuote();
    const wire = paymentWire(quote, fixedIntent(quote));
    const signedMessage =
      `0x${"11".repeat(32)}${"22".repeat(32)}1b` as Hex;
    let paymentCreated = false;
    let postCount = 0;
    let recoveryCount = 0;
    let caught: unknown;

    try {
      await executeHyperliquidMarketplaceQuote(
        {
          config,
          walletClient: () => ({
            account: { address: payer },
            async signTypedData() {
              return signedMessage;
            },
          }) as unknown as WalletClient,
        },
        quote,
        fixedRequest,
        fixedExpectations,
        {
          onAfterPaymentCreation() {
            paymentCreated = true;
          },
          async fetch(input, init) {
            const request =
              input instanceof Request ? input : new Request(input, init);
            if (request.method === "GET") {
              recoveryCount += 1;
              return Response.json({ order: fixedOrder("quoted") });
            }
            postCount += 1;
            if (!request.headers.get("PAYMENT-SIGNATURE")) {
              return paymentRequiredResponse(wire.paymentRequired);
            }
            return Response.json(
              {
                error: {
                  code: "PAYMENT_NOT_MOVED",
                  message: "The source payment was not submitted.",
                  paymentMoved: false,
                },
              },
              { status: 409 },
            );
          },
        },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HyperliquidPaymentClientError);
    expect(caught).toMatchObject({
      code: "PAYMENT_NOT_MOVED",
      paymentCreated: true,
      paymentMoved: false,
      retry: "fresh_quote",
    });
    expect(String((caught as Error).message)).toContain(
      "The source payment was not submitted.",
    );
    expect(paymentCreated).toBe(true);
    expect(postCount).toBe(2);
    expect(recoveryCount).toBe(1);
  });

  test("locks an unknown paid retry and never treats a recovered quoted order as success", async () => {
    const quote = fixedQuote();
    const wire = paymentWire(quote, fixedIntent(quote));
    const signedMessage =
      `0x${"11".repeat(32)}${"22".repeat(32)}1b` as Hex;
    let paymentCreated = false;
    let recoveryCount = 0;
    let caught: unknown;

    try {
      await executeHyperliquidMarketplaceQuote(
        {
          config,
          walletClient: () => ({
            account: { address: payer },
            async signTypedData() {
              return signedMessage;
            },
          }) as unknown as WalletClient,
        },
        quote,
        fixedRequest,
        fixedExpectations,
        {
          onAfterPaymentCreation() {
            paymentCreated = true;
          },
          async fetch(input, init) {
            const request =
              input instanceof Request ? input : new Request(input, init);
            if (request.method === "GET") {
              recoveryCount += 1;
              return Response.json({ order: fixedOrder("quoted") });
            }
            if (!request.headers.get("PAYMENT-SIGNATURE")) {
              return paymentRequiredResponse(wire.paymentRequired);
            }
            throw new Error("The paid response was lost.");
          },
        },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HyperliquidPaymentClientError);
    expect(caught).toMatchObject({
      paymentCreated: true,
      retry: "locked",
    });
    expect(String((caught as Error).message)).toContain(
      "do not submit another payment",
    );
    expect(paymentCreated).toBe(true);
    expect(recoveryCount).toBe(1);
  });
});

function paymentRequiredResponse(
  paymentRequired: PaymentRequired,
): Response {
  return new Response(
    JSON.stringify(paymentRequired),
    {
      status: 402,
      headers: {
        "content-type": "application/json",
        "PAYMENT-REQUIRED": encodePaymentRequiredHeader(paymentRequired),
      },
    },
  );
}

function fixedOrder(
  status: HyperliquidOrderStatus,
): ReturnType<typeof parseHyperliquidMarketplaceOrder> {
  const quote = fixedQuote();
  return {
    execution: quote.execution,
    expiresAt: quote.expiresAt,
    kind: quote.kind,
    orderId: quote.orderId,
    payer: quote.payer,
    quoteId: quote.quoteId,
    recipient: quote.recipient,
    refundAddress: quote.refundAddress,
    sourcePayment: quote.payment,
    status,
  };
}

function fixedQuote(quotePayer: Address = payer): HyperliquidMarketplaceQuote {
  const callData = encodeFunctionData({
    abi: fixedPriceSaleAbi,
    functionName: "buy",
    args: [
      BigInt(fixedRequest.shareAmount),
      quotePayer,
      3_030_000n,
      BigInt(deadline),
    ],
  });
  return {
    execution: {
      callDataHash: keccak256(callData),
      chainId: 998,
      deadline,
      expectedOutput: fixedRequest.shareAmount,
      inputAmount: "3000000",
      inputToken: destinationUsdc,
      minimumOutput: fixedRequest.shareAmount,
      outputToken: shareToken,
      recipient: quotePayer,
      selector: callData.slice(0, 10) as Hex,
      target: sale,
    },
    expiresAt: new Date(deadline * 1_000).toISOString(),
    kind: "fixed_price_sale",
    orderId: quoteId,
    payer: quotePayer,
    payment: {
      amount: "303000000",
      asset: HYPERCORE_TESTNET_USDC,
      decimals: 8,
      network: HYPERCORE_TESTNET,
      payTo,
      principal: "300000000",
      serviceFee: "3000000",
      symbol: "USDC",
    },
    paymentId,
    quoteId,
    recipient: quotePayer,
    refundAddress: quotePayer,
  };
}

function fixedIntent(
  quote: HyperliquidMarketplaceQuote,
): HyperEvmExecutionIntent {
  const callData = encodeFunctionData({
    abi: fixedPriceSaleAbi,
    functionName: "buy",
    args: [
      BigInt(fixedRequest.shareAmount),
      quote.payer,
      3_030_000n,
      BigInt(deadline),
    ],
  });
  return baseIntent(quote, callData);
}

function baseIntent(
  quote: HyperliquidMarketplaceQuote,
  callData: Hex,
): HyperEvmExecutionIntent {
  return {
    application: config.application,
    callData,
    chainId: 998,
    deadline,
    gateway,
    maxGasCost: "2500000000000000",
    maxSlippageBps: 100,
    metadataHash: zeroHash,
    nonce: "nonce-1234567890abcdef",
    quoteId: quote.quoteId,
    recipient: quote.recipient,
    refundAddress: quote.refundAddress,
    target: quote.execution.target,
    user: quote.payer,
    value: "0",
    version: 2,
  };
}

function paymentWire(
  quote: HyperliquidMarketplaceQuote,
  intent: HyperEvmExecutionIntent,
): {
  declaration: ReturnType<typeof createIntentDeclaration>;
  paymentRequired: PaymentRequired;
  selected: PaymentRequirements;
} {
  const declaration = createIntentDeclaration(intent);
  const selected: PaymentRequirements = {
    amount: quote.payment.amount,
    asset: quote.payment.asset,
    extra: {
      [X402_HL_INTENTS_EXTRA_KEY]: createIntentPaymentExtra(
        intent,
        declaration.intentTemplateHash,
      ),
    },
    maxTimeoutSeconds: 300,
    network: quote.payment.network,
    payTo: quote.payment.payTo,
    scheme: "exact",
  };
  return {
    declaration,
    paymentRequired: {
      accepts: [selected],
      extensions: {
        [PAYMENT_IDENTIFIER]: declarePaymentIdentifierExtension(true),
        [X402_HL_INTENTS_EXTENSION]: declaration,
      },
      resource: {
        url: `${config.baseUrl}/v1/quotes/${quote.quoteId}/execute`,
      },
      x402Version: 2,
    },
    selected,
  };
}
