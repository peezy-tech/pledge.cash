import { getAddress, isAddress, type Address } from "viem";
import { z } from "zod";
import { HYPEREVM_TESTNET_CHAIN_ID } from "../domain";
import type {
  SupportChallenge,
  SupportInvoiceView,
  SupportPlan,
  SupportSubscriptionView,
} from "./domain";

const UINT256_MAX = (1n << 256n) - 1n;

export const supportAddressSchema = z
  .string()
  .refine(isAddress, "Expected an EVM address.")
  .transform(value => getAddress(value));

export const supportAmountSchema = z
  .string()
  .max(78, "Amount exceeds the uint256 range.")
  .regex(/^[1-9][0-9]*$/, "Expected a positive base-10 integer.")
  .refine(value => BigInt(value) <= UINT256_MAX, "Amount exceeds uint256.");

export const supportSignatureSchema = z
  .string()
  .max(2 + 2 * 65_536)
  .regex(/^0x(?:[a-fA-F0-9]{2})+$/, "Expected a whole-byte hex signature.");

export const supportPlanDraftSchema = z
  .object({
    chainId: z.literal(HYPEREVM_TESTNET_CHAIN_ID),
    boardroom: supportAddressSchema,
    amount: supportAmountSchema,
    cadence: z.literal("monthly"),
    title: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(280),
  })
  .strict();

export const supportChallengeCompletionSchema = z
  .object({
    challengeId: z.string().uuid(),
    signature: supportSignatureSchema,
  })
  .strict();

export const supportSubscriptionChallengeSchema = z
  .object({
    planId: z.string().uuid(),
    payer: supportAddressSchema,
  })
  .strict();

export const supportPlanIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const supportSubscriptionIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const supportInvoiceIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const supportPlansQuerySchema = z.object({
  boardroom: supportAddressSchema,
  payer: supportAddressSchema.optional(),
});

export type SupportPlanDraft = z.infer<typeof supportPlanDraftSchema>;

export function supportChallengeDto(challenge: SupportChallenge) {
  return {
    challengeId: challenge.id,
    action: challenge.action,
    actor: challenge.actor,
    boardroom: challenge.boardroom,
    chainId: challenge.chainId,
    facetSetHash: challenge.facetSetHash,
    planId: challenge.planId,
    message: challenge.message,
    payload: challenge.payload,
    payloadHash: challenge.payloadHash,
    expiresAt: challenge.expiresAt.toISOString(),
  };
}

export function supportPlanDto(plan: SupportPlan) {
  return {
    id: plan.id,
    chainId: plan.chainId,
    boardroom: plan.boardroom,
    asset: plan.asset,
    amount: plan.amount,
    cadence: plan.cadence,
    title: plan.title,
    description: plan.description,
    termsHash: plan.termsHash,
    status: plan.status,
    authority: plan.authority,
    authorityMode: plan.authorityMode,
    facetSetHash: plan.facetSetHash,
    createdAt: plan.createdAt.toISOString(),
    ...(plan.retiredAt ? { retiredAt: plan.retiredAt.toISOString() } : {}),
  };
}

export function supportInvoiceDto(invoice: SupportInvoiceView) {
  return {
    id: invoice.id,
    subscriptionId: invoice.subscriptionId,
    planId: invoice.planId,
    periodIndex: invoice.periodIndex,
    periodStart: invoice.periodStart.toISOString(),
    periodEnd: invoice.periodEnd.toISOString(),
    dueAt: invoice.dueAt.toISOString(),
    payer: invoice.payer,
    boardroom: invoice.boardroom,
    asset: invoice.asset,
    amount: invoice.amount,
    status: invoice.publicStatus,
    ...(invoice.latestQuoteId
      ? { latestQuoteId: invoice.latestQuoteId }
      : {}),
    ...(invoice.lastAttemptStatus
      ? { lastAttemptStatus: invoice.lastAttemptStatus }
      : {}),
  };
}

export function supportSubscriptionDto(view: SupportSubscriptionView) {
  return {
    plan: supportPlanDto(view.plan),
    subscription: {
      id: view.subscription.id,
      planId: view.subscription.planId,
      payer: view.subscription.payer,
      status: view.subscription.status,
      startedAt: view.subscription.startedAt.toISOString(),
      createdAt: view.subscription.createdAt.toISOString(),
      ...(view.subscription.cancelledAt
        ? { cancelledAt: view.subscription.cancelledAt.toISOString() }
        : {}),
    },
    ...(view.invoice ? { invoice: supportInvoiceDto(view.invoice) } : {}),
  };
}

export function normalizedAddress(value: Address): string {
  return value.toLowerCase();
}
