import {
  ammFactoryAbi,
  ammRouterAbi,
  boardroomAbi,
  boardroomFactoryAbi,
  buildAmmSwapExactTokensForTokensTransaction,
  buildFixedPriceSaleBuyTransaction,
  distributionFactoryAbi,
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
import type { RouterQuoteRequest } from "../api/dto";
import { QuoteRequestError } from "../api/dto";
import type { DestinationExecution, MarketplaceQuote } from "../domain";
import {
  FacetReleaseProofError,
  proveLiveFacetRelease,
  requireSameBlock,
  type CanonicalProtocolRoots,
  type PinnedFacetRelease,
} from "../release";
import { minimumWithSlippage, maximumWithSlippage } from "./math";

export type CanonicalMarketplaceDeployment = CanonicalProtocolRoots & {
  destinationUsdc: Address;
  executor: Address;
};

export type CanonicalQuoteResult = {
  boardroom: Address;
  canonicalTarget: Address;
  canonicalPool?: Address;
  facetSetHash: Hex;
  destinationPrincipal: bigint;
  availableInventory: bigint;
  allowance?: bigint;
  spender?: Address;
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
    await this.liveRelease();
  }

  private async liveRelease(): Promise<PinnedFacetRelease> {
    try {
      const release = await proveLiveFacetRelease(this.client, this.deployment);
      const destinationAssetCode = await this.client.getCode({
        address: this.deployment.destinationUsdc,
        blockNumber: release.blockNumber,
      });
      if (!destinationAssetCode || destinationAssetCode === "0x") {
        throw new FacetReleaseProofError("destination_asset_unavailable");
      }
      await requireSameBlock(this.client, release);
      return release;
    } catch (error) {
      throw new CanonicalRouteError(
        error instanceof FacetReleaseProofError
          ? `The active Boardroom facet release failed canonical proof: ${error.failure}.`
          : "The active Boardroom facet release could not be proven.",
        "noncanonical_boardroom_release",
        503,
      );
    }
  }

  async quote(
    request: RouterQuoteRequest,
    deadline: number,
  ): Promise<CanonicalQuoteResult> {
    const release = await this.liveRelease();
    if (request.kind === "amm_swap") {
      return this.quoteAmm(request, deadline, release);
    }
    if (request.kind === "fixed_price_sale") {
      return this.quoteFixedPrice(request, deadline, release);
    }
    return this.quoteRecurringSupport(request, deadline, release);
  }

  /**
   * Revalidates every live relationship that made a stored quote canonical.
   * This runs after source payment settlement and immediately before the
   * destination simulation, so a factory, boardroom, pool, or sale change can
   * only fail closed into the refund path.
   */
  async assertCanonicalExecution(quote: MarketplaceQuote): Promise<void> {
    const release = await this.liveRelease();
    if (
      quote.facetSetHash === undefined ||
      quote.facetSetHash.toLowerCase() !== release.facetSetHash.toLowerCase()
    ) {
      throw new CanonicalRouteError(
        "The stored execution was prepared for a different Boardroom facet release.",
        "stale_boardroom_release",
        409,
      );
    }
    if (quote.kind === "amm_swap") {
      await this.assertCanonicalAmmExecution(quote, release);
      return;
    }
    if (quote.kind === "fixed_price_sale") {
      await this.assertCanonicalFixedPriceExecution(quote, release);
      return;
    }
    await this.assertCanonicalRecurringSupportExecution(quote, release);
  }

  private async assertCanonicalRecurringSupportExecution(
    quote: MarketplaceQuote,
    release: PinnedFacetRelease,
  ): Promise<void> {
    if (
      quote.supportInvoiceId === undefined ||
      quote.facetSetHash === undefined ||
      !sameAddress(quote.canonicalTarget, quote.boardroom) ||
      !sameAddress(quote.execution.target, quote.boardroom) ||
      !sameAddress(quote.execution.inputToken, this.deployment.destinationUsdc) ||
      !sameAddress(quote.execution.outputToken, this.deployment.destinationUsdc) ||
      quote.execution.inputAmount !== quote.execution.expectedOutput ||
      quote.execution.inputAmount !== quote.execution.minimumOutput
    ) {
      throw new CanonicalRouteError(
        "The stored support execution no longer identifies the configured USDC contribution route.",
        "noncanonical_support_route",
      );
    }

    let decoded;
    try {
      decoded = decodeFunctionData({
        abi: boardroomAbi,
        data: quote.execution.callData,
      });
    } catch {
      throw new CanonicalRouteError(
        "The stored support execution calldata is invalid.",
        "noncanonical_support_route",
      );
    }
    if (
      decoded.functionName !== "contributeTreasuryAsset"
      || !decoded.args
    ) {
      throw new CanonicalRouteError(
        "The stored support execution calldata is not a Boardroom contribution.",
        "noncanonical_support_route",
      );
    }
    const [expectedFacetSetHash, asset, amount, deadline] = decoded.args;
    if (
      !sameAddress(asset, quote.execution.inputToken)
      || BigInt(amount) !== BigInt(quote.execution.inputAmount)
      || Number(deadline) !== quote.execution.deadline
    ) {
      throw new CanonicalRouteError(
        "The stored support execution calldata no longer matches the quote.",
        "noncanonical_support_route",
      );
    }

    const block = {
      number: release.blockNumber,
      hash: release.blockHash,
    };
    const [
      isBoardroom,
      boardroomStatus,
      isRedeemableAsset,
      currentFacetSetHash,
      migrationRequired,
    ] =
      await Promise.all([
        this.client.readContract({
          address: this.deployment.boardroomFactory,
          abi: boardroomFactoryAbi,
          functionName: "isBoardroom",
          args: [quote.boardroom],
          blockNumber: block.number,
        }),
        this.client.readContract({
          address: quote.boardroom,
          abi: boardroomAbi,
          functionName: "status",
          blockNumber: block.number,
        }),
        this.client.readContract({
          address: quote.boardroom,
          abi: boardroomAbi,
          functionName: "isRedeemableAsset",
          args: [this.deployment.destinationUsdc],
          blockNumber: block.number,
        }),
        this.client.readContract({
          address: quote.boardroom,
          abi: boardroomAbi,
          functionName: "facetSetHash",
          blockNumber: block.number,
        }),
        this.client.readContract({
          address: quote.boardroom,
          abi: boardroomAbi,
          functionName: "migrationRequired",
          blockNumber: block.number,
        }),
      ]);
    const confirmedBlock = await this.client.getBlock({
      blockNumber: block.number,
    });

    if (
      !isBoardroom ||
      Number(boardroomStatus) !== 0 ||
      !isRedeemableAsset ||
      migrationRequired ||
      currentFacetSetHash.toLowerCase()
        !== expectedFacetSetHash.toLowerCase() ||
      currentFacetSetHash.toLowerCase() !== release.facetSetHash.toLowerCase() ||
      quote.facetSetHash.toLowerCase()
        !== expectedFacetSetHash.toLowerCase() ||
      confirmedBlock.hash === null ||
      confirmedBlock.hash.toLowerCase() !== block.hash.toLowerCase()
    ) {
      throw new CanonicalRouteError(
        "The support plan's Boardroom, facet release, or treasury asset is no longer eligible to receive renewals.",
        "support_route_unavailable",
      );
    }
  }

  private async assertCanonicalAmmExecution(
    quote: MarketplaceQuote,
    release: PinnedFacetRelease,
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
      isBoardroom,
      isPool,
      registeredPool,
      configuredRouter,
      boardroomShareToken,
      boardroomStatus,
      boardroomFacetSetHash,
      migrationRequired,
    ] = await Promise.all([
      this.client.readContract({ address: this.deployment.boardroomFactory, abi: boardroomFactoryAbi, functionName: "isBoardroom", args: [quote.boardroom], blockNumber: release.blockNumber }),
      this.client.readContract({
        address: this.deployment.ammFactory,
        abi: ammFactoryAbi,
        functionName: "isPool",
        args: [pool],
        blockNumber: release.blockNumber,
      }),
      this.client.readContract({
        address: this.deployment.ammFactory,
        abi: ammFactoryAbi,
        functionName: "getPool",
        args: [quote.execution.inputToken, quote.execution.outputToken],
        blockNumber: release.blockNumber,
      }),
      this.client.readContract({
        address: this.deployment.ammFactory,
        abi: ammFactoryAbi,
        functionName: "liquidityRouter",
        blockNumber: release.blockNumber,
      }),
      this.client.readContract({
        address: quote.boardroom,
        abi: boardroomAbi,
        functionName: "shareToken",
        blockNumber: release.blockNumber,
      }),
      this.client.readContract({
        address: quote.boardroom,
        abi: boardroomAbi,
        functionName: "status",
        blockNumber: release.blockNumber,
      }),
      this.client.readContract({
        address: quote.boardroom,
        abi: boardroomAbi,
        functionName: "facetSetHash",
        blockNumber: release.blockNumber,
      }),
      this.client.readContract({
        address: quote.boardroom,
        abi: boardroomAbi,
        functionName: "migrationRequired",
        blockNumber: release.blockNumber,
      }),
    ]);

    if (
      !isBoardroom || !isPool ||
      !sameAddress(registeredPool, pool) ||
      !sameAddress(configuredRouter, this.deployment.ammRouter) ||
      !sameAddress(boardroomShareToken, quote.execution.outputToken) ||
      Number(boardroomStatus) !== 0 ||
      migrationRequired ||
      boardroomFacetSetHash.toLowerCase() !== release.facetSetHash.toLowerCase()
    ) {
      throw new CanonicalRouteError(
        "The live AMM factory, pool, router, or boardroom relationship changed after quoting.",
        "noncanonical_pool",
      );
    }
    await requireSameBlock(this.client, release);
  }

  private async assertCanonicalFixedPriceExecution(
    quote: MarketplaceQuote,
    release: PinnedFacetRelease,
  ): Promise<void> {
    const sale = quote.canonicalTarget;
    if (!sameAddress(quote.execution.target, sale)) {
      throw new CanonicalRouteError(
        "The stored fixed-price execution target no longer matches its canonical sale.",
        "noncanonical_fixed_price_sale",
      );
    }

    const [
      isBoardroom,
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
      boardroomFacetSetHash,
      migrationRequired,
      paymentAmount,
      latestBlock,
    ] = await Promise.all([
      this.client.readContract({ address: this.deployment.boardroomFactory, abi: boardroomFactoryAbi, functionName: "isBoardroom", args: [quote.boardroom], blockNumber: release.blockNumber }),
      this.client.readContract({
        address: this.deployment.distributionFactory,
        abi: distributionFactoryAbi,
        functionName: "isDistribution",
        args: [sale],
        blockNumber: release.blockNumber,
      }),
      this.client.readContract({
        address: this.deployment.distributionFactory,
        abi: distributionFactoryAbi,
        functionName: "distributionKind",
        args: [sale],
        blockNumber: release.blockNumber,
      }),
      this.client.readContract({
        address: this.deployment.distributionFactory,
        abi: distributionFactoryAbi,
        functionName: "distributionBoardroom",
        args: [sale],
        blockNumber: release.blockNumber,
      }),
      this.client.readContract({
        address: sale,
        abi: fixedPriceSaleAbi,
        functionName: "factory",
        blockNumber: release.blockNumber,
      }),
      this.client.readContract({
        address: sale,
        abi: fixedPriceSaleAbi,
        functionName: "boardroom",
        blockNumber: release.blockNumber,
      }),
      this.client.readContract({
        address: sale,
        abi: fixedPriceSaleAbi,
        functionName: "shareToken",
        blockNumber: release.blockNumber,
      }),
      this.client.readContract({
        address: sale,
        abi: fixedPriceSaleAbi,
        functionName: "paymentToken",
        blockNumber: release.blockNumber,
      }),
      this.client.readContract({
        address: sale,
        abi: fixedPriceSaleAbi,
        functionName: "maxPerBuyer",
        blockNumber: release.blockNumber,
      }),
      this.client.readContract({
        address: sale,
        abi: fixedPriceSaleAbi,
        functionName: "remainingShares",
        blockNumber: release.blockNumber,
      }),
      this.client.readContract({
        address: sale,
        abi: fixedPriceSaleAbi,
        functionName: "saleStatus",
        blockNumber: release.blockNumber,
      }),
      this.client.readContract({
        address: sale,
        abi: fixedPriceSaleAbi,
        functionName: "startTime",
        blockNumber: release.blockNumber,
      }),
      this.client.readContract({
        address: sale,
        abi: fixedPriceSaleAbi,
        functionName: "endTime",
        blockNumber: release.blockNumber,
      }),
      this.client.readContract({
        address: quote.boardroom,
        abi: boardroomAbi,
        functionName: "shareToken",
        blockNumber: release.blockNumber,
      }),
      this.client.readContract({
        address: quote.boardroom,
        abi: boardroomAbi,
        functionName: "status",
        blockNumber: release.blockNumber,
      }),
      this.client.readContract({
        address: quote.boardroom,
        abi: boardroomAbi,
        functionName: "facetSetHash",
        blockNumber: release.blockNumber,
      }),
      this.client.readContract({
        address: quote.boardroom,
        abi: boardroomAbi,
        functionName: "migrationRequired",
        blockNumber: release.blockNumber,
      }),
      this.client.readContract({
        address: sale,
        abi: fixedPriceSaleAbi,
        functionName: "getPaymentAmount",
        args: [BigInt(quote.execution.minimumOutput)],
        blockNumber: release.blockNumber,
      }),
      this.client.getBlock({ blockNumber: release.blockNumber }),
    ]);

    const notStarted = BigInt(startTime) > latestBlock.timestamp;
    const ended =
      BigInt(endTime) !== 0n && BigInt(endTime) < latestBlock.timestamp;
    if (
      !isBoardroom || !isDistribution ||
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
      migrationRequired ||
      boardroomFacetSetHash.toLowerCase() !== release.facetSetHash.toLowerCase() ||
      notStarted ||
      ended
    ) {
      throw new CanonicalRouteError(
        "The live fixed-price factory, sale, or boardroom relationship changed after quoting.",
        "fixed_price_configuration_mismatch",
      );
    }
    await requireSameBlock(this.client, release);
  }

  private async quoteAmm(
    request: Extract<RouterQuoteRequest, { kind: "amm_swap" }>,
    deadline: number,
    release: PinnedFacetRelease,
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

    const [
      isBoardroom,
      isPool,
      registeredPool,
      boardroomShareToken,
      boardroomStatus,
      boardroomFacetSetHash,
      migrationRequired,
    ] =
      await Promise.all([
        this.client.readContract({ address: this.deployment.boardroomFactory, abi: boardroomFactoryAbi, functionName: "isBoardroom", args: [request.boardroom], blockNumber: release.blockNumber }),
        this.client.readContract({
          address: this.deployment.ammFactory,
          abi: ammFactoryAbi,
          functionName: "isPool",
          args: [request.pool],
          blockNumber: release.blockNumber,
        }),
        this.client.readContract({
          address: this.deployment.ammFactory,
          abi: ammFactoryAbi,
          functionName: "getPool",
          args: [request.tokenIn, request.tokenOut],
          blockNumber: release.blockNumber,
        }),
        this.client.readContract({
          address: request.boardroom,
          abi: boardroomAbi,
          functionName: "shareToken",
          blockNumber: release.blockNumber,
        }),
        this.client.readContract({
          address: request.boardroom,
          abi: boardroomAbi,
          functionName: "status",
          blockNumber: release.blockNumber,
        }),
        this.client.readContract({
          address: request.boardroom,
          abi: boardroomAbi,
          functionName: "facetSetHash",
          blockNumber: release.blockNumber,
        }),
        this.client.readContract({
          address: request.boardroom,
          abi: boardroomAbi,
          functionName: "migrationRequired",
          blockNumber: release.blockNumber,
        }),
      ]);

    if (
      !isBoardroom || !isPool ||
      !sameAddress(registeredPool, request.pool) ||
      !sameAddress(boardroomShareToken, request.tokenOut) ||
      boardroomFacetSetHash.toLowerCase() !== release.facetSetHash.toLowerCase()
    ) {
      throw new CanonicalRouteError(
        "The requested AMM route is not the canonical USDC/project-token pool.",
        "noncanonical_pool",
      );
    }
    if (migrationRequired) {
      throw new CanonicalRouteError(
        "The project Boardroom requires migration before a route can be quoted.",
        "boardroom_migration_required",
        409,
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
      blockNumber: release.blockNumber,
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
      release.blockNumber,
    );
    await requireSameBlock(this.client, release);

    return {
      boardroom: request.boardroom,
      canonicalTarget: this.deployment.ammRouter,
      canonicalPool: request.pool,
      facetSetHash: release.facetSetHash,
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
    request: Extract<RouterQuoteRequest, { kind: "fixed_price_sale" }>,
    deadline: number,
    release: PinnedFacetRelease,
  ): Promise<CanonicalQuoteResult> {
    const [isBoardroom, isDistribution, distributionKind, distributionBoardroom] =
      await Promise.all([
        this.client.readContract({ address: this.deployment.boardroomFactory, abi: boardroomFactoryAbi, functionName: "isBoardroom", args: [request.boardroom], blockNumber: release.blockNumber }),
        this.client.readContract({
          address: this.deployment.distributionFactory,
          abi: distributionFactoryAbi,
          functionName: "isDistribution",
          args: [request.sale],
          blockNumber: release.blockNumber,
        }),
        this.client.readContract({
          address: this.deployment.distributionFactory,
          abi: distributionFactoryAbi,
          functionName: "distributionKind",
          args: [request.sale],
          blockNumber: release.blockNumber,
        }),
        this.client.readContract({
          address: this.deployment.distributionFactory,
          abi: distributionFactoryAbi,
          functionName: "distributionBoardroom",
          args: [request.sale],
          blockNumber: release.blockNumber,
        }),
      ]);
    if (
      !isBoardroom || !isDistribution ||
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
      boardroomFacetSetHash,
      migrationRequired,
      paymentAmount,
      latestBlock,
    ] = await Promise.all([
      this.client.readContract({
        address: request.sale,
        abi: fixedPriceSaleAbi,
        functionName: "factory",
        blockNumber: release.blockNumber,
      }),
      this.client.readContract({
        address: request.sale,
        abi: fixedPriceSaleAbi,
        functionName: "boardroom",
        blockNumber: release.blockNumber,
      }),
      this.client.readContract({
        address: request.sale,
        abi: fixedPriceSaleAbi,
        functionName: "shareToken",
        blockNumber: release.blockNumber,
      }),
      this.client.readContract({
        address: request.sale,
        abi: fixedPriceSaleAbi,
        functionName: "paymentToken",
        blockNumber: release.blockNumber,
      }),
      this.client.readContract({
        address: request.sale,
        abi: fixedPriceSaleAbi,
        functionName: "maxPerBuyer",
        blockNumber: release.blockNumber,
      }),
      this.client.readContract({
        address: request.sale,
        abi: fixedPriceSaleAbi,
        functionName: "remainingShares",
        blockNumber: release.blockNumber,
      }),
      this.client.readContract({
        address: request.sale,
        abi: fixedPriceSaleAbi,
        functionName: "saleStatus",
        blockNumber: release.blockNumber,
      }),
      this.client.readContract({
        address: request.sale,
        abi: fixedPriceSaleAbi,
        functionName: "startTime",
        blockNumber: release.blockNumber,
      }),
      this.client.readContract({
        address: request.sale,
        abi: fixedPriceSaleAbi,
        functionName: "endTime",
        blockNumber: release.blockNumber,
      }),
      this.client.readContract({
        address: request.boardroom,
        abi: boardroomAbi,
        functionName: "shareToken",
        blockNumber: release.blockNumber,
      }),
      this.client.readContract({
        address: request.boardroom,
        abi: boardroomAbi,
        functionName: "status",
        blockNumber: release.blockNumber,
      }),
      this.client.readContract({
        address: request.boardroom,
        abi: boardroomAbi,
        functionName: "facetSetHash",
        blockNumber: release.blockNumber,
      }),
      this.client.readContract({
        address: request.boardroom,
        abi: boardroomAbi,
        functionName: "migrationRequired",
        blockNumber: release.blockNumber,
      }),
      this.client.readContract({
        address: request.sale,
        abi: fixedPriceSaleAbi,
        functionName: "getPaymentAmount",
        args: [BigInt(request.shareAmount)],
        blockNumber: release.blockNumber,
      }),
      this.client.getBlock({ blockNumber: release.blockNumber }),
    ]);

    const notStarted = BigInt(startTime) > latestBlock.timestamp;
    const ended =
      BigInt(endTime) !== 0n && BigInt(endTime) < latestBlock.timestamp;
    if (
      !sameAddress(factory, this.deployment.distributionFactory) ||
      !sameAddress(saleBoardroom, request.boardroom) ||
      !sameAddress(shareToken, boardroomShareToken) ||
      !sameAddress(paymentToken, this.deployment.destinationUsdc)
      || boardroomFacetSetHash.toLowerCase() !== release.facetSetHash.toLowerCase()
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
      migrationRequired ||
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
      release.blockNumber,
    );
    await requireSameBlock(this.client, release);

    return {
      boardroom: request.boardroom,
      canonicalTarget: request.sale,
      facetSetHash: release.facetSetHash,
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

  private async quoteRecurringSupport(
    request: Extract<RouterQuoteRequest, { kind: "recurring_support" }>,
    deadline: number,
    release: PinnedFacetRelease,
  ): Promise<CanonicalQuoteResult> {
    const block = {
      number: release.blockNumber,
      hash: release.blockHash,
    };
    const [
      isBoardroom,
      boardroomStatus,
      isRedeemableAsset,
      facetSetHash,
      migrationRequired,
      [availableInventory, allowance],
    ] =
      await Promise.all([
        this.client.readContract({
          address: this.deployment.boardroomFactory,
          abi: boardroomFactoryAbi,
          functionName: "isBoardroom",
          args: [request.boardroom],
          blockNumber: block.number,
        }),
        this.client.readContract({
          address: request.boardroom,
          abi: boardroomAbi,
          functionName: "status",
          blockNumber: block.number,
        }),
        this.client.readContract({
          address: request.boardroom,
          abi: boardroomAbi,
          functionName: "isRedeemableAsset",
          args: [this.deployment.destinationUsdc],
          blockNumber: block.number,
        }),
        this.client.readContract({
          address: request.boardroom,
          abi: boardroomAbi,
          functionName: "facetSetHash",
          blockNumber: block.number,
        }),
        this.client.readContract({
          address: request.boardroom,
          abi: boardroomAbi,
          functionName: "migrationRequired",
          blockNumber: block.number,
        }),
        this.readInventory(
          this.deployment.destinationUsdc,
          request.boardroom,
          block.number,
        ),
      ]);
    const confirmedBlock = await this.client.getBlock({
      blockNumber: block.number,
    });
    if (
      confirmedBlock.hash === null
      || confirmedBlock.hash.toLowerCase() !== block.hash.toLowerCase()
    ) {
      throw new CanonicalRouteError(
        "The HyperEVM block changed while the support quote was constructed.",
        "support_reorg_uncertainty",
        503,
      );
    }
    if (!isBoardroom) {
      throw new CanonicalRouteError(
        "The support plan does not belong to a canonical Boardroom.",
        "noncanonical_boardroom",
      );
    }
    if (Number(boardroomStatus) !== 0) {
      throw new CanonicalRouteError(
        "The project Boardroom is not active.",
        "boardroom_not_active",
      );
    }
    if (!isRedeemableAsset) {
      throw new CanonicalRouteError(
        "Configured HyperEVM USDC is not registered as a Boardroom treasury asset.",
        "support_asset_not_registered",
      );
    }
    if (migrationRequired) {
      throw new CanonicalRouteError(
        "Recurring support is paused while the Boardroom requires migration.",
        "boardroom_migration_required",
        409,
      );
    }
    if (
      facetSetHash.toLowerCase()
      !== request.expectedFacetSetHash.toLowerCase() ||
      facetSetHash.toLowerCase() !== release.facetSetHash.toLowerCase()
    ) {
      throw new CanonicalRouteError(
        "The support plan was authorized for a different Boardroom facet release.",
        "support_facet_set_stale",
        409,
      );
    }

    const amount = BigInt(request.amount);
    const callData = encodeFunctionData({
      abi: boardroomAbi,
      functionName: "contributeTreasuryAsset",
      args: [
        request.expectedFacetSetHash,
        this.deployment.destinationUsdc,
        amount,
        BigInt(deadline),
      ],
    });
    return {
      boardroom: request.boardroom,
      canonicalTarget: request.boardroom,
      facetSetHash: request.expectedFacetSetHash,
      destinationPrincipal: amount,
      availableInventory,
      allowance,
      spender: request.boardroom,
      execution: executionEnvelope({
        callData,
        deadline,
        expectedOutput: amount,
        inputAmount: amount,
        inputToken: this.deployment.destinationUsdc,
        outputToken: this.deployment.destinationUsdc,
        recipient: request.recipient,
        target: request.boardroom,
        minimumOutput: amount,
      }),
    };
  }

  private async readInventory(
    token: Address,
    spender: Address,
    blockNumber?: bigint,
  ): Promise<readonly [bigint, bigint]> {
    return Promise.all([
      this.client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [this.deployment.executor],
        ...(blockNumber === undefined ? {} : { blockNumber }),
      }),
      this.client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "allowance",
        args: [this.deployment.executor, spender],
        ...(blockNumber === undefined ? {} : { blockNumber }),
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
