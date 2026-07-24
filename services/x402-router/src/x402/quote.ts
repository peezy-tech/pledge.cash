import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";
import {
  PAYMENT_IDENTIFIER,
  declarePaymentIdentifierExtension,
  isPaymentIdentifierExtension,
  isPaymentIdentifierRequired,
  isValidPaymentId
} from "@x402/extensions/payment-identifier";
import { getAddress } from "viem";
import type { Address, Hex } from "viem";
import {
  ExecutionIntentDomainSchema,
  X402_HL_INTENTS_EXTENSION,
  X402_HL_INTENTS_EXTRA_KEY,
  hashExecutionIntentTemplate,
  hashIntentText,
  hashPaymentRequirements,
  readIntentDeclaration,
  readIntentPaymentExtra,
  stableJson
} from "x402-hl/intents";
import { createIntentQuote } from "x402-hl/intents/server";

import {
  X402_DEFAULT_PAYMENT_TIMEOUT_SECONDS,
  X402_HYPERCORE_TESTNET_USDC_ASSET,
  X402_HYPERCORE_USDC_DECIMALS,
  X402_HYPERCORE_USDC_SYMBOL,
  X402_HYPEREVM_TESTNET_CHAIN_ID,
  X402_HYPERLIQUID_SIGNATURE_CHAIN_ID,
  X402_HYPERLIQUID_TESTNET,
  X402_PROTOCOL_VERSION
} from "./constants";
import type {
  CreatePersistedX402QuoteInput,
  PersistedX402Quote
} from "./types";

export class X402QuoteInvariantError extends Error {
  readonly code = "invalid_x402_quote";

  constructor(message: string) {
    super(message);
    this.name = "X402QuoteInvariantError";
  }
}

export interface X402QuoteConstructionConfig {
  readonly domain: {
    readonly application: string;
    readonly gateway: Address | string;
  };
  readonly paymentPayTo: Address | string;
  readonly now: number;
}

export function createPersistedX402Quote(
  config: X402QuoteConstructionConfig,
  input: CreatePersistedX402QuoteInput
): PersistedX402Quote {
  const domain = ExecutionIntentDomainSchema.parse(config.domain);
  const payer = getAddress(input.payer);
  const target = getAddress(input.target);
  const paymentPayTo = getAddress(config.paymentPayTo);
  const now = assertUnixTime(config.now, "Current time");
  const deadline = assertUnixTime(input.deadline, "Intent deadline");
  const maxTimeoutSeconds =
    input.maxTimeoutSeconds ?? X402_DEFAULT_PAYMENT_TIMEOUT_SECONDS;

  assertIdentifier(input.id, "Quote id");
  assertPaymentIdentifier(input.paymentId);
  assertIdentifier(input.nonce, "Intent nonce");
  assertAtomicAmount(input.paymentAmountAtomic, "Payment amount", false);
  assertAtomicAmount(input.maxGasCost, "Maximum gas cost", true);
  assertCallData(input.callData);
  assertResourceUrl(input.resourceUrl);

  if (
    !Number.isSafeInteger(maxTimeoutSeconds) ||
    maxTimeoutSeconds <= 0 ||
    maxTimeoutSeconds > X402_DEFAULT_PAYMENT_TIMEOUT_SECONDS
  ) {
    throw new X402QuoteInvariantError(
      `Payment timeout must be an integer from 1 to ${X402_DEFAULT_PAYMENT_TIMEOUT_SECONDS}`
    );
  }
  if (deadline <= now) {
    throw new X402QuoteInvariantError("Intent deadline must be in the future");
  }
  if (deadline - now < maxTimeoutSeconds) {
    throw new X402QuoteInvariantError(
      "Intent deadline must cover the complete payment timeout"
    );
  }
  if (
    !Number.isInteger(input.maxSlippageBps) ||
    input.maxSlippageBps < 0 ||
    input.maxSlippageBps > 10_000
  ) {
    throw new X402QuoteInvariantError(
      "Maximum slippage must be an integer from 0 to 10000 basis points"
    );
  }

  const paymentIdentifierHash = hashIntentText(input.paymentId);
  const resolved = createIntentQuote({
    id: input.id,
    network: X402_HYPERLIQUID_TESTNET,
    price: {
      amount: input.paymentAmountAtomic,
      asset: X402_HYPERCORE_TESTNET_USDC_ASSET,
      extra: {
        decimals: X402_HYPERCORE_USDC_DECIMALS,
        tokenSymbol: X402_HYPERCORE_USDC_SYMBOL
      }
    },
    payTo: paymentPayTo,
    maxTimeoutSeconds,
    mimeType: "application/json",
    ...(input.description === undefined
      ? {}
      : { description: input.description }),
    ...(input.serviceName === undefined
      ? {}
      : { serviceName: input.serviceName }),
    extra: {
      paymentIdentifierHash
    },
    intent: {
      application: domain.application,
      gateway: domain.gateway,
      user: payer,
      chainId: X402_HYPEREVM_TESTNET_CHAIN_ID,
      target,
      callData: input.callData as Hex,
      value: "0",
      recipient: payer,
      refundAddress: payer,
      maxGasCost: input.maxGasCost,
      maxSlippageBps: input.maxSlippageBps,
      deadline,
      nonce: input.nonce,
      metadata: {
        ...(input.metadata ?? {}),
        paymentIdentifierHash
      }
    }
  });

  const paymentRequirements: PaymentRequirements = {
    scheme: "exact",
    network: X402_HYPERLIQUID_TESTNET,
    amount: input.paymentAmountAtomic,
    asset: X402_HYPERCORE_TESTNET_USDC_ASSET,
    payTo: paymentPayTo,
    maxTimeoutSeconds,
    extra: {
      [X402_HL_INTENTS_EXTRA_KEY]: resolved.paymentExtra,
      decimals: X402_HYPERCORE_USDC_DECIMALS,
      tokenSymbol: X402_HYPERCORE_USDC_SYMBOL,
      signatureChainId: X402_HYPERLIQUID_SIGNATURE_CHAIN_ID,
      paymentIdentifierHash
    }
  };

  const paymentRequired: PaymentRequired = {
    x402Version: X402_PROTOCOL_VERSION,
    resource: {
      url: input.resourceUrl,
      mimeType: "application/json",
      ...(input.description === undefined
        ? {}
        : { description: input.description })
    },
    accepts: [paymentRequirements],
    extensions: {
      [PAYMENT_IDENTIFIER]: declarePaymentIdentifierExtension(true),
      [X402_HL_INTENTS_EXTENSION]: resolved.declaration
    }
  };

  const quote: PersistedX402Quote = {
    schemaVersion: 1,
    id: resolved.id,
    paymentId: input.paymentId,
    domain,
    intentQuote: resolved,
    intent: resolved.intent,
    intentTemplateHash: resolved.intentTemplateHash,
    paymentRequirements,
    paymentRequirementsHash: hashPaymentRequirements(paymentRequirements),
    paymentRequired,
    createdAt: new Date(now * 1_000).toISOString(),
    expiresAt: new Date(deadline * 1_000).toISOString()
  };

  assertPersistedX402Quote(quote, { domain, paymentPayTo });
  return quote;
}

