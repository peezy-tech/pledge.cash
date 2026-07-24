import {
  ammRouterAbi,
  erc20Abi,
  fixedPriceSaleAbi,
} from "@pledge.cash/sdk";
import {
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  keccak256,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import type {
  IntentExecutionContext,
  IntentPolicyDecision,
  IntentSimulationResult,
} from "x402-hl/intents/server";
import type { MarketplaceQuote, QuoteRepository } from "../domain";
import type { CanonicalExecutionValidator } from "../quotes/canonical";
import type { RecurringSupportExecutionValidator } from "../support/execution";
import {
  buildEip1559TransactionEnvelope,
  simulationMetadata,
} from "./transaction-envelope";

export function createMarketplaceExecutionPolicy(
  repository: QuoteRepository,
  canonical: CanonicalExecutionValidator | undefined,
  recurringSupport?: RecurringSupportExecutionValidator,
) {
  return async (
    context: IntentExecutionContext,
  ): Promise<IntentPolicyDecision> => {
    const quote = await repository.get(context.record.quoteId);
    if (
      !quote ||
      !canonical ||
      !intentMatchesQuote(context, quote) ||
      !decodeAndValidateCanonicalCall(quote)
    ) {
      return { allowed: false };
    }
    try {
      await canonical.assertCanonicalExecution(quote);
      if (quote.kind === "recurring_support") {
        if (!recurringSupport) return { allowed: false };
        await recurringSupport.assertPayable(quote);
      }
    } catch {
      return { allowed: false };
    }
    return {
      allowed: true,
      chainId: quote.execution.chainId,
      target: quote.execution.target,
      selector: quote.execution.selector,
      callDataHash: quote.execution.callDataHash,
      value: quote.execution.value,
      recipient: quote.execution.recipient,
      metadata: {
        quoteId: quote.id,
        kind: quote.kind,
        canonicalTarget: quote.canonicalTarget,
      },
    };
  };
}

export function createMarketplaceSimulation(
  client: PublicClient,
  executor: Address,
  repository: QuoteRepository,
) {
  return async (
    context: IntentExecutionContext,
    policy: Extract<IntentPolicyDecision, { allowed: true }>,
  ): Promise<IntentSimulationResult> => {
    const quote = await repository.get(context.record.quoteId);
    if (!quote || !intentMatchesQuote(context, quote)) {
      return { success: false };
    }

    try {
      const [gas, fees, slippageBps] = await Promise.all([
        client.estimateGas({
          account: executor,
          to: quote.execution.target,
          data: quote.execution.callData,
          value: 0n,
        }),
        client.estimateFeesPerGas(),
        currentSlippageBps(client, quote),
      ]);
      const gasPrice =
        fees.maxFeePerGas ?? fees.gasPrice;
      const priorityFee =
        fees.maxPriorityFeePerGas ??
        (gasPrice === undefined ? undefined : gasPrice / 10n);
      if (gasPrice === undefined || priorityFee === undefined) {
        return { success: false };
      }
      const transaction = buildEip1559TransactionEnvelope({
        estimatedGas: gas,
        maxFeePerGas: gasPrice,
        maxPriorityFeePerGas: priorityFee,
      });
      if (transaction.gasCost > BigInt(quote.maxGasCost)) {
        return { success: false };
      }
      await client.call({
        account: executor,
        to: quote.execution.target,
        data: quote.execution.callData,
        value: 0n,
        gas: transaction.gas,
        maxFeePerGas: transaction.maxFeePerGas,
        maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
      });

      return {
        success: true,
        chainId: Number(policy.chainId),
        target: getAddress(policy.target),
        callDataHash: policy.callDataHash as Hex,
        value: policy.value,
        recipient: getAddress(policy.recipient),
        gasCost: transaction.gasCost.toString(),
        slippageBps,
        metadata: simulationMetadata(transaction),
      };
    } catch {
      return { success: false };
    }
  };
}

function intentMatchesQuote(
  context: IntentExecutionContext,
  quote: MarketplaceQuote,
): boolean {
  const intent = context.intent;
  return (
    intent.quoteId === quote.id &&
    sameAddress(intent.user, quote.payer) &&
    sameAddress(intent.recipient, quote.recipient) &&
    sameAddress(intent.refundAddress, quote.refundAddress) &&
    intent.chainId === quote.execution.chainId &&
    sameAddress(intent.target, quote.execution.target) &&
    intent.callData.toLowerCase() === quote.execution.callData.toLowerCase() &&
    keccak256(intent.callData as Hex).toLowerCase() ===
      quote.execution.callDataHash.toLowerCase() &&
    intent.value === "0" &&
    intent.maxGasCost === quote.maxGasCost &&
    intent.maxSlippageBps === quote.maxSlippageBps &&
    intent.deadline === quote.execution.deadline
  );
}

function decodeAndValidateCanonicalCall(quote: MarketplaceQuote): boolean {
  try {
    if (quote.kind === "amm_swap") {
      const decoded = decodeFunctionData({
        abi: ammRouterAbi,
        data: quote.execution.callData,
      });
      if (
        decoded.functionName !== "swapExactTokensForTokens" ||
        !decoded.args
      ) {
        return false;
      }
      const [amountIn, amountOutMin, path, recipient, deadline] = decoded.args;
      if (
        BigInt(amountIn) !== BigInt(quote.execution.inputAmount) ||
        BigInt(amountOutMin) !== BigInt(quote.execution.minimumOutput) ||
        path.length !== 2 ||
        path[0] === undefined ||
        path[1] === undefined ||
        !sameAddress(path[0], quote.execution.inputToken) ||
        !sameAddress(path[1], quote.execution.outputToken) ||
        !sameAddress(recipient, quote.execution.recipient) ||
        Number(deadline) !== quote.execution.deadline
      ) {
        return false;
      }
      return (
        encodeFunctionData({
          abi: ammRouterAbi,
          functionName: decoded.functionName,
          args: decoded.args,
        }).toLowerCase() === quote.execution.callData.toLowerCase()
      );
    }

    if (quote.kind === "recurring_support") {
      const decoded = decodeFunctionData({
        abi: erc20Abi,
        data: quote.execution.callData,
      });
      if (decoded.functionName !== "transfer" || !decoded.args) return false;
      const [boardroom, amount] = decoded.args;
      if (
        !sameAddress(quote.execution.target, quote.canonicalTarget) ||
        !sameAddress(quote.execution.inputToken, quote.canonicalTarget) ||
        !sameAddress(quote.execution.outputToken, quote.canonicalTarget) ||
        !sameAddress(boardroom, quote.boardroom) ||
        BigInt(amount) !== BigInt(quote.execution.inputAmount) ||
        quote.execution.inputAmount !== quote.execution.expectedOutput ||
        quote.execution.inputAmount !== quote.execution.minimumOutput
      ) {
        return false;
      }
      return (
        encodeFunctionData({
          abi: erc20Abi,
          functionName: decoded.functionName,
          args: decoded.args,
        }).toLowerCase() === quote.execution.callData.toLowerCase()
      );
    }

    const decoded = decodeFunctionData({
      abi: fixedPriceSaleAbi,
      data: quote.execution.callData,
    });
    if (decoded.functionName !== "buy" || !decoded.args) return false;
    const [shareAmount, maxRecipient, maxPayment, deadline] = decoded.args;
    if (
      BigInt(shareAmount) !== BigInt(quote.execution.minimumOutput) ||
      !sameAddress(maxRecipient, quote.execution.recipient) ||
      BigInt(maxPayment) < BigInt(quote.execution.inputAmount) ||
      Number(deadline) !== quote.execution.deadline
    ) {
      return false;
    }
    return (
      encodeFunctionData({
        abi: fixedPriceSaleAbi,
        functionName: decoded.functionName,
        args: decoded.args,
      }).toLowerCase() === quote.execution.callData.toLowerCase()
    );
  } catch {
    return false;
  }
}

async function currentSlippageBps(
  client: PublicClient,
  quote: MarketplaceQuote,
): Promise<number> {
  if (quote.kind !== "amm_swap") return 0;
  const decoded = decodeFunctionData({
    abi: ammRouterAbi,
    data: quote.execution.callData,
  });
  if (
    decoded.functionName !== "swapExactTokensForTokens" ||
    !decoded.args
  ) {
    throw new Error("Invalid AMM call data");
  }
  const [amountIn, , path] = decoded.args;
  const amounts = await client.readContract({
    address: quote.execution.target,
    abi: ammRouterAbi,
    functionName: "getAmountsOut",
    args: [amountIn, path],
  });
  const current = amounts.at(-1) ?? 0n;
  const expected = BigInt(quote.execution.expectedOutput);
  if (expected <= 0n || current >= expected) return 0;
  const loss = expected - current;
  return Number((loss * 10_000n + expected - 1n) / expected);
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
