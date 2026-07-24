import {
  ammRouterAbi,
  fixedPriceSaleAbi,
  type Address,
} from "@pledge.cash/sdk";
import { x402Client } from "@x402/core/client";
import type {
  PaymentRequired,
  PaymentRequirements,
} from "@x402/core/types";
import {
  PAYMENT_IDENTIFIER,
  appendPaymentIdentifierToExtensions,
  isPaymentIdentifierRequired,
  isValidPaymentId,
} from "@x402/extensions/payment-identifier";
import { wrapFetchWithPayment } from "@x402/fetch";
import {
  decodeFunctionData,
  getAddress,
  isAddress,
  keccak256,
  type Hex,
  type WalletClient,
} from "viem";
import { ExactHyperliquidScheme } from "x402-hl/exact/client";
import {
  X402_HL_INTENTS_EXTENSION,
  readIntentDeclaration,
  type HyperEvmExecutionIntent,
  type IntentDeclaration,
} from "x402-hl/intents";
import { createExecutionIntentClientExtension } from "x402-hl/intents/client";

export const HYPERCORE_TESTNET = "hyperliquid:testnet" as const;
export const HYPERCORE_TESTNET_USDC =
  "USDC:0xeb62eee3685fc4c43992febcd9e75443" as const;
export const HYPEREVM_TESTNET_CHAIN_ID = 998 as const;

const HYPERCORE_USDC_DECIMALS = 8;
const HYPEREVM_USDC_DECIMALS = 6;
const MAX_V1_SLIPPAGE_BPS = 1_000;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const TERMINAL_ORDER_STATUSES = new Set<HyperliquidOrderStatus>([
  "executed",
  "refunded",
  "payment_failed",
  "manual_intervention",
]);
const RELEASABLE_ORDER_STATUSES = new Set<HyperliquidOrderStatus>([
  "executed",
  "refunded",
  "payment_failed",
]);
const PENDING_PAYMENT_STORAGE_PREFIX = "pledge.cash:x402:pending:v1";

export type X402RouterConfig = {
  application: string;
  baseUrl: string;
  gateway: Address;
  hyperevmUsdc: Address;
};

export type HyperliquidCheckoutContext = {
  config: X402RouterConfig;
  walletClient: () => WalletClient;
};

type BaseQuoteRequest = {
  boardroom: Address;
  chainId: typeof HYPEREVM_TESTNET_CHAIN_ID;
  maxSlippageBps: number;
  payer: Address;
  recipient: Address;
  refundAddress: Address;
};

export type AmmSwapQuoteRequest = BaseQuoteRequest & {
  amountIn: string;
  kind: "amm_swap";
  pool: Address;
  tokenIn: Address;
  tokenOut: Address;
};

export type FixedPriceSaleQuoteRequest = BaseQuoteRequest & {
  kind: "fixed_price_sale";
  sale: Address;
  shareAmount: string;
};

export type HyperliquidMarketplaceQuoteRequest =
  | AmmSwapQuoteRequest
  | FixedPriceSaleQuoteRequest;

export type HyperliquidRouteExpectations = {
  inputToken: Address;
  outputToken: Address;
  target: Address;
};

export type HyperliquidSourcePayment = {
  amount: string;
  asset: typeof HYPERCORE_TESTNET_USDC;
  decimals: typeof HYPERCORE_USDC_DECIMALS;
  network: typeof HYPERCORE_TESTNET;
  payTo: Address;
  principal: string;
  serviceFee: string;
  symbol: "USDC";
};

export type HyperliquidDestinationExecution = {
  callDataHash: Hex;
  chainId: typeof HYPEREVM_TESTNET_CHAIN_ID;
  deadline: number;
  expectedOutput: string;
  inputAmount: string;
  inputToken: Address;
  minimumOutput: string;
  outputToken: Address;
  recipient: Address;
  selector: Hex;
  target: Address;
};

export type HyperliquidMarketplaceQuote = {
  execution: HyperliquidDestinationExecution;
  expiresAt: string;
  kind: HyperliquidMarketplaceQuoteRequest["kind"];
  orderId: string;
  payer: Address;
  payment: HyperliquidSourcePayment;
  paymentId: string;
  quoteId: string;
  recipient: Address;
  refundAddress: Address;
};

export type HyperliquidOrderStatus =
  | "quoted"
  | "paid"
  | "executing"
  | "executed"
  | "recovery_pending"
  | "refund_pending"
  | "refunded"
  | "payment_failed"
  | "manual_intervention";

export type HyperliquidMarketplaceOrder = {
  execution: HyperliquidDestinationExecution;
  executionTransaction?: string;
  expiresAt: string;
  kind: HyperliquidMarketplaceQuoteRequest["kind"];
  message?: string;
  orderId: string;
  payer: Address;
  paymentTransaction?: string;
  quoteId: string;
  recipient: Address;
  refundAddress: Address;
  refundTransaction?: string;
  sourcePayment: HyperliquidSourcePayment;
  status: HyperliquidOrderStatus;
};

type FetchOptions = {
  fetch?: typeof globalThis.fetch;
  onAfterPaymentCreation?: () => void;
  signal?: AbortSignal;
};

export type HyperliquidPaymentRetry =
  | "same_quote"
  | "fresh_quote"
  | "locked";

export class HyperliquidPaymentClientError extends Error {
  readonly code: string | undefined;
  readonly paymentCreated: boolean;
  readonly paymentMoved: boolean | undefined;
  readonly retry: HyperliquidPaymentRetry;

