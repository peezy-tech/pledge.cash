import { getAddress, isAddress, type Address } from "viem";
import { z } from "zod";
import {
  HYPEREVM_TESTNET_CHAIN_ID,
  type MarketplaceActionKind,
  type MarketplaceQuote,
  type PublicOrder,
} from "../domain";

const UINT256_MAX = (1n << 256n) - 1n;

const addressSchema = z
  .string()
  .refine(isAddress, "Expected an EVM address.")
  .transform(value => getAddress(value));

const decimalIntegerSchema = z
  .string()
  .max(78, "Amount exceeds the uint256 range.")
  .regex(/^(0|[1-9][0-9]*)$/, "Expected an unsigned base-10 integer.")
  .refine(value => {
    const amount = BigInt(value);
    return amount > 0n && amount <= UINT256_MAX;
  }, "Amount must be between one and the uint256 maximum.");

const baseQuoteRequestSchema = z
  .object({
    chainId: z.literal(HYPEREVM_TESTNET_CHAIN_ID),
    boardroom: addressSchema,
    payer: addressSchema,
    recipient: addressSchema,
    refundAddress: addressSchema,
    maxSlippageBps: z.number().int().min(0).max(1_000),
  })
  .strict();

export const ammSwapQuoteRequestSchema = baseQuoteRequestSchema
  .extend({
    kind: z.literal("amm_swap"),
    pool: addressSchema,
    tokenIn: addressSchema,
    tokenOut: addressSchema,
    amountIn: decimalIntegerSchema,
  })
  .strict();

export const fixedPriceSaleQuoteRequestSchema = baseQuoteRequestSchema
  .extend({
    kind: z.literal("fixed_price_sale"),
    sale: addressSchema,
    shareAmount: decimalIntegerSchema,
  })
  .strict();

export const createQuoteRequestSchema = z.discriminatedUnion("kind", [
  ammSwapQuoteRequestSchema,
  fixedPriceSaleQuoteRequestSchema,
]);

export type CreateQuoteRequest = z.infer<typeof createQuoteRequestSchema>;

export function requireSameParty(input: {
  payer: Address;
  recipient: Address;
  refundAddress: Address;
}): void {
  const payer = input.payer.toLowerCase();
  if (
    input.recipient.toLowerCase() !== payer ||
    input.refundAddress.toLowerCase() !== payer
  ) {
    throw new QuoteRequestError(
      "payer, recipient, and refundAddress must be the same address in v1.",
      "party_mismatch",
    );
  }
}

export function toQuoteDto(quote: MarketplaceQuote) {
  return {
    orderId: quote.id,
    quoteId: quote.id,
    paymentId: quote.paymentId,
    kind: quote.kind,
    expiresAt: quote.expiresAt.toISOString(),
    payer: quote.payer,
    recipient: quote.recipient,
    refundAddress: quote.refundAddress,
    payment: quote.sourcePayment,
    execution: {
      chainId: quote.execution.chainId,
      target: quote.execution.target,
      callDataHash: quote.execution.callDataHash,
      selector: quote.execution.selector,
      recipient: quote.execution.recipient,
      inputToken: quote.execution.inputToken,
      inputAmount: quote.execution.inputAmount,
      outputToken: quote.execution.outputToken,
      expectedOutput: quote.execution.expectedOutput,
      minimumOutput: quote.execution.minimumOutput,
      deadline: quote.execution.deadline,
    },
  };
}

export function publicOrderKind(kind: MarketplaceActionKind): MarketplaceActionKind {
  return kind;
}

export function sanitizeOrder(order: PublicOrder): PublicOrder {
  return {
    ...order,
    ...(order.message === undefined
      ? {}
      : { message: order.message.slice(0, 240) }),
  };
}

export class QuoteRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 422,
  ) {
    super(message);
    this.name = "QuoteRequestError";
  }
}
