import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";
import type { PaymentPayload, SettleResponse } from "@x402/core/types";
import {
  getAddress,
  keccak256,
  stringToBytes,
  type Address,
  type Hex
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ExactHyperliquidScheme as ExactHyperliquidClient } from "x402-hl/exact/client";
import {
  hashPaymentRequirements,
  stableJson
} from "x402-hl/intents";
import {
  IntentExecutionRecordSchema,
  type IntentExecutionRecord,
  type IntentRefundContext
} from "x402-hl/intents/server";

import type {
  InventoryReservation,
  MarketplaceQuote,
  QuoteRepository
} from "../src/domain";
import {
  createDbClient,
  InventoryReservationError,
  PostgresAdapterOperationStore,
  PostgresIntentExecutionStore,
  PostgresQuoteRepository,
  type X402RouterDbClient
} from "../src/db";
import { DurableX402SettlementJournal } from "../src/execution/settlement-journal";
import { DurableHyperCoreRefundAdapter } from "../src/execution/hypercore-refund";

const databaseUrl = process.env.X402_ROUTER_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl === undefined ? describe.skip : describe;

const PAYER = getAddress("0x1111111111111111111111111111111111111111");
const GATEWAY = getAddress("0x2222222222222222222222222222222222222222");
const TARGET = getAddress("0x3333333333333333333333333333333333333333");
const DESTINATION_USDC = getAddress(
  "0x4444444444444444444444444444444444444444"
);
const HASH_A = `0x${"11".repeat(32)}` as Hex;
const HASH_B = `0x${"22".repeat(32)}` as Hex;
const HASH_C = `0x${"33".repeat(32)}` as Hex;
const HASH_D = `0x${"44".repeat(32)}` as Hex;
const JOURNAL_KEY = `0x${"ab".repeat(32)}` as Hex;

let client: X402RouterDbClient;