  constructor(
    message: string,
    options: {
      code?: string | undefined;
      paymentCreated: boolean;
      paymentMoved?: boolean | undefined;
      retry: HyperliquidPaymentRetry;
    },
  ) {
    super(message);
    this.name = "HyperliquidPaymentClientError";
    this.code = options.code;
    this.paymentCreated = options.paymentCreated;
    this.paymentMoved = options.paymentMoved;
    this.retry = options.retry;
  }
}

export type HyperliquidPendingPaymentOutput = {
  decimals?: number | undefined;
  symbol?: string | undefined;
};

export type HyperliquidPendingPayment = {
  gateway: Address;
  kind: HyperliquidMarketplaceQuoteRequest["kind"];
  output: HyperliquidPendingPaymentOutput;
  payer: Address;
  quote: HyperliquidMarketplaceQuote;
  version: 1;
};

export type HyperliquidPendingPaymentStorage = Pick<
  Storage,
  "getItem" | "removeItem" | "setItem"
>;

export type HyperliquidPaymentLockManager = {
  request<T>(
    name: string,
    options: { mode: "exclusive" },
    callback: () => Promise<T>,
  ): Promise<T>;
};

const HYPERLIQUID_MARKETPLACE_KINDS = [
  "amm_swap",
  "fixed_price_sale",
] as const satisfies readonly HyperliquidMarketplaceQuoteRequest["kind"][];

export function getX402RouterConfig(
  env: Record<string, string | undefined> = import.meta.env,
): X402RouterConfig | undefined {
  const baseUrl = env.VITE_X402_ROUTER_API_URL?.trim();
  const application = env.VITE_X402_ROUTER_APPLICATION?.trim();
  const gateway = env.VITE_X402_ROUTER_GATEWAY_ADDRESS?.trim();
  const hyperevmUsdc =
    env.VITE_X402_ROUTER_HYPEREVM_USDC_ADDRESS?.trim();
  if (
    !baseUrl
    || !application
    || application.length > 256
    || !gateway
    || !isAddress(gateway)
    || sameAddress(gateway, ZERO_ADDRESS)
    || !hyperevmUsdc
    || !isAddress(hyperevmUsdc)
    || sameAddress(hyperevmUsdc, ZERO_ADDRESS)
  ) {
    return undefined;
  }

  try {
    const url = new URL(baseUrl);
    const localHttp = url.protocol === "http:"
      && (url.hostname === "localhost"
        || url.hostname === "127.0.0.1"
        || url.hostname === "[::1]");
    if (
      (url.protocol !== "https:" && !localHttp)
      || url.username
      || url.password
      || url.pathname !== "/"
      || url.search
      || url.hash
    ) {
      return undefined;
    }
    return {
      application,
      baseUrl: url.origin,
      gateway: getAddress(gateway),
      hyperevmUsdc: getAddress(hyperevmUsdc),
    };
  } catch {
    return undefined;
  }
}

export function hyperliquidPendingPaymentStorageKey(
  config: Pick<X402RouterConfig, "gateway">,
  payer: Address,
  kind: HyperliquidMarketplaceQuoteRequest["kind"],
): string {
  return [
    PENDING_PAYMENT_STORAGE_PREFIX,
    config.gateway.toLowerCase(),
    payer.toLowerCase(),
    kind,
  ].join(":");
}

export function saveHyperliquidPendingPayment(
  storage: HyperliquidPendingPaymentStorage,
  config: Pick<X402RouterConfig, "gateway">,
  payer: Address,
  kind: HyperliquidMarketplaceQuoteRequest["kind"],
  quote: HyperliquidMarketplaceQuote,
  output: HyperliquidPendingPaymentOutput,
): HyperliquidPendingPayment {
  if (!sameAddress(quote.payer, payer) || quote.kind !== kind) {
    throw new Error("The pending Hyperliquid payment does not match this checkout.");
  }
  const pending: HyperliquidPendingPayment = {
    gateway: getAddress(config.gateway),
    kind,
    output: pendingOutputValue(output),
    payer: getAddress(payer),
    quote,
    version: 1,
  };
  storage.setItem(
    hyperliquidPendingPaymentStorageKey(config, payer, kind),
    JSON.stringify(pending),
  );
  return pending;
}

export function loadHyperliquidPendingPayment(
  storage: HyperliquidPendingPaymentStorage,
  config: Pick<X402RouterConfig, "gateway">,
  payer: Address,
  kind: HyperliquidMarketplaceQuoteRequest["kind"],
): HyperliquidPendingPayment | undefined {
  const key = hyperliquidPendingPaymentStorageKey(config, payer, kind);
  const serialized = storage.getItem(key);
  if (!serialized) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch {
    throw new Error(
      "Stored Hyperliquid payment recovery data is unreadable and was preserved for reconciliation.",
    );
  }
  const record = objectValue(parsed, "pending payment");
  if (
    record.version !== 1
    || record.kind !== kind
    || typeof record.gateway !== "string"
    || !isAddress(record.gateway)
    || !sameAddress(record.gateway, config.gateway)
    || typeof record.payer !== "string"
    || !isAddress(record.payer)
    || !sameAddress(record.payer, payer)
  ) {
    throw new Error(
      "Stored Hyperliquid payment recovery identity is invalid and was preserved for reconciliation.",
    );
  }
  const quote = parseHyperliquidMarketplaceQuote(record.quote);
  if (!sameAddress(quote.payer, payer) || quote.kind !== kind) {
    throw new Error(
      "Stored Hyperliquid payment quote is invalid and was preserved for reconciliation.",
    );
  }
  return {
    gateway: getAddress(record.gateway),
    kind,
    output: pendingOutputValue(record.output),
    payer: getAddress(record.payer),
    quote,
    version: 1,
  };
}

