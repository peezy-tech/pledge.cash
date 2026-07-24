import type { SettleResponse } from "@x402/core/types";

/**
 * These failures are produced before x402-hl submits a sendAsset action, or
 * after its pre-submit reconciliation proves an expired action did not land.
 * Everything else is uncertain by default: new dependency error codes must
 * never release inventory or authorize a replacement payment/refund.
 */
const DEFINITIVE_NO_TRANSFER_REASONS = new Set([
  "invalid_x402_version",
  "unsupported_scheme",
  "network_mismatch",
  "invalid_exact_hl_payload",
  "invalid_exact_hl_payload_signature",
  "invalid_exact_hl_payload_signer_mismatch",
  "invalid_exact_hl_payload_nonce_mismatch",
  "invalid_exact_hl_payload_chain_mismatch",
  "invalid_exact_hl_payload_asset_mismatch",
  "invalid_exact_hl_payload_recipient_mismatch",
  "invalid_exact_hl_payload_amount_mismatch",
  "invalid_exact_hl_network",
  "payment_expired",
]);

export type HyperCoreSettlementDisposition =
  | "confirmed_success"
  | "definitive_failure"
  | "uncertain";

export function classifyHyperCoreSettlement(
  settlement: SettleResponse,
): HyperCoreSettlementDisposition {
  if (settlement.success) return "confirmed_success";
  return typeof settlement.errorReason === "string" &&
    DEFINITIVE_NO_TRANSFER_REASONS.has(settlement.errorReason)
    ? "definitive_failure"
    : "uncertain";
}
