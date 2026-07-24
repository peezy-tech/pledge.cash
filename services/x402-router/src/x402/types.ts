import type {
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse
} from "@x402/core/types";
import type { Address, Hex } from "viem";
import type {
  ExecutionIntentDomain,
  HyperEvmExecutionIntent,
  JsonValue
} from "x402-hl/intents";
import type {
  IntentExecutionRecord,
  PreSettlementIntentVerificationResult,
  ResolvedIntentQuote
} from "x402-hl/intents/server";

import type { X402ReleaseSafety } from "./release-gate";

export class X402SettlementIdentityConflictError extends Error {
  readonly code = "settlement_identity_conflict";

  constructor(message = "Signed HyperCore action is already journaled") {
    super(message);
    this.name = "X402SettlementIdentityConflictError";
  }
}

export interface CreatePersistedX402QuoteInput {
  /** Server-generated immutable quote identifier. */
  readonly id: string;
  /** Server-generated payment correlation identifier; committed by hash. */
  readonly paymentId: string;
  /** Absolute URL of the paid execution resource. */
  readonly resourceUrl: string;
  /** The only permitted payer, destination recipient, and refund recipient. */
  readonly payer: Address | string;
  /** Canonical allowlisted HyperEVM target. */
  readonly target: Address | string;
  /** Canonical calldata produced by the marketplace adapter. */
  readonly callData: Hex | string;
  /** HyperCore USDC atomic units (8 decimals), including any disclosed fee. */
  readonly paymentAmountAtomic: string;
  /** Maximum destination gas cost in wei. */
  readonly maxGasCost: string;
  readonly maxSlippageBps: number;
  /** Unix timestamp in seconds. */
  readonly deadline: number;
  /** Unique server-generated nonce, independent of the payment identifier. */
  readonly nonce: string;
  readonly maxTimeoutSeconds?: number;
  readonly description?: string;
  readonly serviceName?: string;
  readonly metadata?: Record<string, JsonValue>;
}

/**
 * Persist this object before returning its PaymentRequired payload. Never
 * reconstruct requirements or trusted intent fields from the paid request.
 */
export interface PersistedX402Quote {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly paymentId: string;
  readonly domain: ExecutionIntentDomain;
  readonly intentQuote: ResolvedIntentQuote;
  readonly intent: HyperEvmExecutionIntent;
  readonly intentTemplateHash: Hex;
  readonly paymentRequirements: PaymentRequirements;
  readonly paymentRequirementsHash: Hex;
  readonly paymentRequired: PaymentRequired;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface X402Facilitator {
  verify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements
  ): Promise<VerifyResponse>;
  settle(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements
  ): Promise<SettleResponse>;
}

/**
 * Structural subset returned by createIntentExecutor. Keeping this interface
 * narrow makes the HTTP layer testable without weakening the executor itself.
 */
export interface X402IntentExecutor {
  verifyBeforeSettlement(input: {
    readonly paymentPayload: PaymentPayload;
    readonly paymentRequirements: PaymentRequirements;
    readonly expectedQuoteId: string;
    readonly expectedIntentTemplateHash: Hex | string;
    readonly now?: number;
  }): Promise<PreSettlementIntentVerificationResult>;

  execute(input: {
    readonly paymentPayload: PaymentPayload;
    readonly paymentRequirements: PaymentRequirements;
    readonly settleResponse: SettleResponse;
    readonly expectedQuoteId: string;
    readonly expectedIntentTemplateHash: Hex | string;
    readonly now?: number;
  }): Promise<IntentExecutionRecord>;
}

export interface X402SettlementJournalRecord {
  readonly attemptId: string;
  readonly quoteId: string;
  readonly paymentId: string;
  /** Identity of the recovered signer plus exact signed sendAsset action. */
  readonly paymentIdentityHash: Hex;
  /** Integrity hash of the complete, sealed x402 envelope. */
  readonly paymentPayloadHash: Hex;
  readonly paymentRequirementsHash: Hex;
  readonly paymentPayload: PaymentPayload;
  readonly paymentRequirements: PaymentRequirements;
  readonly status: "prepared" | "settled" | "failed";
  readonly settlement?: SettleResponse;
}

/**
 * This is the crash boundary between signed-payment verification and moving
 * HyperCore funds. `prepare` and `recordResult` must each be durable before
 * resolving. Implementations should make `prepare` idempotent on
 * paymentPayloadHash and reject a hash bound to different quote/requirements.
 */
export interface X402SettlementJournal {
  lookup(input: {
    readonly quoteId: string;
    readonly paymentPayloadHash: Hex;
  }): Promise<X402SettlementJournalRecord | undefined>;

  lookupByQuoteId(
    quoteId: string
  ): Promise<X402SettlementJournalRecord | undefined>;

  prepare(input: {
    readonly quoteId: string;
    readonly paymentId: string;
    readonly paymentIdentityHash: Hex;
    readonly paymentPayloadHash: Hex;
    readonly paymentRequirementsHash: Hex;
    readonly paymentPayload: PaymentPayload;
    readonly paymentRequirements: PaymentRequirements;
  }): Promise<X402SettlementJournalRecord>;

  recordResult(input: {
    readonly attemptId: string;
    readonly paymentPayloadHash: Hex;
    readonly settlement: SettleResponse;
    readonly recordedAt: string;
  }): Promise<X402SettlementJournalRecord>;
}

export interface X402ServerLayerConfig {
  readonly domain: ExecutionIntentDomain;
  readonly paymentPayTo: Address | string;
  readonly facilitator: X402Facilitator;
  readonly executor: X402IntentExecutor;
  readonly settlementJournal: X402SettlementJournal;
  /**
   * Override only for deterministic tests. Production reads the installed
   * x402-hl package metadata.
   */
  readonly installedX402HlVersion?: string;
  readonly now?: () => number;
}

export interface SettlePersistedX402QuoteInput {
  readonly quote: PersistedX402Quote;
  readonly paymentPayload: PaymentPayload;
  readonly now?: number;
}

export interface SettledX402Execution {
  readonly quoteId: string;
  readonly paymentId: string;
  readonly settlement: SettleResponse & {
    readonly success: true;
    readonly transaction: string;
    readonly payer: string;
    readonly network: string;
    readonly amount: string;
  };
  readonly execution: IntentExecutionRecord;
}

export interface X402ServerLayer {
  readonly releaseSafety: X402ReleaseSafety;
  createQuote(input: CreatePersistedX402QuoteInput): PersistedX402Quote;
  paymentRequired(quote: PersistedX402Quote): PaymentRequired;
  paymentAttempt(input: {
    readonly quoteId: string;
    readonly paymentPayloadHash?: Hex;
  }): Promise<X402SettlementJournalRecord | undefined>;
  settleAndExecute(input: SettlePersistedX402QuoteInput): Promise<SettledX402Execution>;
}