export function clearHyperliquidPendingPayment(
  storage: HyperliquidPendingPaymentStorage,
  config: Pick<X402RouterConfig, "gateway">,
  payer: Address,
  kind: HyperliquidMarketplaceQuoteRequest["kind"],
  expectedOrderId?: string,
): boolean {
  if (expectedOrderId !== undefined) {
    const pending = loadHyperliquidPendingPayment(
      storage,
      config,
      payer,
      kind,
    );
    if (!pending) return true;
    if (pending.quote.orderId !== expectedOrderId) return false;
  }
  storage.removeItem(hyperliquidPendingPaymentStorageKey(config, payer, kind));
  return true;
}

export function shouldRetainHyperliquidPendingPayment(
  status: HyperliquidOrderStatus,
): boolean {
  return !RELEASABLE_ORDER_STATUSES.has(status);
}

export async function withExclusiveHyperliquidPayment<T>(
  locks: HyperliquidPaymentLockManager,
  storage: HyperliquidPendingPaymentStorage,
  config: Pick<X402RouterConfig, "gateway">,
  payer: Address,
  action: () => Promise<T>,
): Promise<T> {
  return withHyperliquidPaymentStorageLock(locks, payer, async () => {
    for (const pendingKind of HYPERLIQUID_MARKETPLACE_KINDS) {
      let pending: HyperliquidPendingPayment | undefined;
      try {
        pending = loadHyperliquidPendingPayment(
          storage,
          config,
          payer,
          pendingKind,
        );
      } catch (error) {
        throw new HyperliquidPaymentClientError(errorMessageValue(error), {
          paymentCreated: false,
          retry: "locked",
        });
      }
      if (pending) {
        throw new HyperliquidPaymentClientError(
          `Order ${pending.quote.orderId} is still retained for recovery. Resolve it before creating another Hyperliquid payment.`,
          {
            paymentCreated: false,
            retry: "locked",
          },
        );
      }
    }
    return action();
  });
}

export async function withHyperliquidPaymentStorageLock<T>(
  locks: HyperliquidPaymentLockManager,
  payer: Address,
  action: () => Promise<T>,
): Promise<T> {
  let entered = false;
  try {
    return await locks.request(
      `pledge.cash:x402:payment:${payer.toLowerCase()}`,
      { mode: "exclusive" },
      async () => {
        entered = true;
        return action();
      },
    );
  } catch (error) {
    if (entered || error instanceof HyperliquidPaymentClientError) throw error;
    throw new HyperliquidPaymentClientError(
      "The browser could not acquire the exclusive Hyperliquid payment lock.",
      {
        paymentCreated: false,
        retry: "locked",
      },
    );
  }
}

export function x402QuoteUrl(config: X402RouterConfig): string {
  return `${config.baseUrl}/v1/quotes`;
}

export function x402ExecuteUrl(
  config: X402RouterConfig,
  quoteId: string,
): string {
  return `${config.baseUrl}/v1/quotes/${encodeURIComponent(quoteId)}/execute`;
}

export function x402OrderUrl(
  config: X402RouterConfig,
  orderId: string,
): string {
  return `${config.baseUrl}/v1/orders/${encodeURIComponent(orderId)}`;
}