export function assertPersistedX402Quote(
  quote: PersistedX402Quote,
  expected: {
    readonly domain: {
      readonly application: string;
      readonly gateway: Address | string;
    };
    readonly paymentPayTo: Address | string;
  }
): void {
  const domain = ExecutionIntentDomainSchema.parse(expected.domain);
  const paymentPayTo = getAddress(expected.paymentPayTo);

  if (quote.schemaVersion !== 1) {
    throw new X402QuoteInvariantError("Unsupported persisted quote schema");
  }
  assertIdentifier(quote.id, "Quote id");
  assertPaymentIdentifier(quote.paymentId);

  if (
    quote.domain.application !== domain.application ||
    getAddress(quote.domain.gateway) !== getAddress(domain.gateway)
  ) {
    throw new X402QuoteInvariantError("Persisted quote domain is not trusted");
  }
  if (
    quote.intent.application !== domain.application ||
    getAddress(quote.intent.gateway) !== getAddress(domain.gateway)
  ) {
    throw new X402QuoteInvariantError("Intent domain is not trusted");
  }
  if (quote.intent.quoteId !== quote.id) {
    throw new X402QuoteInvariantError("Intent quote id does not match its record");
  }
  if (
    quote.intentQuote.id !== quote.id ||
    quote.intentQuote.intentTemplateHash.toLowerCase() !==
      quote.intentTemplateHash.toLowerCase() ||
    hashExecutionIntentTemplate(quote.intentQuote.intent).toLowerCase() !==
      quote.intentTemplateHash.toLowerCase()
  ) {
    throw new X402QuoteInvariantError(
      "Resolved intent quote does not match its persisted record"
    );
  }
  if (quote.intent.chainId !== X402_HYPEREVM_TESTNET_CHAIN_ID) {
    throw new X402QuoteInvariantError("Intent is not on HyperEVM testnet");
  }

  const user = getAddress(quote.intent.user);
  if (
    getAddress(quote.intent.recipient) !== user ||
    getAddress(quote.intent.refundAddress) !== user
  ) {
    throw new X402QuoteInvariantError(
      "Intent payer, recipient, and refund address must be identical"
    );
  }

  const templateHash = hashExecutionIntentTemplate(quote.intent);
  if (templateHash.toLowerCase() !== quote.intentTemplateHash.toLowerCase()) {
    throw new X402QuoteInvariantError("Persisted intent template hash is invalid");
  }

  if (
    quote.paymentRequired.x402Version !== X402_PROTOCOL_VERSION ||
    quote.paymentRequired.accepts.length !== 1
  ) {
    throw new X402QuoteInvariantError(
      "A quote must advertise exactly one finalized x402 v2 payment option"
    );
  }

  const requirements = quote.paymentRequirements;
  const advertised = quote.paymentRequired.accepts[0]!;
  const persistedRequirementsHash = hashPaymentRequirements(requirements);
  const advertisedRequirementsHash = hashPaymentRequirements(advertised);
  if (
    persistedRequirementsHash.toLowerCase() !==
      quote.paymentRequirementsHash.toLowerCase() ||
    advertisedRequirementsHash.toLowerCase() !==
      quote.paymentRequirementsHash.toLowerCase()
  ) {
    throw new X402QuoteInvariantError(
      "Advertised and persisted payment requirements differ"
    );
  }

  if (
    requirements.scheme !== "exact" ||
    requirements.network !== X402_HYPERLIQUID_TESTNET ||
    requirements.asset !== X402_HYPERCORE_TESTNET_USDC_ASSET ||
    getAddress(requirements.payTo) !== paymentPayTo
  ) {
    throw new X402QuoteInvariantError(
      "Payment requirements are outside the testnet USDC boundary"
    );
  }
  assertAtomicAmount(requirements.amount, "Payment amount", false);
  const expectedPaymentIdentifierHash = hashIntentText(quote.paymentId);
  const intentPaymentIdentifierHash =
    quote.intent.metadata?.paymentIdentifierHash;
  if (
    requirements.extra?.decimals !== X402_HYPERCORE_USDC_DECIMALS ||
    requirements.extra?.tokenSymbol !== X402_HYPERCORE_USDC_SYMBOL ||
    requirements.extra?.signatureChainId !==
      X402_HYPERLIQUID_SIGNATURE_CHAIN_ID ||
    typeof requirements.extra?.paymentIdentifierHash !== "string" ||
    requirements.extra.paymentIdentifierHash.toLowerCase() !==
      expectedPaymentIdentifierHash.toLowerCase() ||
    typeof intentPaymentIdentifierHash !== "string" ||
    intentPaymentIdentifierHash.toLowerCase() !==
      expectedPaymentIdentifierHash.toLowerCase()
  ) {
    throw new X402QuoteInvariantError(
      "Payment requirements contain invalid Hyperliquid metadata"
    );
  }

  const paymentIdentifierDeclaration =
    quote.paymentRequired.extensions?.[PAYMENT_IDENTIFIER];
  const expectedPaymentIdentifierDeclaration =
    declarePaymentIdentifierExtension(true);
  if (
    !isPaymentIdentifierExtension(paymentIdentifierDeclaration) ||
    !isPaymentIdentifierRequired(paymentIdentifierDeclaration) ||
    paymentIdentifierDeclaration.info.id !== undefined ||
    stableJson(paymentIdentifierDeclaration) !==
      stableJson(expectedPaymentIdentifierDeclaration)
  ) {
    throw new X402QuoteInvariantError(
      "PaymentRequired must contain the canonical required payment identifier declaration"
    );
  }

  const intentExtra = readIntentPaymentExtra(requirements);
  if (
    !intentExtra ||
    intentExtra.quoteId !== quote.id ||
    intentExtra.intentTemplateHash.toLowerCase() !==
      quote.intentTemplateHash.toLowerCase()
  ) {
    throw new X402QuoteInvariantError(
      "Payment requirements are not bound to the persisted intent"
    );
  }

  const declaration = readIntentDeclaration(quote.paymentRequired);
  if (
    !declaration ||
    declaration.required !== true ||
    declaration.mode !== "brokered" ||
    declaration.quoteId !== quote.id ||
    declaration.intentTemplateHash.toLowerCase() !==
      quote.intentTemplateHash.toLowerCase() ||
    hashExecutionIntentTemplate(declaration.intent).toLowerCase() !==
      quote.intentTemplateHash.toLowerCase()
  ) {
    throw new X402QuoteInvariantError(
      "PaymentRequired does not contain the exact required intent declaration"
    );
  }

  if (new Date(quote.expiresAt).getTime() !== quote.intent.deadline * 1_000) {
    throw new X402QuoteInvariantError(
      "Persisted quote expiry does not match the signed deadline"
    );
  }
}