describeWithDatabase("Postgres router durability", () => {
  beforeAll(async () => {
    client = createDbClient(databaseUrl!);
    await client.migrate();
  });

  beforeEach(async () => {
    await client.sql`
      truncate table
        x402_router_adapter_operations,
        x402_router_intent_payments,
        x402_router_quote_payment_bindings,
        x402_router_inventory_reservations,
        x402_router_quotes
      restart identity cascade
    `;
  });

  afterAll(async () => {
    await client.close();
  });

  test("serializes concurrent inventory reservations without oversubscribing", async () => {
    const quotes = new PostgresQuoteRepository(client.sql);
    const reservation = destinationReservation("60");
    const availability = [
      { reservation, maximumAvailableInventory: 100n }
    ] as const;

    const results = await Promise.allSettled([
      quotes.createReserved({
        quote: marketplaceQuote("concurrent-a", [reservation]),
        availability
      }),
      quotes.createReserved({
        quote: marketplaceQuote("concurrent-b", [reservation]),
        availability
      })
    ]);

    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(result => result.status === "rejected");
    expect(rejected?.status).toBe("rejected");
    if (rejected?.status !== "rejected") throw new Error("expected one rejection");
    expect(rejected.reason).toBeInstanceOf(InventoryReservationError);
    expect(
      await quotes.reservedInventory({
        network: reservation.network,
        asset: reservation.asset,
        now: new Date()
      })
    ).toBe(60n);
  });

  test("keeps paid inventory committed through expiry and finalizes each scope", async () => {
    const quotes = new PostgresQuoteRepository(client.sql);
    const destination = destinationReservation("30");
    const refund = refundReservation("40");
    const executionQuote = marketplaceQuote(
      "committed-execution",
      [destination, refund],
      1
    );
    await quotes.createReserved({
      quote: executionQuote,
      availability: [
        { reservation: destination, maximumAvailableInventory: 100n },
        { reservation: refund, maximumAvailableInventory: 100n }
      ]
    });
    await quotes.commitReservations(executionQuote.id);

    expect(
      await quotes.releaseExpired(
        new Date(executionQuote.expiresAt.getTime() + 60_000)
      )
    ).toBe(0);
    expect(
      await quotes.reservedInventory({
        network: refund.network,
        asset: refund.asset,
        now: new Date(executionQuote.expiresAt.getTime() + 60_000)
      })
    ).toBe(40n);

    await expect(
      quotes.createReserved({
        quote: marketplaceQuote("blocked-by-commit", [refund]),
        availability: [
          { reservation: refund, maximumAvailableInventory: 40n }
        ]
      })
    ).rejects.toMatchObject({ code: "insufficient_inventory" });

    await quotes.finalizeExecution(executionQuote.id);
    await quotes.finalizeExecution(executionQuote.id);
    expect(await reservationStatuses(executionQuote.id)).toEqual([
      { scope: "destination_execution", status: "consumed" },
      { scope: "source_refund", status: "released" }
    ]);

    const refundQuote = marketplaceQuote(
      "committed-refund",
      [destinationReservation("5"), refundReservation("7")]
    );
    await quotes.createReserved({
      quote: refundQuote,
      availability: refundQuote.inventoryReservations.map(reservation => ({
        reservation,
        maximumAvailableInventory: 100n
      }))
    });
    await quotes.commitReservations(refundQuote.id);
    await quotes.finalizeRefund(refundQuote.id);
    await quotes.finalizeRefund(refundQuote.id);
    expect(await reservationStatuses(refundQuote.id)).toEqual([
      { scope: "destination_execution", status: "released" },
      { scope: "source_refund", status: "consumed" }
    ]);

    const unpaidQuote = marketplaceQuote(
      "released-unpaid",
      [destinationReservation("3")]
    );
    await quotes.createReserved({
      quote: unpaidQuote,
      availability: [
        {
          reservation: unpaidQuote.inventoryReservations[0]!,
          maximumAvailableInventory: 100n
        }
      ]
    });
    await quotes.releaseQuotedReservations(unpaidQuote.id);
    await quotes.releaseQuotedReservations(unpaidQuote.id);
    expect(await reservationStatuses(unpaidQuote.id)).toEqual([
      { scope: "destination_execution", status: "released" }
    ]);
  });

  test("atomically binds one payment payload and commits inventory before settlement", async () => {
    const quotes = new PostgresQuoteRepository(client.sql);
    const quote = marketplaceQuote(
      "payment-binding",
      [destinationReservation("30"), refundReservation("40")]
    );
    await quotes.createReserved({
      quote,
      availability: quote.inventoryReservations.map((reservation) => ({
        reservation,
        maximumAvailableInventory: 100n
      }))
    });
    const requirementsHash = hashPaymentRequirements(quote.paymentRequirements);

    const results = await Promise.allSettled([
      quotes.bindPaymentPayload({
        quoteId: quote.id,
        attemptId: HASH_A,
        paymentPayloadHash: HASH_A,
        paymentRequirementsHash: requirementsHash
      }),
      quotes.bindPaymentPayload({
        quoteId: quote.id,
        attemptId: HASH_B,
        paymentPayloadHash: HASH_B,
        paymentRequirementsHash: requirementsHash
      })
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const binding = await quotes.getPaymentBinding(quote.id);
    expect(binding?.paymentPayloadHash).toBe(
      results[0]?.status === "fulfilled" ? HASH_A : HASH_B
    );
    expect(await reservationStatuses(quote.id)).toEqual([
      { scope: "destination_execution", status: "committed" },
      { scope: "source_refund", status: "committed" }
    ]);

    expect(
      await quotes.releaseExpired(
        new Date(quote.expiresAt.getTime() + 60_000)
      )
    ).toBe(0);
    await quotes.finalizeExecution(quote.id);
    const finalized = await reservationStatuses(quote.id);
    await quotes.bindPaymentPayload(binding!);
    expect(await reservationStatuses(quote.id)).toEqual(finalized);
  });

  test("never releases inventory after a payment claim wins the quote lock", async () => {
    const quotes = new PostgresQuoteRepository(client.sql);
    const quote = marketplaceQuote(
      "binding-expiry-race",
      [destinationReservation("9"), refundReservation("11")],
      1
    );
    await quotes.createReserved({
      quote,
      availability: quote.inventoryReservations.map((reservation) => ({
        reservation,
        maximumAvailableInventory: 100n
      }))
    });
    await quotes.bindPaymentPayload({
      quoteId: quote.id,
      attemptId: HASH_A,
      paymentPayloadHash: HASH_A,
      paymentRequirementsHash: hashPaymentRequirements(
        quote.paymentRequirements
      )
    });

    await Promise.all([
      quotes.releaseExpired(new Date(quote.expiresAt.getTime() + 1)),
      quotes.releaseQuotedReservations(quote.id)
    ]);
    expect(await reservationStatuses(quote.id)).toEqual([
      { scope: "destination_execution", status: "committed" },
      { scope: "source_refund", status: "committed" }
    ]);
  });

  test("rejects a queued near-expiry binding before a replacement quote reuses inventory", async () => {
    const quotes = new PostgresQuoteRepository(client.sql);
    const reservation = destinationReservation("100");
    const expiringQuote = marketplaceQuote(
      "binding-inventory-lock-race",
      [reservation],
      3
    );
    await quotes.createReserved({
      quote: expiringQuote,
      availability: [{ reservation, maximumAvailableInventory: 100n }]
    });

    const inventoryLock = inventoryAdvisoryLockKey(reservation);
    let releaseInventoryLock = () => {};
    let inventoryLockAcquired = () => {};
    const releaseInventoryLockPromise = new Promise<void>((resolve) => {
      releaseInventoryLock = resolve;
    });
    const inventoryLockAcquiredPromise = new Promise<void>((resolve) => {
      inventoryLockAcquired = resolve;
    });
    const blocker = client.sql.begin(async (transaction) => {
      await transaction`
        select pg_advisory_xact_lock(hashtextextended(${inventoryLock}, 0))
      `;
      inventoryLockAcquired();
      await releaseInventoryLockPromise;
    });
    await inventoryLockAcquiredPromise;

    let released = false;
    const pendingOutcomes: Promise<unknown>[] = [];
    try {
      const expiryRows = await client.sql<Array<{ readonly expires_at: Date }>>`
        select expires_at
        from x402_router_quotes
        where id = ${expiringQuote.id}
      `;
      const expiresAt = expiryRows[0]?.expires_at;
      if (expiresAt === undefined) throw new Error("test quote expiry was unavailable");
      expect((await databaseWallClock()).getTime()).toBeLessThan(
        expiresAt.getTime()
      );

      const bindingOutcome = quotes.bindPaymentPayload({
        quoteId: expiringQuote.id,
        attemptId: HASH_A,
        paymentPayloadHash: HASH_A,
        paymentRequirementsHash: hashPaymentRequirements(
          expiringQuote.paymentRequirements
        )
      }).then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason })
      );
      pendingOutcomes.push(bindingOutcome);
      await waitForAdvisoryWaiters(inventoryLock, 1);

      const replacementQuote = marketplaceQuote(
        "replacement-after-binding-expiry",
        [reservation]
      );
      const replacementOutcome = quotes.createReserved({
        quote: replacementQuote,
        availability: [{ reservation, maximumAvailableInventory: 100n }]
      }).then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason })
      );
      pendingOutcomes.push(replacementOutcome);
      await waitForAdvisoryWaiters(inventoryLock, 2);
      expect((await databaseWallClock()).getTime()).toBeLessThan(
        expiresAt.getTime()
      );
      await waitForDatabaseTime(expiresAt);

      const outcomes = Promise.all([bindingOutcome, replacementOutcome]);
      releaseInventoryLock();
      released = true;
      await blocker;
      const [binding, replacement] = await outcomes;

      expect(binding.status).toBe("rejected");
      if (binding.status !== "rejected") {
        throw new Error("expected the expired binding to be rejected");
      }
      expect(binding.reason).toMatchObject({ code: "quote_expired" });
      expect(replacement.status).toBe("fulfilled");
      expect(await quotes.getPaymentBinding(expiringQuote.id)).toBeUndefined();
      expect(await reservationStatuses(expiringQuote.id)).toEqual([
        { scope: "destination_execution", status: "active" }
      ]);
      expect(await reservationStatuses(replacementQuote.id)).toEqual([
        { scope: "destination_execution", status: "active" }
      ]);
      expect(
        await quotes.reservedInventory({
          network: reservation.network,
          asset: reservation.asset,
          now: await databaseWallClock()
        })
      ).toBe(100n);
    } finally {
      if (!released) releaseInventoryLock();
      await blocker;
      await Promise.all(pendingOutcomes);
    }
  }, 10_000);

  test("recovers the exact sealed settlement after expiry and rejects an alternate payload", async () => {
    const quotes = new PostgresQuoteRepository(client.sql);
    const quote = marketplaceQuote(
      "journal-expired-replay",
      [destinationReservation("7"), refundReservation("8")],
      1
    );
    await quotes.createReserved({
      quote,
      availability: quote.inventoryReservations.map((reservation) => ({
        reservation,
        maximumAvailableInventory: 100n
      }))
    });
    const signer = privateKeyToAccount(
      `0x${"01".repeat(32)}` as Hex
    );
    const created = await new ExactHyperliquidClient(
      signer
    ).createPaymentPayload(2, quote.paymentRequirements);
    const paymentPayload: PaymentPayload = {
      ...created,
      accepted: quote.paymentRequirements
    };
    const payloadHash = keccak256(
      stringToBytes(stableJson(paymentPayload))
    );
    const requirementsHash = hashPaymentRequirements(
      quote.paymentRequirements
    );
    const journalNow = new Date(quote.createdAt.getTime() + 100);
    const firstStore = new PostgresAdapterOperationStore(
      client.sql,
      JOURNAL_KEY,
      { now: () => journalNow }
    );
    const firstJournal = new DurableX402SettlementJournal(
      firstStore,
      quotes,
      1_000
    );
    await firstJournal.prepare({
      quoteId: quote.id,
      paymentId: quote.paymentId,
      paymentIdentityHash: HASH_A,
      paymentPayloadHash: payloadHash,
      paymentRequirementsHash: requirementsHash,
      paymentPayload,
      paymentRequirements: quote.paymentRequirements
    });

    const afterExpiry = new Date(quote.expiresAt.getTime() + 10_000);
    const restartedJournal = new DurableX402SettlementJournal(
      new PostgresAdapterOperationStore(
        client.sql,
        JOURNAL_KEY,
        { now: () => afterExpiry }
      ),
      quotes,
      1_000
    );
    expect(
      await restartedJournal.lookup({
        quoteId: quote.id,
        paymentPayloadHash: payloadHash
      })
    ).toMatchObject({
      quoteId: quote.id,
      paymentPayloadHash: payloadHash,
      status: "prepared"
    });
    await expect(
      restartedJournal.prepare({
        quoteId: quote.id,
        paymentId: quote.paymentId,
        paymentIdentityHash: HASH_A,
        paymentPayloadHash: payloadHash,
        paymentRequirementsHash: requirementsHash,
        paymentPayload,
        paymentRequirements: quote.paymentRequirements
      })
    ).resolves.toMatchObject({
      quoteId: quote.id,
      paymentPayloadHash: payloadHash
    });

    const alternatePayload = structuredClone(paymentPayload);
    const payload = alternatePayload.payload as {
      nonce: number;
      action: { nonce: number };
    };
    payload.nonce += 1;
    payload.action.nonce += 1;
    const alternateHash = keccak256(
      stringToBytes(stableJson(alternatePayload))
    );
    await expect(
      restartedJournal.prepare({
        quoteId: quote.id,
        paymentId: quote.paymentId,
        paymentIdentityHash: HASH_A,
        paymentPayloadHash: alternateHash,
        paymentRequirementsHash: requirementsHash,
        paymentPayload: alternatePayload,
        paymentRequirements: quote.paymentRequirements
      })
    ).rejects.toMatchObject({ code: "settlement_identity_conflict" });
    expect(await reservationStatuses(quote.id)).toEqual([
      { scope: "destination_execution", status: "committed" },
      { scope: "source_refund", status: "committed" }
    ]);
  });

  test("keeps ambiguous incoming settlement evidence submitted and replays the exact envelope", async () => {
    const quotes = new PostgresQuoteRepository(client.sql);
    const quote = marketplaceQuote(
      "journal-ambiguous-replay",
      [destinationReservation("7"), refundReservation("8")]
    );
    await quotes.createReserved({
      quote,
      availability: quote.inventoryReservations.map((reservation) => ({
        reservation,
        maximumAvailableInventory: 100n
      }))
    });
    const signer = privateKeyToAccount(
      `0x${"01".repeat(32)}` as Hex
    );
    const created = await new ExactHyperliquidClient(
      signer
    ).createPaymentPayload(2, quote.paymentRequirements);
    const paymentPayload: PaymentPayload = {
      ...created,
      accepted: quote.paymentRequirements
    };
    const payloadHash = keccak256(
      stringToBytes(stableJson(paymentPayload))
    );
    let journalNow = new Date();
    const store = new PostgresAdapterOperationStore(
      client.sql,
      JOURNAL_KEY,
      { now: () => journalNow }
    );
    const journal = new DurableX402SettlementJournal(
      store,
      quotes,
      1_000
    );
    const input = {
      quoteId: quote.id,
      paymentId: quote.paymentId,
      paymentIdentityHash: HASH_A,
      paymentPayloadHash: payloadHash,
      paymentRequirementsHash: hashPaymentRequirements(
        quote.paymentRequirements
      ),
      paymentPayload,
      paymentRequirements: quote.paymentRequirements
    } as const;
    const prepared = await journal.prepare(input);
    const ambiguous: SettleResponse = {
      success: false,
      transaction: "",
      network: "hyperliquid:testnet",
      payer: signer.address,
      errorReason: "hl_transfer_not_confirmed"
    };
    await expect(
      journal.recordResult({
        attemptId: prepared.attemptId,
        paymentPayloadHash: payloadHash,
        settlement: ambiguous,
        recordedAt: journalNow.toISOString()
      })
    ).resolves.toMatchObject({
      status: "prepared",
      settlement: ambiguous
    });
    expect(await store.get("payment_settlement", HASH_A)).toMatchObject({
      status: "submitted",
      failureCode: "hl_transfer_not_confirmed",
      receipt: ambiguous
    });
    expect(await reservationStatuses(quote.id)).toEqual([
      { scope: "destination_execution", status: "committed" },
      { scope: "source_refund", status: "committed" }
    ]);

    journalNow = new Date(journalNow.getTime() + 2_000);
    const reclaimed = await journal.prepare(input);
    await expect(
      journal.recordResult({
        attemptId: reclaimed.attemptId,
        paymentPayloadHash: payloadHash,
        settlement: {
          success: true,
          transaction: HASH_D,
          network: "hyperliquid:testnet",
          payer: signer.address,
          amount: quote.paymentRequirements.amount
        },
        recordedAt: journalNow.toISOString()
      })
    ).resolves.toMatchObject({
      status: "settled",
      settlement: {
        success: true,
        transaction: HASH_D
      }
    });
  });

  test("binds one signed HyperCore action to at most one quote envelope", async () => {
    const quotes = new PostgresQuoteRepository(client.sql);
    const leftQuote = marketplaceQuote(
      "identity-left",
      [destinationReservation("7"), refundReservation("8")]
    );
    const rightQuote = marketplaceQuote(
      "identity-right",
      [destinationReservation("9"), refundReservation("10")]
    );
    for (const quote of [leftQuote, rightQuote]) {
      await quotes.createReserved({
        quote,
        availability: quote.inventoryReservations.map((reservation) => ({
          reservation,
          maximumAvailableInventory: 100n
        }))
      });
    }
    const signer = privateKeyToAccount(
      `0x${"01".repeat(32)}` as Hex
    );
    const created = await new ExactHyperliquidClient(
      signer
    ).createPaymentPayload(2, leftQuote.paymentRequirements);
    const leftPayload: PaymentPayload = {
      ...created,
      accepted: leftQuote.paymentRequirements,
      extensions: { wrapper: { quote: leftQuote.id } }
    };
    const rightPayload: PaymentPayload = {
      ...created,
      accepted: rightQuote.paymentRequirements,
      extensions: { wrapper: { quote: rightQuote.id } }
    };
    const leftHash = keccak256(
      stringToBytes(stableJson(leftPayload))
    );
    const rightHash = keccak256(
      stringToBytes(stableJson(rightPayload))
    );
    expect(leftHash).not.toBe(rightHash);
    const journal = new DurableX402SettlementJournal(
      new PostgresAdapterOperationStore(client.sql, JOURNAL_KEY),
      quotes,
      1_000
    );
    await journal.prepare({
      quoteId: leftQuote.id,
      paymentId: leftQuote.paymentId,
      paymentIdentityHash: HASH_A,
      paymentPayloadHash: leftHash,
      paymentRequirementsHash: hashPaymentRequirements(
        leftQuote.paymentRequirements
      ),
      paymentPayload: leftPayload,
      paymentRequirements: leftQuote.paymentRequirements
    });
    await expect(
      journal.prepare({
        quoteId: rightQuote.id,
        paymentId: rightQuote.paymentId,
        paymentIdentityHash: HASH_A,
        paymentPayloadHash: rightHash,
        paymentRequirementsHash: hashPaymentRequirements(
          rightQuote.paymentRequirements
        ),
        paymentPayload: rightPayload,
        paymentRequirements: rightQuote.paymentRequirements
      })
    ).rejects.toMatchObject({ code: "settlement_identity_conflict" });
    const bindings = await client.sql<
      Array<{ readonly quote_id: string }>
    >`
      select quote_id
      from x402_router_quote_payment_bindings
      order by quote_id
    `;
    expect(bindings.map(row => ({ quote_id: row.quote_id }))).toEqual([
      { quote_id: leftQuote.id }
    ]);
    expect(await reservationStatuses(leftQuote.id)).toEqual([
      { scope: "destination_execution", status: "committed" },
      { scope: "source_refund", status: "committed" }
    ]);
    expect(await reservationStatuses(rightQuote.id)).toEqual([
      { scope: "destination_execution", status: "active" },
      { scope: "source_refund", status: "active" }
    ]);
  });

  test("queues a confirmed settlement failure for one idempotent hold release", async () => {
    const quotes = new PostgresQuoteRepository(client.sql);
    const quote = marketplaceQuote(
      "settlement-failure-recovery",
      [destinationReservation("7"), refundReservation("8")]
    );
    await quotes.createReserved({
      quote,
      availability: quote.inventoryReservations.map((reservation) => ({
        reservation,
        maximumAvailableInventory: 100n
      }))
    });
    const signer = privateKeyToAccount(
      `0x${"01".repeat(32)}` as Hex
    );
    const created = await new ExactHyperliquidClient(
      signer
    ).createPaymentPayload(2, quote.paymentRequirements);
    const paymentPayload: PaymentPayload = {
      ...created,
      accepted: quote.paymentRequirements
    };
    const paymentPayloadHash = keccak256(
      stringToBytes(stableJson(paymentPayload))
    );
    const crashingQuotes = new Proxy(quotes, {
      get(target, property, receiver) {
        if (property === "finalizeSettlementFailure") {
          return async () => {
            throw new Error("simulated crash before failure finalization");
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      }
    }) as QuoteRepository;
    const journal = new DurableX402SettlementJournal(
      new PostgresAdapterOperationStore(client.sql, JOURNAL_KEY),
      crashingQuotes,
      1_000
    );
    const prepared = await journal.prepare({
      quoteId: quote.id,
      paymentId: quote.paymentId,
      paymentIdentityHash: HASH_A,
      paymentPayloadHash,
      paymentRequirementsHash: hashPaymentRequirements(
        quote.paymentRequirements
      ),
      paymentPayload,
      paymentRequirements: quote.paymentRequirements
    });
    await expect(
      journal.recordResult({
        attemptId: prepared.attemptId,
        paymentPayloadHash,
        settlement: {
          success: false,
          transaction: "",
          network: "hyperliquid:testnet",
          payer: signer.address,
          errorReason: "payment_expired"
        },
        recordedAt: new Date().toISOString()
      })
    ).rejects.toThrow("simulated crash");

    const before = new Date(Date.now() + 60_000);
    expect(
      (await quotes.listPaymentBindingsWithoutOrder({
        before,
        limit: 10
      })).map(binding => binding.quoteId)
    ).toEqual([quote.id]);
    await quotes.finalizeSettlementFailure(quote.id);
    expect(
      await quotes.listPaymentBindingsWithoutOrder({
        before,
        limit: 10
      })
    ).toHaveLength(0);
    expect(await reservationStatuses(quote.id)).toEqual([
      { scope: "destination_execution", status: "released" },
      { scope: "source_refund", status: "released" }
    ]);
  });

  test("atomically registers duplicate payments and compare-and-swaps transitions", async () => {
    const store = new PostgresIntentExecutionStore(client.sql);
    const left = intentRecord({
      intentHash: HASH_A,
      paymentTransaction: `0x${"aa".repeat(32)}`
    });
    const right = intentRecord({
      intentHash: HASH_A,
      paymentTransaction: `0x${"bb".repeat(32)}`
    });

    const registrations = await Promise.all([
      store.registerPaid(left),
      store.registerPaid(right)
    ]);
    expect(registrations.map(result => result.kind).sort()).toEqual([
      "created",
      "duplicate_payment"
    ]);

    const primary = await store.get(HASH_A);
    expect(primary?.status).toBe("paid");
    if (primary === undefined) throw new Error("primary intent was not stored");
    const transitions = await Promise.all([
      store.transition({
        intentHash: primary.intentHash,
        expectedRevision: primary.revision,
        from: "paid",
        to: "execution_claimed",
        patch: { claimToken: "claim-a", executionAttempts: 1 }
      }),
      store.transition({
        intentHash: primary.intentHash,
        expectedRevision: primary.revision,
        from: "paid",
        to: "execution_claimed",
        patch: { claimToken: "claim-b", executionAttempts: 1 }
      })
    ]);
    expect(transitions.map(result => result.kind).sort()).toEqual([
      "conflict",
      "updated"
    ]);
  });

  test("atomically allocates signer nonces and seals each matching signed payload", async () => {
    const store = new PostgresAdapterOperationStore(client.sql, JOURNAL_KEY);
    const [leftClaim, rightClaim] = await Promise.all([
      store.claim({
        kind: "execution",
        idempotencyKey: "nonce-left",
        requestHash: HASH_A,
        network: "eip155:998",
        signer: GATEWAY,
        leaseMs: 60_000
      }),
      store.claim({
        kind: "execution",
        idempotencyKey: "nonce-right",
        requestHash: HASH_B,
        network: "eip155:998",
        signer: GATEWAY,
        leaseMs: 60_000
      })
    ]);
    if (leftClaim.kind !== "claimed" || rightClaim.kind !== "claimed") {
      throw new Error("expected fresh operation claims");
    }

    const sign = (transactionHash: Hex) => async (nonce: bigint) => ({
      payload: JSON.stringify({
        nonce: nonce.toString(),
        rawTransaction: `0x${nonce.toString(16).padStart(2, "0")}${"de".repeat(79)}`
      }),
      transactionHash
    });
    const [leftSigned, rightSigned] = await Promise.all([
      store.recordSignedWithSignerNonce({
        kind: "execution",
        idempotencyKey: "nonce-left",
        expectedRevision: leftClaim.operation.revision,
        leaseToken: leftClaim.operation.leaseToken,
        minimumNonce: 12n,
        signingFailureCode: "test_signing_failed",
        createSignedPayload: sign(HASH_C)
      }),
      store.recordSignedWithSignerNonce({
        kind: "execution",
        idempotencyKey: "nonce-right",
        expectedRevision: rightClaim.operation.revision,
        leaseToken: rightClaim.operation.leaseToken,
        minimumNonce: 12n,
        signingFailureCode: "test_signing_failed",
        createSignedPayload: sign(HASH_D)
      })
    ]);
    if (leftSigned.kind !== "updated" || rightSigned.kind !== "updated") {
      throw new Error("expected atomic signed operations");
    }
    expect(
      [
        leftSigned.operation.signerNonce,
        rightSigned.operation.signerNonce
      ].sort((left, right) => Number(left! - right!))
    ).toEqual([12n, 13n]);

    for (const signed of [leftSigned, rightSigned]) {
      const payload = await store.loadPayload(
        "execution",
        signed.operation.idempotencyKey
      );
      expect(JSON.parse(payload ?? "{}").nonce).toBe(
        signed.operation.signerNonce?.toString()
      );
    }

    const raw = await client.sql<
      Array<{
        readonly payload_ciphertext: string;
        readonly signer_nonce: string;
        readonly status: string;
      }>
    >`
      select payload_ciphertext, signer_nonce::text, status
      from x402_router_adapter_operations
      where kind = 'execution'
      order by signer_nonce
    `;
    expect(raw.map(row => row.signer_nonce)).toEqual(["12", "13"]);
    expect(raw.every(row => row.status === "signed")).toBe(true);
    expect(raw.every(row => !row.payload_ciphertext.includes("rawTransaction"))).toBe(true);
    expect(raw.every(row => !row.payload_ciphertext.includes("dede"))).toBe(true);
  });

  test("rejects a partial crash checkpoint and terminalizes a definite signing failure", async () => {
    const store = new PostgresAdapterOperationStore(client.sql, JOURNAL_KEY);
    const claim = await store.claim({
      kind: "execution",
      idempotencyKey: "nonce-crash",
      requestHash: HASH_A,
      network: "eip155:998",
      signer: GATEWAY,
      leaseMs: 60_000
    });
    if (claim.kind !== "claimed") throw new Error("expected fresh claim");

    let partialWriteRejected = false;
    try {
      await client.sql`
        update x402_router_adapter_operations
        set signer_nonce = 12
        where id = ${claim.operation.id}
      `;
    } catch {
      partialWriteRejected = true;
    }
    expect(partialWriteRejected).toBe(true);
    const afterPartialWrite = await store.get("execution", "nonce-crash");
    expect(afterPartialWrite).toMatchObject({
      status: "claimed",
      hasEncryptedPayload: false
    });
    expect(afterPartialWrite?.signerNonce).toBeUndefined();

    const failed = await store.recordSignedWithSignerNonce({
      kind: "execution",
      idempotencyKey: "nonce-crash",
      expectedRevision: claim.operation.revision,
      leaseToken: claim.operation.leaseToken,
      minimumNonce: 12n,
      signingFailureCode: "test_signing_failed",
      createSignedPayload() {
        throw new Error("deterministic signer failure");
      }
    });
    expect(failed.kind).toBe("signing_failed");
    if (failed.kind !== "signing_failed") {
      throw new Error("expected terminal signing failure");
    }
    expect(failed.operation).toMatchObject({
      status: "manual_intervention",
      failureCode: "test_signing_failed",
      hasEncryptedPayload: true
    });
    expect(failed.operation.signerNonce).toBeUndefined();
    expect(failed.operation.transactionHash).toBeUndefined();
    expect(
      JSON.parse(
        (await store.loadPayload("execution", "nonce-crash")) ?? "{}"
      )
    ).toEqual({
      abandoned: true,
      reason: "test_signing_failed"
    });
    expect(await store.listRecoverable()).toEqual([]);
  });

  test("exposes only expired operation leases to background recovery", async () => {
    const startedAt = new Date("2030-01-01T00:00:00.000Z");
    const store = new PostgresAdapterOperationStore(
      client.sql,
      JOURNAL_KEY,
      { now: () => startedAt }
    );
    const claim = await store.claim({
      kind: "payment_settlement",
      idempotencyKey: HASH_A,
      requestHash: HASH_A,
      network: "hyperliquid:testnet",
      signer: PAYER,
      leaseMs: 1_000
    });
    expect(claim.kind).toBe("claimed");

    expect(
      await store.listRecoverable(
        10,
        new Date(startedAt.getTime() + 999)
      )
    ).toEqual([]);
    expect(
      (
        await store.listRecoverable(
          10,
          new Date(startedAt.getTime() + 1_000)
        )
      ).map((operation) => operation.idempotencyKey)
    ).toEqual([HASH_A]);
  });

  test("allocates unique monotonic HyperCore nonces for concurrent refunds from one signer", async () => {
    const refundSigner = privateKeyToAccount(
      `0x${"02".repeat(32)}` as Hex
    );
    const fixedNow = new Date("2030-01-01T00:00:00.000Z");
    const store = new PostgresAdapterOperationStore(
      client.sql,
      JOURNAL_KEY,
      { now: () => fixedNow }
    );
    const adapter = new DurableHyperCoreRefundAdapter(
      refundSigner,
      refundSigner.address,
      {
        async verify() {
          return { isValid: true, payer: refundSigner.address };
        },
        async settle(_payload, requirements) {
          return {
            success: false,
            transaction: "",
            network: "hyperliquid:testnet",
            payer: refundSigner.address,
            amount: requirements.amount,
            errorReason: "hl_transfer_not_confirmed"
          };
        }
      },
      store,
      new PostgresQuoteRepository(client.sql),
      1_000,
      () => fixedNow.getTime()
    );
    const context = (
      intentHash: Hex,
      paymentTransaction: Hex
    ): IntentRefundContext => {
      const base = intentRecord({ intentHash, paymentTransaction });
      return {
        intent: base.intent,
        record: {
          ...base,
          status: "refund_submitted",
          refundAttempts: 1,
          duplicatePayment: true
        },
        idempotencyKey: `${intentHash}:concurrent-refund`
      };
    };

    const results = await Promise.all([
      adapter.refund(context(HASH_A, HASH_C)),
      adapter.refund(context(HASH_B, HASH_D))
    ]);
    expect(results).toEqual([
      { success: false, retryable: false, mayHaveSucceeded: true },
      { success: false, retryable: false, mayHaveSucceeded: true }
    ]);

    const rows = await client.sql<
      Array<{
        readonly idempotency_key: string;
        readonly signer_nonce: string;
      }>
    >`
      select idempotency_key, signer_nonce::text
      from x402_router_adapter_operations
      where kind = 'refund'
      order by signer_nonce
    `;
    expect(rows).toHaveLength(2);
    expect(rows[0]?.signer_nonce).toBe(fixedNow.getTime().toString());
    expect(rows[1]?.signer_nonce).toBe(
      (fixedNow.getTime() + 1).toString()
    );
  });

  test("retains and replays one sealed refund payload after an ambiguous result", async () => {
    const refundSigner = privateKeyToAccount(
      `0x${"02".repeat(32)}` as Hex
    );
    let storeNow = new Date("2030-01-01T00:00:00.000Z");
    const store = new PostgresAdapterOperationStore(
      client.sql,
      JOURNAL_KEY,
      { now: () => storeNow }
    );
    const submittedPayloads: string[] = [];
    let settlementCalls = 0;
    const adapter = new DurableHyperCoreRefundAdapter(
      refundSigner,
      refundSigner.address,
      {
        async verify() {
          return { isValid: true, payer: refundSigner.address };
        },
        async settle(payload, requirements) {
          submittedPayloads.push(stableJson(payload));
          settlementCalls += 1;
          if (settlementCalls === 1) {
            return {
              success: false,
              transaction: "",
              network: "hyperliquid:testnet",
              payer: refundSigner.address,
              amount: requirements.amount,
              errorReason: "hl_exchange_error"
            };
          }
          return {
            success: true,
            transaction: HASH_D,
            network: "hyperliquid:testnet",
            payer: refundSigner.address,
            amount: requirements.amount
          };
        }
      },
      store,
      new PostgresQuoteRepository(client.sql),
      1_000,
      () => storeNow.getTime()
    );
    const base = intentRecord({
      intentHash: HASH_A,
      paymentTransaction: HASH_C
    });
    const context: IntentRefundContext = {
      intent: base.intent,
      record: {
        ...base,
        status: "refund_submitted",
        refundAttempts: 1,
        duplicatePayment: true
      },
      idempotencyKey: `${HASH_A}:ambiguous-refund`
    };
    const operationKey = `${context.idempotencyKey}:attempt:1`;

    await expect(adapter.refund(context)).resolves.toEqual({
      success: false,
      retryable: false,
      mayHaveSucceeded: true
    });
    const uncertain = await store.get("refund", operationKey);
    const sealed = await store.loadPayload("refund", operationKey);
    expect(uncertain).toMatchObject({
      status: "submitted",
      failureCode: "hl_exchange_error"
    });
    expect(uncertain?.receipt).toMatchObject({
      success: false,
      errorReason: "hl_exchange_error"
    });

    storeNow = new Date(storeNow.getTime() + 2_000);
    await expect(adapter.refund(context)).resolves.toMatchObject({
      success: true,
      transaction: HASH_D
    });
    const confirmed = await store.get("refund", operationKey);
    expect(confirmed).toMatchObject({
      status: "confirmed_success",
      signerNonce: uncertain?.signerNonce
    });
    expect(await store.loadPayload("refund", operationKey)).toBe(sealed);
    expect(submittedPayloads).toHaveLength(2);
    expect(submittedPayloads[0]).toBe(submittedPayloads[1]);
  });

  test("recovers a confirmed refund after crashing before reservation finalization", async () => {
    const quotes = new PostgresQuoteRepository(client.sql);
    const quote = marketplaceQuote(
      "refund-finalization-crash",
      [destinationReservation("12"), refundReservation("13")]
    );
    await quotes.createReserved({
      quote,
      availability: quote.inventoryReservations.map((reservation) => ({
        reservation,
        maximumAvailableInventory: 100n
      }))
    });
    await quotes.bindPaymentPayload({
      quoteId: quote.id,
      attemptId: HASH_A,
      paymentPayloadHash: HASH_A,
      paymentRequirementsHash: hashPaymentRequirements(
        quote.paymentRequirements
      )
    });
    let finalizationCalls = 0;
    const crashingQuotes = new Proxy(quotes, {
      get(target, property, receiver) {
        if (property === "finalizeRefund") {
          return async (quoteId: string) => {
            finalizationCalls += 1;
            if (finalizationCalls === 1) {
              throw new Error("simulated crash before refund finalization");
            }
            return target.finalizeRefund(quoteId);
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      }
    }) as QuoteRepository;
    const refundSigner = privateKeyToAccount(
      `0x${"02".repeat(32)}` as Hex
    );
    const adapter = new DurableHyperCoreRefundAdapter(
      refundSigner,
      refundSigner.address,
      {
        async verify() {
          return { isValid: true, payer: refundSigner.address };
        },
        async settle(_payload, requirements) {
          return {
            success: true,
            transaction: HASH_D,
            network: "hyperliquid:testnet",
            payer: refundSigner.address,
            amount: requirements.amount
          };
        }
      },
      new PostgresAdapterOperationStore(client.sql, JOURNAL_KEY),
      crashingQuotes,
      1_000
    );
    const base = intentRecord({
      intentHash: HASH_B,
      paymentTransaction: HASH_C
    });
    const record: IntentExecutionRecord = {
      ...base,
      quoteId: quote.id,
      intent: {
        ...base.intent,
        quoteId: quote.id
      },
      status: "refund_submitted",
      refundAttempts: 1
    };
    const context: IntentRefundContext = {
      intent: record.intent,
      record,
      idempotencyKey: `${HASH_B}:refund`
    };

    await expect(adapter.refund(context)).resolves.toEqual({
      success: false,
      retryable: false,
      mayHaveSucceeded: true
    });
    expect(
      await new PostgresAdapterOperationStore(
        client.sql,
        JOURNAL_KEY
      ).get("refund", `${HASH_B}:refund:attempt:1`)
    ).toMatchObject({
      status: "confirmed_success",
      transactionHash: HASH_D
    });
    await expect(adapter.reconcileSubmitted(record)).resolves.toEqual({
      status: "confirmed_success",
      transaction: HASH_D,
      network: "hyperliquid:testnet"
    });
    expect(finalizationCalls).toBe(2);
    expect(await reservationStatuses(quote.id)).toEqual([
      { scope: "destination_execution", status: "released" },
      { scope: "source_refund", status: "consumed" }
    ]);
  });

  test("uses one durable operation per definite refund retry and never consumes primary inventory for a duplicate", async () => {
    const quotes = new PostgresQuoteRepository(client.sql);
    const quote = marketplaceQuote(
      "refund-attempts",
      [destinationReservation("12"), refundReservation("13")]
    );
    await quotes.createReserved({
      quote,
      availability: quote.inventoryReservations.map((reservation) => ({
        reservation,
        maximumAvailableInventory: 100n
      }))
    });
    await quotes.bindPaymentPayload({
      quoteId: quote.id,
      attemptId: HASH_A,
      paymentPayloadHash: HASH_A,
      paymentRequirementsHash: hashPaymentRequirements(
        quote.paymentRequirements
      )
    });

    const refundSigner = privateKeyToAccount(
      `0x${"02".repeat(32)}` as Hex
    );
    let settlementCalls = 0;
    const adapter = new DurableHyperCoreRefundAdapter(
      refundSigner,
      refundSigner.address,
      {
        async verify() {
          return { isValid: true, payer: refundSigner.address };
        },
        async settle(_payload, requirements) {
          settlementCalls += 1;
          if (settlementCalls <= 2) {
            return {
              success: false,
              transaction: "",
              network: "hyperliquid:testnet",
              payer: refundSigner.address,
              amount: requirements.amount,
              errorReason: "payment_expired"
            };
          }
          return {
            success: true,
            transaction: HASH_D,
            network: "hyperliquid:testnet",
            payer: refundSigner.address,
            amount: requirements.amount
          };
        }
      },
      new PostgresAdapterOperationStore(client.sql, JOURNAL_KEY),
      quotes,
      1_000
    );
    const base = intentRecord({
      intentHash: HASH_B,
      paymentTransaction: HASH_C
    });
    const context = (
      attempt: number,
      duplicatePayment = false
    ): IntentRefundContext => ({
      intent: {
        ...base.intent,
        quoteId: quote.id
      },
      record: {
        ...base,
        quoteId: quote.id,
        status: "refund_submitted",
        refundAttempts: attempt,
        ...(duplicatePayment ? { duplicatePayment: true } : {})
      },
      idempotencyKey: duplicatePayment
        ? `${HASH_B}:refund:duplicate`
        : `${HASH_B}:refund`
    });

    await expect(adapter.refund(context(1))).resolves.toMatchObject({
      success: false,
      retryable: true,
      mayHaveSucceeded: false
    });
    await expect(adapter.refund(context(2))).resolves.toMatchObject({
      success: false,
      retryable: true,
      mayHaveSucceeded: false
    });
    await expect(adapter.refund(context(1, true))).resolves.toMatchObject({
      success: true,
      transaction: HASH_D
    });

    const operations = await client.sql<
      Array<{
        readonly idempotency_key: string;
        readonly status: string;
      }>
    >`
      select idempotency_key, status
      from x402_router_adapter_operations
      where kind = 'refund'
      order by created_at, idempotency_key
    `;
    expect(
      operations.map(({ idempotency_key, status }) => ({
        idempotency_key,
        status
      }))
    ).toEqual([
      {
        idempotency_key: `${HASH_B}:refund:attempt:1`,
        status: "confirmed_failure"
      },
      {
        idempotency_key: `${HASH_B}:refund:attempt:2`,
        status: "confirmed_failure"
      },
      {
        idempotency_key: `${HASH_B}:refund:duplicate:attempt:1`,
        status: "confirmed_success"
      }
    ]);
    expect(await reservationStatuses(quote.id)).toEqual([
      { scope: "destination_execution", status: "committed" },
      { scope: "source_refund", status: "committed" }
    ]);
  });

  async function reservationStatuses(quoteId: string) {
    const rows = await client.sql<
      Array<{
        readonly scope: InventoryReservation["scope"];
        readonly status: string;
      }>
    >`
      select scope, status
      from x402_router_inventory_reservations
      where quote_id = ${quoteId}
      order by scope
    `;
    return rows.map(row => ({ scope: row.scope, status: row.status }));
  }

  async function waitForAdvisoryWaiters(
    key: string,
    expected: number
  ): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const rows = await client.sql<Array<{ readonly count: string }>>`
        select count(*)::text as count
        from pg_locks,
          (select hashtextextended(${key}, 0) as value) advisory_key
        where locktype = 'advisory'
          and not granted
          and classid =
            (((advisory_key.value >> 32) & 4294967295)::oid)
          and objid = ((advisory_key.value & 4294967295)::oid)
          and objsubid = 1
      `;
      if (Number(rows[0]?.count ?? "0") >= expected) return;
      await Bun.sleep(10);
    }
    throw new Error(`Timed out waiting for ${expected} advisory-lock waiters`);
  }

  async function waitForDatabaseTime(target: Date): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if ((await databaseWallClock()).getTime() >= target.getTime()) return;
      await Bun.sleep(10);
    }
    throw new Error(`Timed out waiting for database time ${target.toISOString()}`);
  }

  async function databaseWallClock(): Promise<Date> {
    const rows = await client.sql<Array<{ readonly wall_clock: Date }>>`
      select clock_timestamp() as wall_clock
    `;
    const wallClock = rows[0]?.wall_clock;
    if (wallClock === undefined) throw new Error("database clock was unavailable");
    return wallClock;
  }
});