export async function createHyperliquidMarketplaceQuote(
  context: HyperliquidCheckoutContext,
  request: HyperliquidMarketplaceQuoteRequest,
  expectations: HyperliquidRouteExpectations,
  options: FetchOptions = {},
): Promise<HyperliquidMarketplaceQuote> {
  assertRequestBoundary(request, expectations);
  const response = await (options.fetch ?? globalThis.fetch)(
    x402QuoteUrl(context.config),
    {
      body: JSON.stringify(request),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  const body = await responseJson(response);
  if (!response.ok) throw apiResponseError(response, body, "The Hyperliquid quote failed.");

  const quote = parseHyperliquidMarketplaceQuote(body);
  assertQuoteBoundary(quote, request, expectations);
  return quote;
}

export async function executeHyperliquidMarketplaceQuote(
  context: HyperliquidCheckoutContext,
  quote: HyperliquidMarketplaceQuote,
  request: HyperliquidMarketplaceQuoteRequest,
  expectations: HyperliquidRouteExpectations,
  options: FetchOptions = {},
): Promise<HyperliquidMarketplaceOrder> {
  try {
    assertQuoteBoundary(quote, request, expectations);
  } catch (error) {
    throw new HyperliquidPaymentClientError(errorMessageValue(error), {
      paymentCreated: false,
      paymentMoved: false,
      retry: "fresh_quote",
    });
  }
  if (Date.parse(quote.expiresAt) <= Date.now()) {
    throw new HyperliquidPaymentClientError(
      "This Hyperliquid quote expired. Request a fresh quote.",
      {
        paymentCreated: false,
        paymentMoved: false,
        retry: "fresh_quote",
      },
    );
  }

  let wallet: WalletClient;
  try {
    wallet = context.walletClient();
  } catch (error) {
    throw retryablePaymentError(error);
  }
  const walletAddress = wallet.account?.address;
  if (!walletAddress || !sameAddress(walletAddress, request.payer)) {
    throw new HyperliquidPaymentClientError(
      "The active wallet no longer matches this Hyperliquid order.",
      {
        paymentCreated: false,
        retry: "same_quote",
      },
    );
  }
  const signer = {
    address: getAddress(walletAddress),
    signTypedData: async (parameters: unknown): Promise<Hex> =>
      await (wallet.signTypedData as unknown as (
        value: unknown,
      ) => Promise<Hex>)(parameters),
  };

  const executeUrl = x402ExecuteUrl(context.config, quote.quoteId);
  let paymentCreated = false;
  const client = new x402Client()
    .register(HYPERCORE_TESTNET, new ExactHyperliquidScheme(signer))
    .registerPolicy((_version, requirements) =>
      requirements.filter((candidate) =>
        paymentRequirementsMatchQuote(candidate, quote),
      ))
    .onBeforePaymentCreation(async ({ paymentRequired, selectedRequirements }) => {
      const extensions = paymentRequired.extensions;
      if (
        !extensions
        || !isPaymentIdentifierRequired(extensions[PAYMENT_IDENTIFIER])
      ) {
        throw new Error("The payment request did not require a recovery identifier.");
      }
      appendPaymentIdentifierToExtensions(extensions, quote.paymentId);

      const declaration = readIntentDeclaration(paymentRequired);
      if (!declaration) {
        throw new Error("The payment request is missing the required execution intent.");
      }
      // Run the complete authorization boundary before the HyperCore transfer
      // payload is signed. The intent extension repeats it before signing the
      // paired HyperEVM EIP-712 intent.
      assertHyperliquidIntentAuthorization({
        config: context.config,
        declaration,
        executeUrl,
        expectations,
        intent: declaration.intent,
        paymentRequired,
        quote,
        request,
        selected: selectedRequirements,
      });
    })
    .registerExtension(
      createExecutionIntentClientExtension({
        signer,
        domain: {
          application: context.config.application,
          gateway: context.config.gateway,
        },
        approve(intent, declaration, paymentRequired, selected) {
          assertHyperliquidIntentAuthorization({
            config: context.config,
            declaration,
            executeUrl,
            expectations,
            intent,
            paymentRequired,
            quote,
            request,
            selected,
          });
          return true;
        },
      }),
    )
    .onAfterPaymentCreation(async () => {
      // This hook completes before wrapFetchWithPayment issues the paid retry.
      // The caller must durably persist the recovery identity synchronously.
      options.onAfterPaymentCreation?.();
      paymentCreated = true;
    });
  const paidFetch = wrapFetchWithPayment(
    options.fetch ?? globalThis.fetch,
    client,
  );

  try {
    const response = await paidFetch(executeUrl, { method: "POST" });
    const body = await responseJson(response);
    if (!response.ok) {
      const details = apiErrorDetails(
        body,
        `Payment status is uncertain. Keep order ${quote.orderId} for recovery.`,
      );
      if (paymentCreated) {
        const recovered = await recoverOrder(context.config, quote.orderId, options);
        if (recovered && recovered.status !== "quoted") {
          return assertOrderBoundary(recovered, quote);
        }
      }
      if (details.paymentMoved === false) {
        throw new HyperliquidPaymentClientError(
          `${details.message} (HTTP ${response.status.toString()}) Request a fresh quote.`,
          {
            code: details.code,
            paymentCreated,
            paymentMoved: false,
            retry: "fresh_quote",
          },
        );
      }
      throw new HyperliquidPaymentClientError(
        paymentCreated
          ? `${details.message} (HTTP ${response.status.toString()}) Payment status is uncertain. Keep order ${quote.orderId} for recovery and do not submit another payment.`
          : `${details.message} (HTTP ${response.status.toString()})`,
        {
          code: details.code,
          paymentCreated,
          paymentMoved: details.paymentMoved,
          retry: paymentCreated ? "locked" : "same_quote",
        },
      );
    }
    const directOrder = tryParseOrderResponse(body);
    const next = directOrder
      ? assertOrderBoundary(directOrder, quote)
      : await getHyperliquidMarketplaceOrder(context.config, quote.orderId, options);
    if (paymentCreated && next.status === "quoted") {
      throw uncertainPaymentError(
        quote.orderId,
        "The router has not resolved the created payment yet.",
      );
    }
    return assertOrderBoundary(next, quote);
  } catch (error) {
    if (error instanceof HyperliquidPaymentClientError) throw error;
    if (!paymentCreated) throw retryablePaymentError(error);

    const recovered = await recoverOrder(context.config, quote.orderId, options);
    if (recovered && recovered.status !== "quoted") {
      try {
        return assertOrderBoundary(recovered, quote);
      } catch {
        // A mismatched recovery response cannot release the persisted lock.
      }
    }
    throw uncertainPaymentError(quote.orderId, errorMessageValue(error));
  }
}

export async function getHyperliquidMarketplaceOrder(
  config: X402RouterConfig,
  orderId: string,
  options: FetchOptions = {},
): Promise<HyperliquidMarketplaceOrder> {
  const response = await (options.fetch ?? globalThis.fetch)(
    x402OrderUrl(config, orderId),
    options.signal === undefined ? undefined : { signal: options.signal },
  );
  const body = await responseJson(response);
  if (!response.ok) throw apiResponseError(response, body, "The order status could not be loaded.");
  return parseHyperliquidMarketplaceOrder(unwrapOrder(body));
}

export function isTerminalHyperliquidOrder(
  order: HyperliquidMarketplaceOrder,
): boolean {
  return TERMINAL_ORDER_STATUSES.has(order.status);
}

export function assertHyperliquidMarketplaceOrderMatchesQuote(
  order: HyperliquidMarketplaceOrder,
  quote: HyperliquidMarketplaceQuote,
): HyperliquidMarketplaceOrder {
  return assertOrderBoundary(order, quote);
}

export function parseHyperliquidMarketplaceQuote(
  value: unknown,
): HyperliquidMarketplaceQuote {
  const record = objectValue(value, "quote");
  const kind = actionKind(record.kind);
  const quote: HyperliquidMarketplaceQuote = {
    execution: executionValue(record.execution),
    expiresAt: dateTimeValue(record.expiresAt, "quote.expiresAt"),
    kind,
    orderId: nonemptyString(record.orderId, "quote.orderId"),
    payer: addressValue(record.payer, "quote.payer"),
    payment: sourcePaymentValue(record.payment, "quote.payment"),
    paymentId: nonemptyString(record.paymentId, "quote.paymentId"),
    quoteId: nonemptyString(record.quoteId, "quote.quoteId"),
    recipient: addressValue(record.recipient, "quote.recipient"),
    refundAddress: addressValue(record.refundAddress, "quote.refundAddress"),
  };
  if (quote.orderId !== quote.quoteId) {
    throw new Error("The router returned mismatched quote and order identifiers.");
  }
  return quote;
}

export function parseHyperliquidMarketplaceOrder(
  value: unknown,
): HyperliquidMarketplaceOrder {
  const record = objectValue(value, "order");
  const paymentTransaction = optionalString(record.paymentTransaction, "order.paymentTransaction");
  const executionTransaction = optionalString(record.executionTransaction, "order.executionTransaction");
  const refundTransaction = optionalString(record.refundTransaction, "order.refundTransaction");
  const message = optionalString(record.message, "order.message");
  return {
    execution: executionValue(record.execution),
    ...(executionTransaction ? { executionTransaction } : {}),
    expiresAt: dateTimeValue(record.expiresAt, "order.expiresAt"),
    kind: actionKind(record.kind),
    ...(message ? { message } : {}),
    orderId: nonemptyString(record.orderId, "order.orderId"),
    payer: addressValue(record.payer, "order.payer"),
    ...(paymentTransaction ? { paymentTransaction } : {}),
    quoteId: nonemptyString(record.quoteId, "order.quoteId"),
    recipient: addressValue(record.recipient, "order.recipient"),
    refundAddress: addressValue(record.refundAddress, "order.refundAddress"),
    ...(refundTransaction ? { refundTransaction } : {}),
    sourcePayment: sourcePaymentValue(record.sourcePayment, "order.sourcePayment"),
    status: orderStatus(record.status),
  };
}

export function assertHyperliquidIntentAuthorization(input: {
  config: X402RouterConfig;
  declaration: IntentDeclaration;
  executeUrl: string;
  expectations: HyperliquidRouteExpectations;
  intent: HyperEvmExecutionIntent;
  paymentRequired: PaymentRequired;
  quote: HyperliquidMarketplaceQuote;
  request: HyperliquidMarketplaceQuoteRequest;
  selected: PaymentRequirements;
}): void {
  const {
    config,
    declaration,
    executeUrl,
    expectations,
    intent,
    paymentRequired,
    quote,
    request,
    selected,
  } = input;
  assertPaymentRequiredBoundary(paymentRequired, selected, executeUrl, quote);
  if (!declaration.required) {
    throw new Error("The server did not require the declared HyperEVM execution intent.");
  }
  if (
    declaration.quoteId !== quote.quoteId
    || intent.quoteId !== quote.quoteId
  ) {
    throw new Error("The execution intent is for a different quote.");
  }
  if (
    intent.application !== config.application
    || !sameAddress(intent.gateway, config.gateway)
  ) {
    throw new Error("The execution intent does not match the trusted router identity.");
  }
  if (
    !sameAddress(intent.user, request.payer)
    || !sameAddress(intent.recipient, request.recipient)
    || !sameAddress(intent.refundAddress, request.refundAddress)
  ) {
    throw new Error("The execution intent changed the payer, recipient, or refund address.");
  }
  if (
    intent.chainId !== HYPEREVM_TESTNET_CHAIN_ID
    || !sameAddress(intent.target, expectations.target)
    || !sameAddress(intent.target, quote.execution.target)
  ) {
    throw new Error("The execution intent changed the trusted HyperEVM route.");
  }
  if (intent.value !== "0") {
    throw new Error("The brokered v1 route cannot attach native HyperEVM value.");
  }
  if (
    intent.maxSlippageBps !== request.maxSlippageBps
    || intent.deadline !== quote.execution.deadline
  ) {
    throw new Error("The execution intent changed the approved limits.");
  }
  if (keccak256(intent.callData as Hex) !== quote.execution.callDataHash) {
    throw new Error("The execution calldata does not match the reviewed quote.");
  }
  assertCanonicalCalldata(intent, request, quote, expectations);
}

function assertRequestBoundary(
  request: HyperliquidMarketplaceQuoteRequest,
  expectations: HyperliquidRouteExpectations,
): void {
  if (request.chainId !== HYPEREVM_TESTNET_CHAIN_ID) {
    throw new Error("The Hyperliquid rail supports HyperEVM testnet only.");
  }
  if (
    !sameAddress(request.payer, request.recipient)
    || !sameAddress(request.payer, request.refundAddress)
  ) {
    throw new Error("Payer, recipient, and refund address must be the same wallet in v1.");
  }
  if (
    !Number.isInteger(request.maxSlippageBps)
    || request.maxSlippageBps < 0
    || request.maxSlippageBps > MAX_V1_SLIPPAGE_BPS
  ) {
    throw new Error("Hyperliquid v1 slippage must be between 0 and 1,000 bps.");
  }
  if (request.kind === "amm_swap") {
    positiveDecimal(request.amountIn, "AMM input amount");
    if (
      !sameAddress(request.tokenIn, expectations.inputToken)
      || !sameAddress(request.tokenOut, expectations.outputToken)
    ) {
      throw new Error("The requested AMM pair does not match the locally selected route.");
    }
  } else {
    positiveDecimal(request.shareAmount, "Sale share amount");
    if (!sameAddress(request.sale, expectations.target)) {
      throw new Error("The requested sale does not match the locally selected route.");
    }
  }
}

function assertQuoteBoundary(
  quote: HyperliquidMarketplaceQuote,
  request: HyperliquidMarketplaceQuoteRequest,
  expectations: HyperliquidRouteExpectations,
): void {
  assertRequestBoundary(request, expectations);
  if (quote.kind !== request.kind) throw new Error("The router quoted a different marketplace action.");
  if (!isValidPaymentId(quote.paymentId)) {
    throw new Error("The router quote returned an invalid payment identifier.");
  }
  if (
    !sameAddress(quote.payer, request.payer)
    || !sameAddress(quote.recipient, request.recipient)
    || !sameAddress(quote.refundAddress, request.refundAddress)
  ) {
    throw new Error("The router quote changed the payer, recipient, or refund address.");
  }
  if (
    quote.execution.chainId !== HYPEREVM_TESTNET_CHAIN_ID
    || !sameAddress(quote.execution.target, expectations.target)
    || !sameAddress(quote.execution.inputToken, expectations.inputToken)
    || !sameAddress(quote.execution.outputToken, expectations.outputToken)
    || !sameAddress(quote.execution.recipient, request.recipient)
  ) {
    throw new Error("The router quote does not match the locally selected HyperEVM route.");
  }
  if (
    quote.payment.network !== HYPERCORE_TESTNET
    || quote.payment.asset !== HYPERCORE_TESTNET_USDC
    || quote.payment.symbol !== "USDC"
    || quote.payment.decimals !== HYPERCORE_USDC_DECIMALS
  ) {
    throw new Error("The router quote changed the supported HyperCore payment asset.");
  }
  const paymentAmount = positiveDecimal(quote.payment.amount, "Source payment");
  const principal = positiveDecimal(quote.payment.principal, "Source principal");
  const serviceFee = decimalValue(quote.payment.serviceFee, "Service fee");
  if (paymentAmount !== principal + serviceFee) {
    throw new Error("The source payment does not equal principal plus the disclosed fee.");
  }
  const destinationInput = positiveDecimal(
    quote.execution.inputAmount,
    "Destination input",
  );
  const decimalScale =
    10n ** BigInt(HYPERCORE_USDC_DECIMALS - HYPEREVM_USDC_DECIMALS);
  if (principal !== destinationInput * decimalScale) {
    throw new Error("The source principal does not match the destination USDC input.");
  }
  const expectedOutput = positiveDecimal(
    quote.execution.expectedOutput,
    "Expected output",
  );
  const minimumOutput = positiveDecimal(
    quote.execution.minimumOutput,
    "Minimum output",
  );
  if (minimumOutput > expectedOutput) {
    throw new Error("The quote minimum output exceeds its expected output.");
  }
  if (request.kind === "amm_swap") {
    if (quote.execution.inputAmount !== request.amountIn) {
      throw new Error("The router quote changed the AMM input amount.");
    }
    const expectedMinimum =
      (expectedOutput * BigInt(10_000 - request.maxSlippageBps)) / 10_000n;
    if (minimumOutput !== expectedMinimum) {
      throw new Error("The AMM minimum output does not match the requested slippage.");
    }
  } else if (
    quote.execution.expectedOutput !== request.shareAmount
    || quote.execution.minimumOutput !== request.shareAmount
  ) {
    throw new Error("The router quote changed the fixed-price share amount.");
  }
  const expirySeconds = Math.floor(Date.parse(quote.expiresAt) / 1_000);
  if (quote.execution.deadline !== expirySeconds) {
    throw new Error("The execution deadline does not match the quote expiry.");
  }
}

function assertCanonicalCalldata(
  intent: HyperEvmExecutionIntent,
  request: HyperliquidMarketplaceQuoteRequest,
  quote: HyperliquidMarketplaceQuote,
  expectations: HyperliquidRouteExpectations,
): void {
  if (request.kind === "amm_swap") {
    const decoded = decodeFunctionData({
      abi: ammRouterAbi,
      data: intent.callData as Hex,
    });
    if (decoded.functionName !== "swapExactTokensForTokens") {
      throw new Error("The execution intent is not an exact-token AMM swap.");
    }
    const [amountIn, amountOutMin, path, recipient, deadline] = decoded.args;
    if (
      amountIn !== BigInt(request.amountIn)
      || amountOutMin !== BigInt(quote.execution.minimumOutput)
      || path.length !== 2
      || !sameAddress(path[0]!, expectations.inputToken)
      || !sameAddress(path[1]!, expectations.outputToken)
      || !sameAddress(recipient, request.recipient)
      || deadline !== BigInt(quote.execution.deadline)
    ) {
      throw new Error("The AMM calldata changed the reviewed route or limits.");
    }
    return;
  }

  const decoded = decodeFunctionData({
    abi: fixedPriceSaleAbi,
    data: intent.callData as Hex,
  });
  if (decoded.functionName !== "buy") {
    throw new Error("The execution intent is not a fixed-price sale purchase.");
  }
  const [shareAmount, recipient, maxPayment, deadline] = decoded.args;
  const inputAmount = BigInt(quote.execution.inputAmount);
  const maximumPayment =
    inputAmount
    + (inputAmount * BigInt(request.maxSlippageBps) + 9_999n) / 10_000n;
  if (
    shareAmount !== BigInt(request.shareAmount)
    || !sameAddress(recipient, request.recipient)
    || maxPayment !== maximumPayment
    || deadline !== BigInt(quote.execution.deadline)
  ) {
    throw new Error("The sale calldata changed the reviewed amount or limits.");
  }
}

function assertPaymentRequiredBoundary(
  paymentRequired: PaymentRequired,
  selected: PaymentRequirements,
  executeUrl: string,
  quote: HyperliquidMarketplaceQuote,
): void {
  if (
    paymentRequired.x402Version !== 2
    || normalizedUrl(paymentRequired.resource.url) !== normalizedUrl(executeUrl)
  ) {
    throw new Error("The payment request is for an unexpected resource.");
  }
  if (!paymentRequirementsMatchQuote(selected, quote)) {
    throw new Error("The payment request changed the reviewed HyperCore transfer.");
  }
  const extensions = paymentRequired.extensions;
  if (
    !isPaymentIdentifierRequired(
      extensions?.[PAYMENT_IDENTIFIER],
    )
    || extensions?.[X402_HL_INTENTS_EXTENSION] == null
  ) {
    throw new Error("The payment request is missing required recovery or execution bindings.");
  }
  const declaration = readIntentDeclaration(paymentRequired);
  if (!declaration?.required || declaration.quoteId !== quote.quoteId) {
    throw new Error("The payment request is missing the required quote-bound intent.");
  }
}

function paymentRequirementsMatchQuote(
  requirements: PaymentRequirements,
  quote: HyperliquidMarketplaceQuote,
): boolean {
  return requirements.scheme === "exact"
    && requirements.network === quote.payment.network
    && requirements.asset === quote.payment.asset
    && requirements.amount === quote.payment.amount
    && sameAddress(requirements.payTo, quote.payment.payTo);
}

function assertOrderBoundary(
  order: HyperliquidMarketplaceOrder,
  quote: HyperliquidMarketplaceQuote,
): HyperliquidMarketplaceOrder {
  if (
    order.orderId !== quote.orderId
    || order.quoteId !== quote.quoteId
    || order.kind !== quote.kind
    || !sameAddress(order.payer, quote.payer)
    || !sameAddress(order.recipient, quote.recipient)
    || !sameAddress(order.refundAddress, quote.refundAddress)
    || order.execution.callDataHash !== quote.execution.callDataHash
    || order.sourcePayment.amount !== quote.payment.amount
  ) {
    throw new Error("The recovered order does not match the reviewed quote.");
  }
  return order;
}

async function recoverOrder(
  config: X402RouterConfig,
  orderId: string,
  options: FetchOptions,
): Promise<HyperliquidMarketplaceOrder | undefined> {
  try {
    return await getHyperliquidMarketplaceOrder(config, orderId, options);
  } catch {
    return undefined;
  }
}

function tryParseOrderResponse(
  value: unknown,
): HyperliquidMarketplaceOrder | undefined {
  try {
    return parseHyperliquidMarketplaceOrder(unwrapOrder(value));
  } catch {
    return undefined;
  }
}

function unwrapOrder(value: unknown): unknown {
  if (!isObject(value)) return value;
  return value.order ?? value;
}

function executionValue(value: unknown): HyperliquidDestinationExecution {
  const record = objectValue(value, "execution");
  const deadline = safePositiveInteger(record.deadline, "execution.deadline");
  return {
    callDataHash: bytesValue(record.callDataHash, 32, "execution.callDataHash"),
    chainId: literalNumber(record.chainId, HYPEREVM_TESTNET_CHAIN_ID, "execution.chainId"),
    deadline,
    expectedOutput: positiveDecimalString(record.expectedOutput, "execution.expectedOutput"),
    inputAmount: positiveDecimalString(record.inputAmount, "execution.inputAmount"),
    inputToken: addressValue(record.inputToken, "execution.inputToken"),
    minimumOutput: positiveDecimalString(record.minimumOutput, "execution.minimumOutput"),
    outputToken: addressValue(record.outputToken, "execution.outputToken"),
    recipient: addressValue(record.recipient, "execution.recipient"),
    selector: bytesValue(record.selector, 4, "execution.selector"),
    target: addressValue(record.target, "execution.target"),
  };
}

function sourcePaymentValue(
  value: unknown,
  label: string,
): HyperliquidSourcePayment {
  const record = objectValue(value, label);
  return {
    amount: positiveDecimalString(record.amount, `${label}.amount`),
    asset: literalString(record.asset, HYPERCORE_TESTNET_USDC, `${label}.asset`),
    decimals: literalNumber(
      record.decimals,
      HYPERCORE_USDC_DECIMALS,
      `${label}.decimals`,
    ),
    network: literalString(
      record.network,
      HYPERCORE_TESTNET,
      `${label}.network`,
    ),
    payTo: addressValue(record.payTo, `${label}.payTo`),
    principal: positiveDecimalString(record.principal, `${label}.principal`),
    serviceFee: decimalString(record.serviceFee, `${label}.serviceFee`),
    symbol: literalString(record.symbol, "USDC", `${label}.symbol`),
  };
}

function actionKind(value: unknown): HyperliquidMarketplaceQuoteRequest["kind"] {
  if (value === "amm_swap" || value === "fixed_price_sale") return value;
  throw new Error("The router returned an unsupported marketplace action.");
}

function orderStatus(value: unknown): HyperliquidOrderStatus {
  if (
    value === "quoted"
    || value === "paid"
    || value === "executing"
    || value === "executed"
    || value === "recovery_pending"
    || value === "refund_pending"
    || value === "refunded"
    || value === "payment_failed"
    || value === "manual_intervention"
  ) {
    return value;
  }
  throw new Error("The router returned an unsupported order status.");
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!isObject(value)) throw new Error(`The router returned an invalid ${label}.`);
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addressValue(value: unknown, label: string): Address {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new Error(`The router returned an invalid ${label}.`);
  }
  return getAddress(value);
}

function decimalValue(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`The router returned an invalid ${label}.`);
  }
  return BigInt(value);
}

