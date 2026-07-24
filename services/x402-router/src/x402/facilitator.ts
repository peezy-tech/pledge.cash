import { x402Facilitator } from "@x402/core/facilitator";
import {
  registerExactHyperliquidScheme
} from "x402-hl/exact/facilitator";

import { X402_HYPERLIQUID_TESTNET } from "./constants";
import type { X402Facilitator } from "./types";

/**
 * In-process exact-payment facilitator. It needs no operator key: the payer
 * signs sendAsset, while the facilitator validates, submits, and confirms it.
 */
export function createLocalHyperliquidTestnetFacilitator(): X402Facilitator {
  const facilitator = registerExactHyperliquidScheme(new x402Facilitator(), {
    networks: [X402_HYPERLIQUID_TESTNET]
  });

  return {
    verify(paymentPayload, paymentRequirements) {
      return facilitator.verify(paymentPayload, paymentRequirements);
    },
    settle(paymentPayload, paymentRequirements) {
      return facilitator.settle(paymentPayload, paymentRequirements);
    }
  };
}