function destinationReservation(amount: string): InventoryReservation {
  return {
    scope: "destination_execution",
    network: "eip155:998",
    asset: DESTINATION_USDC,
    amount
  };
}

function inventoryAdvisoryLockKey(
  reservation: Pick<InventoryReservation, "network" | "asset">
): string {
  const identity = [
    reservation.network.trim().toLowerCase(),
    reservation.asset.trim().toLowerCase()
  ].join("\u0000");
  return JSON.stringify(["inventory", identity]);
}

function refundReservation(amount: string): InventoryReservation {
  return {
    scope: "source_refund",
    network: "hyperliquid:testnet",
    asset: "USDC:0xeb62eee3685fc4c43992febcd9e75443",
    amount
  };
}

function marketplaceQuote(
  id: string,
  reservations: readonly InventoryReservation[],
  ttlSeconds = 120
): MarketplaceQuote {
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + ttlSeconds * 1_000);
  const paymentRequirements = {
    scheme: "exact",
    network: "hyperliquid:testnet",
    asset: "USDC:0xeb62eee3685fc4c43992febcd9e75443",
    amount: "100",
    payTo: GATEWAY,
    maxTimeoutSeconds: ttlSeconds,
    extra: {}
  };
  const intent = {
    version: 2,
    application: "router.example/v1/execute",
    gateway: GATEWAY,
    user: PAYER,
    chainId: 998,
    target: TARGET,
    callData: "0x12345678",
    value: "0",
    recipient: PAYER,
    refundAddress: PAYER,
    maxGasCost: "1000000",
    maxSlippageBps: 100,
    deadline: Math.floor(expiresAt.getTime() / 1_000),
    nonce: `nonce-${id}`,
    quoteId: id,
    metadataHash: HASH_A
  };

  return {
    id,
    paymentId: `payment-${id}`,
    kind: "amm_swap",
    lifecycle: "quoted",
    payer: PAYER,
    recipient: PAYER,
    refundAddress: PAYER,
    boardroom: TARGET,
    canonicalTarget: TARGET,
    sourcePayment: {
      network: "hyperliquid:testnet",
      asset: "USDC:0xeb62eee3685fc4c43992febcd9e75443",
      symbol: "USDC",
      decimals: 8,
      amount: "100",
      principal: "99",
      serviceFee: "1",
      payTo: GATEWAY
    },
    execution: {
      chainId: 998,
      target: TARGET,
      callData: "0x12345678",
      callDataHash: HASH_B,
      selector: "0x12345678",
      value: "0",
      recipient: PAYER,
      inputToken: DESTINATION_USDC,
      inputAmount: "99",
      outputToken: TARGET,
      expectedOutput: "1",
      minimumOutput: "1",
      deadline: Math.floor(expiresAt.getTime() / 1_000)
    },
    maxGasCost: "1000000",
    maxSlippageBps: 100,
    intentQuote: {
      intent,
      intentHash: HASH_B,
      intentTemplateHash: HASH_C,
      paymentRequirementsHash: HASH_A
    },
    paymentRequirements,
    paymentRequired: {
      x402Version: 2,
      error: "Payment required",
      resource: {
        url: `https://router.example/v1/quotes/${id}/execute`,
        description: "Execute marketplace quote",
        mimeType: "application/json"
      },
      accepts: [paymentRequirements],
      extensions: {}
    },
    intentTemplateHash: HASH_C,
    inventoryReservations: reservations,
    expiresAt,
    createdAt
  } as unknown as MarketplaceQuote;
}