function positiveDecimal(value: unknown, label: string): bigint {
  const parsed = decimalValue(value, label);
  if (parsed <= 0n) throw new Error(`${label} must be greater than zero.`);
  return parsed;
}

function decimalString(value: unknown, label: string): string {
  decimalValue(value, label);
  return value as string;
}

function positiveDecimalString(value: unknown, label: string): string {
  positiveDecimal(value, label);
  return value as string;
}

function nonemptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`The router returned an invalid ${label}.`);
  }
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return nonemptyString(value, label);
}

function literalString<T extends string>(
  value: unknown,
  expected: T,
  label: string,
): T {
  if (value !== expected) throw new Error(`The router returned an invalid ${label}.`);
  return expected;
}

function literalNumber<T extends number>(
  value: unknown,
  expected: T,
  label: string,
): T {
  if (value !== expected) throw new Error(`The router returned an invalid ${label}.`);
  return expected;
}

function safePositiveInteger(value: unknown, label: string): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value <= 0
  ) {
    throw new Error(`The router returned an invalid ${label}.`);
  }
  return value;
}

function bytesValue(
  value: unknown,
  bytes: number,
  label: string,
): Hex {
  if (
    typeof value !== "string"
    || !new RegExp(`^0x[0-9a-fA-F]{${(bytes * 2).toString()}}$`).test(value)
  ) {
    throw new Error(`The router returned an invalid ${label}.`);
  }
  return value.toLowerCase() as Hex;
}

