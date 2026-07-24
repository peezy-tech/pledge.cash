import {
  ammFactoryAbi,
  ammRouterAbi,
  boardroomAbi,
  buildAmmSwapExactTokensForTokensTransaction,
  buildFixedPriceSaleBuyTransaction,
  distributionFactoryAbi,
  erc20Abi,
  fixedPriceSaleAbi,
} from "@pledge.cash/sdk";
import {
  encodeFunctionData,
  getAddress,
  keccak256,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import type { CreateQuoteRequest } from "../api/dto";
import { QuoteRequestError } from "../api/dto";
import type { DestinationExecution, MarketplaceQuote } from "../domain";
import { minimumWithSlippage, maximumWithSlippage } from "./math";

export type CanonicalMarketplaceDeployment = {
  chainId: 998;
  ammFactory: Address;
  ammRouter: Address;
  distributionFactory: Address;
  destinationUsdc: Address;
  executor: Address;
};

export type CanonicalQuoteResult = {
  boardroom: Address;
  canonicalTarget: Address;
  canonicalPool?: Address;
  destinationPrincipal: bigint;
  availableInventory: bigint;
  allowance: bigint;
  spender: Address;
  execution: DestinationExecution;
};

export interface CanonicalExecutionValidator {
  assertCanonicalExecution(quote: MarketplaceQuote): Promise<void>;
}

export class CanonicalMarketplaceReader {
  constructor(
    private readonly client: PublicClient,
    readonly deployment: CanonicalMarketplaceDeployment,
  ) {}

  async assertReady(): Promise<void> {
    const actualChainId = await this.client.getChainId();
    if (actualChainId !== this.deployment.chainId) {
      throw new CanonicalRouteError(
        `HyperEVM RPC returned chain ${actualChainId}; expected ${this.deployment.chainId}.`,
        "wrong_destination_chain",
        503,
      );
    }

    const addresses = [
      this.deployment.ammFactory,
      this.deployment.ammRouter,
      this.deployment.distributionFactory,
      this.deployment.destinationUsdc,
    ];
    const code = await Promise.all(addresses.map(address => this.client.getCode({ address })));
    if (code.some(value => !value || value === "0x")) {
      throw new CanonicalRouteError(
        "The configured HyperEVM deployment is missing required contract code.",
        "deployment_not_ready",
        503,
      );
    }

    const configuredRouter = await this.client.readContract({
      address: this.deployment.ammFactory,
      abi: ammFactoryAbi,
      functionName: "liquidityRouter",
    });
    if (!sameAddress(configuredRouter, this.deployment.ammRouter)) {
      throw new CanonicalRouteError(
        "The configured AMM router is not the factory's active liquidity router.",
        "noncanonical_amm_router",
        503,
      );
    }
  }

  async quote(
    request: CreateQuoteRequest,
    deadline: number,
  ): Promise<CanonicalQuoteResult> {
    if (request.kind === "amm_swap") {
      return this.quoteAmm(request, deadline);
    }
    return this.quoteFixedPrice(request, deadline);
  }

  /**
   * Revalidates every live relationship that made a stored quote canonical.
   * This runs after source payment settlement and immediately before the
   * destination simulation, so a factory, boardroom, pool, or sale change can
   * only fail closed into the refund path.
   */
  async assertCanonicalExecution(quote: MarketplaceQuote): Promise<void> {
    await this.assertReady();
    if (quote.kind === "amm_swap") {
      await this.assertCanonicalAmmExecution(quote);
      return;
    }
    await this.assertCanonicalFixedPriceExecution(quote);
  }

  private async assertCanonicalAmmExecution(
    quote: MarketplaceQuote,
  ): Promise<void> {
    const pool = quote.canonicalPool;
    if (
      pool === undefined ||
      !sameAddress(quote.canonicalTarget, this.deployment.ammRouter) ||
      !sameAddress(quote.execution.target, this.deployment.ammRouter) ||
      !sameAddress(quote.execution.inputToken, this.deployment.destinationUsdc)
    ) {
      throw new CanonicalRouteError(
        "The stored AMM execution no longer identifies the configured canonical route.",
        "noncanonical_pool",
      );
    }

    const [
      isPool,
      registeredPool,
      configuredRouter,
      boardroomShareToken,
      boardroomStatus,
    ] = await Promise.all([
      this.client.readContract({
        address: this.deployment.ammFactory,
        abi: ammFactoryAbi,
        functionName: "isPool",
        args: [pool],
      }),
      this.client.readContract({
        address: this.deployment.ammFactory,
        abi: ammFactoryAbi,
        functionName: "getPool",
        args: [quote.execution.inputToken, quote.execution.outputToken],
      }),
      this.client.readContract({
        address: this.deployment.ammFactory,
        abi: ammFactoryAbi,
        functionName: "liquidityRouter",
      }),
      this.client.readContract({
        address: quote.boardroom,
        abi: boardroomAbi,
        functionName: "shareToken",
      }),
      this.client.readContract({
        address: quote.boardroom,
        abi: boardroomAbi,
        functionName: "status",
      }),
    ]);

    if (
      !isPool ||
      !sameAddress(registeredPool, pool) ||
      !sameAddress(configuredRouter, this.deployment.ammRouter) ||
      !sameAddress(boardroomShareToken, quote.execution.outputToken) ||
      Number(boardroomStatus) !== 0
    ) {
      throw new CanonicalRouteError(
        "The live AMM factory, pool, router, or boardroom relationship changed after quoting.",
        "noncanonical_pool",
      );
    }
  }

  private async assertCanonicalFixedPriceExecution(
    quote: MarketplaceQuote,
  ): Promise<void> {
    const sale = quote.canonicalTarget;
    if (!sameAddress(quote.execution.target, sale)) {
      throw new CanonicalRouteError(
        "The stored fixed-price execution target no longer matches its canonical sale.",
        "noncanonical_fixed_price_sale",
      );
    }

    const [
      isDistribution,
      distributionKind,
      distributionBoardroom,
      factory,
      saleBoardroom,
      shareToken,
      paymentToken,
      maxPerBuyer,
      remainingShares,
      saleStatus,
      startTime,
      endTime,
      boardroomShareToken,
      boardroomStatus,
      paymentAmount,
    ] = await Promise.all([
      this.client.readContract({
        address: this.deployment.distributionFactory,
        abi: distributionFactoryAbi,
        functionName: "isDistribution",
        args: [sale],
      }),
      this.client.readContract({
        address: this.deployment.distributionFactory,
        abi: distributionFactoryAbi,
        functionName: "distributionKind",
        args: [sale],
      }),
      this.client.readContract({
        address: this.deployment.distributionFactory,
        abi: distributionFactoryAbi,
        functionName: "distributionBoardroom",
        args: [sale],
      }),
      this.client.readContract({
        address: sale,
        abi: fixedPriceSaleAbi,
        functionName: "factory",
      }),
      this.client.readContract({
        address: sale,
        abi: fixedPriceSaleAbi,
        functionName: "boardroom",
      }),
      this.client.readContract({
        address: sale,
        abi: fixedPriceSaleAbi,
        functionName: "shareToken",
      }),
      this.client.readContract({
        address: sale,
        abi: fixedPriceSaleAbi,
        functionName: "paymentToken",
      }),
      this.client.readContract({
        address: sale,
        abi: fixedPriceSaleAbi,
        functionName: "maxPerBuyer",
      }),
      this.client.readContract({
        address: sale,
        abi: fixedPriceSaleAbi,
        functionName: "remainingShares",
      }),
      this.client.readContract({
        address: sale,
        abi: fixedPriceSaleAbi,
        functionName: "saleStatus",
      }),
      this.client.readContract({
        address: sale,
        abi: fixedPriceSaleAbi,
        functionName: "startTime",
      }),
      this.client.readContract({
        address: sale,
        abi: fixedPriceSaleAbi,
        functionName: "endTime",
      }),
      this.client.readContract({
        address: quote.boardroom,
        abi: boardroomAbi,
        functionName: "shareToken",
      }),
      this.client.readContract({
        address: quote.boardroom,
        abi: boardroomAbi,
        functionName: "status",
      }),
      this.client.readContract({
        address: sale,
        abi: fixedPriceSaleAbi,
        functionName: "getPaymentAmount",
        args: [BigInt(quote.execution.minimumOutput)],
      }),
    ]);

    const now = BigInt(Math.floor(Date.now() / 1_000));
    const notStarted = BigInt(startTime) > now;
    const ended = BigInt(endTime) !== 0n && BigInt(endTime) < now;
    if (
      !isDistribution ||
      Number(distributionKind) !== 0 ||
      !sameAddress(distributionBoardroom, quote.boardroom) ||
      !sameAddress(factory, this.deployment.distributionFactory) ||
      !sameAddress(saleBoardroom, quote.boardroom) ||
      !sameAddress(shareToken, quote.execution.outputToken) ||
      !sameAddress(boardroomShareToken, quote.execution.outputToken) ||
      !sameAddress(paymentToken, this.deployment.destinationUsdc) ||
      !sameAddress(quote.execution.inputToken, this.deployment.destinationUsdc) ||
      BigInt(maxPerBuyer) !== 0n ||
      BigInt(remainingShares) < BigInt(quote.execution.minimumOutput) ||
      BigInt(paymentAmount) !== BigInt(quote.execution.inputAmount) ||
      Number(saleStatus) !== 0 ||
      Number(boardroomStatus) !== 0 ||
      notStarted ||
      ended
    ) {
      throw new CanonicalRouteError(
        "The live fixed-price factory, sale, or boardroom relationship changed after quoting.",
        "fixed_price_configuration_mismatch",
      );
    }
  }

  private async quoteAmm(
    request: Extract<CreateQuoteRequest, { kind: "amm_swap" }>,
    deadline: number,
  ): Promise<CanonicalQuoteResult> {
    if (!sameAddress(request.tokenIn, this.deployment.destinationUsdc)) {
      throw new CanonicalRouteError(
        "V1 AMM payments require configured HyperEVM USDC as tokenIn.",
        "unsupported_input_asset",
      );
    }
    if (sameAddress(request.tokenIn, request.tokenOut)) {
      throw new CanonicalRouteError("AMM input and output assets must differ.", "invalid_pair");
    }

    const [isPool, registeredPool, boardroomShareToken, boardroomStatus] =
      await Promise.all([
        this.client.readContract({
          address: this.deployment.ammFactory,
          abi: ammFactoryAbi,
          functionName: "isPool",
          args: [request.pool],
        }),
        this.client.readContract({
          address: this.deployment.ammFactory,
          abi: ammFactoryAbi,
          functionName: "getPool",
          args: [request.tokenIn, request.tokenOut],
        }),
        this.client.readContract({
          address: request.boardroom,
          abi: boardroomAbi,
          functionName: "shareToken",
        }),
        this.client.readContract({
          address: request.boardroom,
          abi: boardroomAbi,
          functionName: "status",
        }),
      ]);

    if (
      !isPool ||
      !sameAddress(registeredPool, request.pool) ||
      !sameAddress(boardroomShareToken, request.tokenOut)
    ) {
      throw new CanonicalRouteError(
        "The requested AMM route is not the canonical USDC/project-token pool.",
        "noncanonical_pool",
      );
    }
    if (Number(boardroomStatus) !== 0) {
      throw new CanonicalRouteError(
        "The project boardroom is not active.",
        "boardroom_not_active",
      );
    }

    const amountIn = BigInt(request.amountIn);
    const amounts = await this.client.readContract({
      address: this.deployment.ammRouter,
      abi: ammRouterAbi,
      functionName: "getAmountsOut",
      args: [amountIn, [request.tokenIn, request.tokenOut]],
    });
    const expectedOutput = amounts.at(-1);
    if (!expectedOutput || expectedOutput <= 0n) {
      throw new CanonicalRouteError("The AMM returned no executable output.", "empty_amm_quote");
    }
    const minimumOutput = minimumWithSlippage(
      expectedOutput,
      request.maxSlippageBps,
    );
    if (minimumOutput <= 0n) {
      throw new CanonicalRouteError("The minimum AMM output is zero.", "empty_amm_minimum");
    }

    const transaction = buildAmmSwapExactTokensForTokensTransaction({
      router: this.deployment.ammRouter,
      amountIn,
      amountOutMin: minimumOutput,
      path: [request.tokenIn, request.tokenOut],
      recipient: request.recipient,
      deadline: BigInt(deadline),
    });
    const callData = encodeFunctionData(transaction);
    const [availableInventory, allowance] = await this.readInventory(
      request.tokenIn,
      this.deployment.ammRouter,
    );

    return {
      boardroom: request.boardroom,
      canonicalTarget: this.deployment.ammRouter,
      canonicalPool: request.pool,
      destinationPrincipal: amountIn,
      availableInventory,
      allowance,
      spender: this.deployment.ammRouter,
      execution: executionEnvelope({
        callData,
        deadline,
        expectedOutput,
        inputAmount: amountIn,
        inputToken: request.tokenIn,
        outputToken: request.tokenOut,
        recipient: request.recipient,
        target: this.deployment.ammRouter,
        minimumOutput,
      }),
    };
  }

  private async quoteFixedPrice(
    request: Extract<CreateQuoteRequest, { kind: "fixed_price_sale" }>,
    deadline: number,
  ): Promise<CanonicalQuoteResult> {
    const [isDistribution, distributionKind, distributionBoardroom] =
      await Promise.all([
        this.client.readContract({
          address: this.deployment.distributionFactory,
          abi: distributionFactoryAbi,
          functionName: "isDistribution",
          args: [request.sale],
        }),
        this.client.readContract({
          address: this.deployment.distributionFactory,
          abi: distributionFactoryAbi,
          functionName: "distributionKind",
          args: [request.sale],
        }),
        this.client.readContract({
          address: this.deployment.distributionFactory,
          abi: distributionFactoryAbi,
          functionName: "distributionBoardroom",
          args: [request.sale],
        }),
      ]);
    if (
      !isDistribution ||
      Number(distributionKind) !== 0 ||
      !sameAddress(distributionBoardroom, request.boardroom)
    ) {
      throw new CanonicalRouteError(
        "The requested contract is not a canonical fixed-price sale for this project.",
        "noncanonical_fixed_price_sale",
      );
    }

    const [
      factory,
      saleBoardroom,
      shareToken,
      paymentToken,
      maxPerBuyer,
      remainingShares,
      saleStatus,
      startTime,
      endTime,
      boardroomShareToken,
      boardroomStatus,
      paymentAmount,
    ] = await Promise.all([
      this.client.readContract({
        address: request.sale,
        abi: fixedPriceSaleAbi,
        functionName: "factory",
      }),
      this.client.readContract({
        address: request.sale,
        abi: fixedPriceSaleAbi,
        functionName: "boardroom",
      }),
      this.client.readContract({
        address: request.sale,
        abi: fixedPriceSaleAbi,
        functionName: "shareToken",
      }),
      this.client.readContract({
        address: request.sale,
        abi: fixedPriceSaleAbi,
        functionName: "paymentToken",
      }),
      this.client.readContract({
        address: request.sale,
        abi: fixedPriceSaleAbi,
        functionName: "maxPerBuyer",
      }),
      this.client.readContract({
        address: request.sale,
        abi: fixedPriceSaleAbi,
        functionName: "remainingShares",
      }),
      this.client.readContract({
        address: request.sale,
        abi: fixedPriceSaleAbi,
        functionName: "saleStatus",
      }),
      this.client.readContract({
        address: request.sale,
        abi: fixedPriceSaleAbi,
        functionName: "startTime",
      }),
      this.client.readContract({
        address: request.sale,
        abi: fixedPriceSaleAbi,
        functionName: "endTime",
      }),
      this.client.readContract({
        address: request.boardroom,
        abi: boardroomAbi,
        functionName: "shareToken",
      }),
      this.client.readContract({
        address: request.boardroom,
        abi: boardroomAbi,
        functionName: "status",
      }),
      this.client.readContract({
        address: request.sale,
        abi: fixedPriceSaleAbi,
        functionName: "getPaymentAmount",
        args: [BigInt(request.shareAmount)],
      }),
    ]);

    const now = Math.floor(Date.now() / 1_000);
    const notStarted = BigInt(startTime) > BigInt(now);
    const ended = BigInt(endTime) !== 0n && BigInt(endTime) < BigInt(now);
    if (
      !sameAddress(factory, this.deployment.distributionFactory) ||
      !sameAddress(saleBoardroom, request.boardroom) ||
      !sameAddress(shareToken, boardroomShareToken) ||
      !sameAddress(paymentToken, this.deployment.destinationUsdc)
    ) {
      throw new CanonicalRouteError(
        "The fixed-price sale's live configuration no longer matches the canonical route.",
        "fixed_price_configuration_mismatch",
      );
    }
    if (BigInt(maxPerBuyer) !== 0n) {
      throw new CanonicalRouteError(
        "Buyer-capped fixed-price sales are not supported by the brokered v1 rail.",
        "capped_sale_unsupported",
      );
    }
    if (
      Number(saleStatus) !== 0 ||
      Number(boardroomStatus) !== 0 ||
      notStarted ||
      ended
    ) {
      throw new CanonicalRouteError(
        "The fixed-price sale is not currently open.",
        "sale_not_open",
      );
    }

    const shareAmount = BigInt(request.shareAmount);
    if (shareAmount > BigInt(remainingShares)) {
      throw new CanonicalRouteError(
        "The requested project-token amount exceeds the remaining sale supply.",
        "insufficient_sale_supply",
      );
    }
    if (BigInt(paymentAmount) <= 0n) {
      throw new CanonicalRouteError("The sale returned an empty payment amount.", "empty_sale_quote");
    }

    const maxPayment = maximumWithSlippage(
      BigInt(paymentAmount),
      request.maxSlippageBps,
    );
    const transaction = buildFixedPriceSaleBuyTransaction({
      sale: request.sale,
      shareAmount,
      recipient: request.recipient,
      maxPayment,
      deadline: BigInt(deadline),
    });
    const callData = encodeFunctionData(transaction);
    const [availableInventory, allowance] = await this.readInventory(
      this.deployment.destinationUsdc,
      request.sale,
    );

    return {
      boardroom: request.boardroom,
      canonicalTarget: request.sale,
      destinationPrincipal: BigInt(paymentAmount),
      availableInventory,
      allowance,
      spender: request.sale,
      execution: executionEnvelope({
        callData,
        deadline,
        expectedOutput: shareAmount,
        inputAmount: BigInt(paymentAmount),
        inputToken: this.deployment.destinationUsdc,
        outputToken: getAddress(shareToken),
        recipient: request.recipient,
        target: request.sale,
        minimumOutput: shareAmount,
      }),
    };
  }

  private async readInventory(
    token: Address,
    spender: Address,
  ): Promise<readonly [bigint, bigint]> {
    return Promise.all([
      this.client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [this.deployment.executor],
      }),
      this.client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "allowance",
        args: [this.deployment.executor, spender],
      }),
    ]);
  }
}

function executionEnvelope(input: {
  callData: Hex;
  deadline: number;
  expectedOutput: bigint;
  inputAmount: bigint;
  inputToken: Address;
  minimumOutput: bigint;
  outputToken: Address;
  recipient: Address;
  target: Address;
}): DestinationExecution {
  return {
    chainId: 998,
    target: getAddress(input.target),
    callData: input.callData,
    callDataHash: keccak256(input.callData),
    selector: input.callData.slice(0, 10) as Hex,
    value: "0",
    recipient: getAddress(input.recipient),
    inputToken: getAddress(input.inputToken),
    inputAmount: input.inputAmount.toString(),
    outputToken: getAddress(input.outputToken),
    expectedOutput: input.expectedOutput.toString(),
    minimumOutput: input.minimumOutput.toString(),
    deadline: input.deadline,
  };
}

function sameAddress(
  left: Address | string,
  right: Address | string,
): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export class CanonicalRouteError extends QuoteRequestError {
  constructor(message: string, code: string, status = 422) {
    super(message, code, status);
    this.name = "CanonicalRouteError";
  }
}