function assertAtomicAmount(
  value: string,
  label: string,
  allowZero: boolean
): void {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new X402QuoteInvariantError(`${label} must be canonical atomic units`);
  }
  const amount = BigInt(value);
  if ((!allowZero && amount === 0n) || amount >= 1n << 256n) {
    throw new X402QuoteInvariantError(`${label} is outside the permitted range`);
  }
}

function assertIdentifier(value: string, label: string): void {
  if (
    value.length === 0 ||
    value.length > 256 ||
    value.trim() !== value ||
    !isWellFormedUnicode(value)
  ) {
    throw new X402QuoteInvariantError(`${label} is not a canonical identifier`);
  }
}

function assertPaymentIdentifier(value: string): void {
  if (!isValidPaymentId(value)) {
    throw new X402QuoteInvariantError(
      "Payment id must be 16-128 alphanumeric, hyphen, or underscore characters"
    );
  }
}

function assertUnixTime(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new X402QuoteInvariantError(`${label} must be a positive Unix timestamp`);
  }
  return value;
}

function assertCallData(value: string): void {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new X402QuoteInvariantError("Calldata must be byte-aligned hexadecimal");
  }
}

function assertResourceUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new X402QuoteInvariantError("Resource URL must be absolute");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new X402QuoteInvariantError("Resource URL must use HTTP or HTTPS");
  }
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}