function dateTimeValue(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`The router returned an invalid ${label}.`);
  }
  return value;
}

async function responseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`The router returned invalid JSON (HTTP ${response.status.toString()}).`);
  }
}

type ApiErrorDetails = {
  code?: string | undefined;
  message: string;
  paymentMoved?: boolean | undefined;
};

function apiErrorDetails(
  body: unknown,
  fallback: string,
): ApiErrorDetails {
  const topLevel = isObject(body) ? body : undefined;
  const nested = topLevel && isObject(topLevel.error)
    ? topLevel.error
    : undefined;
  const message = nested && typeof nested.message === "string"
    ? nested.message
    : topLevel && typeof topLevel.error === "string"
      ? topLevel.error
      : topLevel && typeof topLevel.message === "string"
        ? topLevel.message
        : fallback;
  const code = nested && typeof nested.code === "string"
    ? nested.code
    : topLevel && typeof topLevel.code === "string"
      ? topLevel.code
      : undefined;
  const paymentMoved = nested && typeof nested.paymentMoved === "boolean"
    ? nested.paymentMoved
    : topLevel && typeof topLevel.paymentMoved === "boolean"
      ? topLevel.paymentMoved
      : undefined;
  return {
    ...(code ? { code } : {}),
    message,
    ...(paymentMoved === undefined ? {} : { paymentMoved }),
  };
}