function intentRecord(input: {
  readonly intentHash: Hex;
  readonly paymentTransaction: string;
  readonly payer?: Address;
}): IntentExecutionRecord {
  const now = new Date().toISOString();
  return IntentExecutionRecordSchema.parse({
    version: 2,
    revision: 0,
    status: "paid",
    intentHash: input.intentHash,
    intentTemplateHash: HASH_B,
    paymentRequirementsHash: HASH_C,
    quoteId: "intent-quote",
    application: "router.example/v1/execute",
    gateway: GATEWAY,
    payer: input.payer ?? PAYER,
    paymentScheme: "exact",
    paymentNetwork: "hyperliquid:testnet",
    paymentAsset: "USDC:0xeb62eee3685fc4c43992febcd9e75443",
    paymentAmount: "100",
    paymentPayTo: GATEWAY,
    paymentTransaction: input.paymentTransaction,
    executionAttempts: 0,
    refundAttempts: 0,
    createdAt: now,
    updatedAt: now,
    intent: {
      version: 2,
      application: "router.example/v1/execute",
      gateway: GATEWAY,
      user: PAYER,
      chainId: 998,
      target: TARGET,
      callData: "0x12345678",
      value: "0",
      recipient: PAYER,
      refundAddress: PAYER,
      maxGasCost: "1000000",
      maxSlippageBps: 100,
      deadline: Math.floor(Date.now() / 1_000) + 300,
      nonce: "intent-nonce",
      quoteId: "intent-quote",
      metadataHash: HASH_A
    }
  });
}