function apiResponseError(
  response: Response,
  body: unknown,
  fallback: string,
): Error {
  const details = apiErrorDetails(body, fallback);
  return new Error(`${details.message} (HTTP ${response.status.toString()})`);
}

function retryablePaymentError(error: unknown): HyperliquidPaymentClientError {
  return new HyperliquidPaymentClientError(errorMessageValue(error), {
    paymentCreated: false,
    retry: "same_quote",
  });
}

function uncertainPaymentError(
  orderId: string,
  detail: string,
): HyperliquidPaymentClientError {
  return new HyperliquidPaymentClientError(
    `${detail} Payment status is uncertain. Keep order ${orderId} for recovery and do not submit another payment.`,
    {
      paymentCreated: true,
      retry: "locked",
    },
  );
}

function errorMessageValue(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "The Hyperliquid payment could not be completed.";
}

function pendingOutputValue(
  value: unknown,
): HyperliquidPendingPaymentOutput {
  if (value === undefined) return {};
  const record = objectValue(value, "pending payment output");
  const decimals = record.decimals;
  const symbol = record.symbol;
  if (
    decimals !== undefined
    && (
      typeof decimals !== "number"
      || !Number.isInteger(decimals)
      || decimals < 0
      || decimals > 255
    )
  ) {
    throw new Error("The pending payment output decimals are invalid.");
  }
  if (
    symbol !== undefined
    && (
      typeof symbol !== "string"
      || !symbol.trim()
      || symbol.length > 32
    )
  ) {
    throw new Error("The pending payment output symbol is invalid.");
  }
  return {
    ...(decimals === undefined ? {} : { decimals }),
    ...(symbol === undefined ? {} : { symbol }),
  };
}

function normalizedUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  return url.toString();
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
