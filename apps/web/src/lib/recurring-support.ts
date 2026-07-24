import {
  getAddress,
  isAddress,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import {
  assertHyperliquidMarketplaceQuoteMatchesRequest,
  parseHyperliquidMarketplaceQuote,
  type HyperliquidCheckoutContext,
  type HyperliquidMarketplaceQuote,
  type HyperliquidRouteExpectations,
  type RecurringSupportQuoteRequest,
  type X402RouterConfig,
} from "./x402-router";

const SUPPORT_SUBSCRIPTION_STORAGE_PREFIX =
  "pledge.cash:recurring-support:subscription:v1";

export type RecurringSupportPlan = {
  id: string;
  chainId: 998;
  boardroom: Address;
  asset: Address;
  amount: string;
  cadence: "monthly";
  title: string;
  description: string;
  termsHash: Hex;
  status: "active" | "retired";
  authority: Address;
  authorityMode: "prelaunch_owner" | "launched_controller";
  createdAt: string;
  retiredAt?: string;
};

export type RecurringSupportChallenge = {
  challengeId: string;
  action:
    | "plan_create"
    | "plan_retire"
    | "subscription_create"
    | "subscription_cancel";
  actor: Address;
  boardroom: Address;
  chainId: 998;
  planId: string;
  message: string;
  payload: Record<string, unknown>;
  payloadHash: Hex;
  expiresAt: string;
};

export type RecurringSupportSubscription = {
  id: string;
  planId: string;
  payer: Address;
  status: "active" | "cancelled";
  startedAt: string;
  createdAt: string;
  cancelledAt?: string;
};

export type RecurringSupportInvoice = {
  id: string;
  subscriptionId: string;
  planId: string;
  periodIndex: number;
  periodStart: string;
  periodEnd: string;
  dueAt: string;
  payer: Address;
  boardroom: Address;
  asset: Address;
  amount: string;
  status:
    | "open"
    | "payment_pending"
    | "paid"
    | "cancelled"
    | "manual_intervention";
  latestQuoteId?: string;
  lastAttemptStatus?: "refunded" | "payment_failed";
};

export type RecurringSupportSubscriptionView = {
  plan: RecurringSupportPlan;
  subscription: RecurringSupportSubscription;
  invoice?: RecurringSupportInvoice;
};

export type RecurringSupportPlanDraft = {
  boardroom: Address;
  chainId: 998;
  amount: string;
  cadence: "monthly";
  title: string;
  description: string;
};

type FetchOptions = {
  fetch?: typeof globalThis.fetch | undefined;
  signal?: AbortSignal | undefined;
};

export async function getRecurringSupportPlans(
  config: X402RouterConfig,
  boardroom: Address,
  options: FetchOptions = {},
): Promise<readonly RecurringSupportPlan[]> {
  const url = new URL(`${config.baseUrl}/v1/support/plans`);
  url.searchParams.set("boardroom", boardroom);
  const body = await supportRequest(url.toString(), {
    fetch: options.fetch,
    signal: options.signal,
  });
  const record = objectValue(body, "support plan response");
  if (!Array.isArray(record.plans)) {
    throw new Error("The router returned an invalid support plan list.");
  }
  return record.plans.map(value => {
    const plan = supportPlanValue(value);
    assertPlanBoundary(plan, config, boardroom);
    return plan;
  });
}

export async function publishRecurringSupportPlan(
  context: HyperliquidCheckoutContext,
  draft: RecurringSupportPlanDraft,
  options: FetchOptions = {},
): Promise<RecurringSupportPlan> {
  const challenge = await createChallenge(
    context.config,
    "/v1/support/plans/challenges",
    draft,
    options,
  );
  assertChallengeBoundary(challenge, context.config, {
    action: "plan_create",
    actor: challenge.actor,
    boardroom: draft.boardroom,
    payload: {
      version: 1,
      planId: challenge.planId,
      chainId: 998,
      boardroom: draft.boardroom.toLowerCase(),
      asset: context.config.hyperevmUsdc.toLowerCase(),
      amount: draft.amount,
      cadence: "monthly",
      title: draft.title.trim(),
      description: draft.description.trim(),
    },
    planId: challenge.planId,
  });
  const signature = await signChallenge(context, challenge);
  const body = await supportRequest(
    `${context.config.baseUrl}/v1/support/plans`,
    {
      body: { challengeId: challenge.challengeId, signature },
      fetch: options.fetch,
      method: "POST",
      signal: options.signal,
    },
  );
  const plan = supportPlanValue(objectValue(body, "plan creation response").plan);
  assertPlanBoundary(plan, context.config, draft.boardroom);
  if (
    plan.id !== challenge.planId
    || plan.amount !== draft.amount
    || plan.title !== draft.title.trim()
    || plan.description !== draft.description.trim()
  ) {
    throw new Error("The published support plan does not match the signed terms.");
  }
  return plan;
}

export async function retireRecurringSupportPlan(
  context: HyperliquidCheckoutContext,
  plan: RecurringSupportPlan,
  options: FetchOptions = {},
): Promise<RecurringSupportPlan> {
  assertPlanBoundary(plan, context.config, plan.boardroom);
  const safePlanId = uuidValue(plan.id, "support plan ID");
  const challenge = await createChallenge(
    context.config,
    `/v1/support/plans/${encodeURIComponent(safePlanId)}/retirement-challenges`,
    undefined,
    options,
  );
  assertChallengeBoundary(challenge, context.config, {
    action: "plan_retire",
    actor: challenge.actor,
    boardroom: plan.boardroom,
    payload: {
      version: 1,
      action: "retire",
      planId: safePlanId,
      boardroom: plan.boardroom.toLowerCase(),
    },
    planId: safePlanId,
  });
  const signature = await signChallenge(context, challenge);
  const body = await supportRequest(
    `${context.config.baseUrl}/v1/support/plans/${encodeURIComponent(safePlanId)}/retire`,
    {
      body: { challengeId: challenge.challengeId, signature },
      fetch: options.fetch,
      method: "POST",
      signal: options.signal,
    },
  );
  const retired = supportPlanValue(
    objectValue(body, "plan retirement response").plan,
  );
  assertPlanBoundary(retired, context.config, plan.boardroom);
  if (retired.id !== plan.id || retired.status !== "retired") {
    throw new Error("The router retired a different support plan.");
  }
  return retired;
}

export async function createRecurringSupportSubscription(
  context: HyperliquidCheckoutContext,
  plan: RecurringSupportPlan,
  payer: Address,
  options: FetchOptions = {},
): Promise<RecurringSupportSubscriptionView> {
  assertPlanBoundary(plan, context.config, plan.boardroom);
  const challenge = await createChallenge(
    context.config,
    "/v1/support/subscriptions/challenges",
    { planId: uuidValue(plan.id, "support plan ID"), payer },
    options,
  );
  const subscriptionId = uuidValue(
    challenge.payload.subscriptionId,
    "support subscription ID",
  );
  assertChallengeBoundary(challenge, context.config, {
    action: "subscription_create",
    actor: payer,
    boardroom: plan.boardroom,
    payload: {
      version: 1,
      action: "subscribe",
      subscriptionId,
      planId: plan.id,
      boardroom: plan.boardroom.toLowerCase(),
      payer: payer.toLowerCase(),
    },
    planId: plan.id,
  });
  const signature = await signChallenge(context, challenge);
  const body = await supportRequest(
    `${context.config.baseUrl}/v1/support/subscriptions`,
    {
      body: { challengeId: challenge.challengeId, signature },
      fetch: options.fetch,
      method: "POST",
      signal: options.signal,
    },
  );
  const view = supportSubscriptionViewValue(body);
  assertSubscriptionViewBoundary(view, context.config);
  if (
    view.plan.id !== plan.id
    || view.subscription.id !== subscriptionId
    || view.subscription.payer.toLowerCase() !== payer.toLowerCase()
  ) {
    throw new Error("The created support schedule does not match the signed request.");
  }
  return view;
}

export async function getRecurringSupportSubscription(
  config: X402RouterConfig,
  subscriptionId: string,
  options: FetchOptions = {},
): Promise<RecurringSupportSubscriptionView> {
  const id = uuidValue(subscriptionId, "support subscription ID");
  const body = await supportRequest(
    `${config.baseUrl}/v1/support/subscriptions/${encodeURIComponent(id)}`,
    { fetch: options.fetch, signal: options.signal },
  );
  const view = supportSubscriptionViewValue(body);
  assertSubscriptionViewBoundary(view, config);
  return view;
}

export async function cancelRecurringSupportSubscription(
  context: HyperliquidCheckoutContext,
  view: RecurringSupportSubscriptionView,
  options: FetchOptions = {},
): Promise<RecurringSupportSubscriptionView> {
  assertSubscriptionViewBoundary(view, context.config);
  const id = uuidValue(view.subscription.id, "support subscription ID");
  const challenge = await createChallenge(
    context.config,
    `/v1/support/subscriptions/${encodeURIComponent(id)}/cancellation-challenges`,
    undefined,
    options,
  );
  assertChallengeBoundary(challenge, context.config, {
    action: "subscription_cancel",
    actor: view.subscription.payer,
    boardroom: view.plan.boardroom,
    payload: {
      version: 1,
      action: "cancel",
      subscriptionId: id,
      planId: view.plan.id,
      boardroom: view.plan.boardroom.toLowerCase(),
      payer: view.subscription.payer.toLowerCase(),
    },
    planId: view.plan.id,
  });
  const signature = await signChallenge(context, challenge);
  const body = await supportRequest(
    `${context.config.baseUrl}/v1/support/subscriptions/${encodeURIComponent(id)}/cancel`,
    {
      body: { challengeId: challenge.challengeId, signature },
      fetch: options.fetch,
      method: "POST",
      signal: options.signal,
    },
  );
  const cancelled = supportSubscriptionViewValue(body);
  assertSubscriptionViewBoundary(cancelled, context.config);
  if (
    cancelled.subscription.id !== id
    || cancelled.subscription.status !== "cancelled"
  ) {
    throw new Error("The router cancelled a different support schedule.");
  }
  return cancelled;
}

export async function createRecurringSupportInvoiceQuote(
  context: HyperliquidCheckoutContext,
  request: RecurringSupportQuoteRequest,
  expectations: HyperliquidRouteExpectations,
  options: FetchOptions = {},
): Promise<HyperliquidMarketplaceQuote> {
  const invoiceId = uuidValue(request.invoiceId, "support invoice ID");
  if (
    expectations.target.toLowerCase()
      !== context.config.hyperevmUsdc.toLowerCase()
    || expectations.inputToken.toLowerCase()
      !== context.config.hyperevmUsdc.toLowerCase()
    || expectations.outputToken.toLowerCase()
      !== context.config.hyperevmUsdc.toLowerCase()
  ) {
    throw new Error(
      "The support invoice does not use the trusted HyperEVM USDC asset.",
    );
  }
  const body = await supportRequest(
    `${context.config.baseUrl}/v1/support/invoices/${encodeURIComponent(invoiceId)}/quotes`,
    {
      fetch: options.fetch,
      method: "POST",
      signal: options.signal,
    },
  );
  return assertHyperliquidMarketplaceQuoteMatchesRequest(
    parseHyperliquidMarketplaceQuote(body),
    request,
    expectations,
  );
}

export function recurringSupportQuoteRequest(
  view: RecurringSupportSubscriptionView,
): RecurringSupportQuoteRequest | undefined {
  const invoice = view.invoice;
  if (
    !invoice
    || invoice.status === "paid"
    || invoice.status === "cancelled"
    || invoice.status === "manual_intervention"
    || view.subscription.status !== "active"
    || view.plan.status !== "active"
  ) {
    return undefined;
  }
  return {
    amount: invoice.amount,
    boardroom: invoice.boardroom,
    chainId: 998,
    invoiceId: invoice.id,
    kind: "recurring_support",
    maxSlippageBps: 0,
    payer: invoice.payer,
    recipient: invoice.payer,
    refundAddress: invoice.payer,
  };
}

export function recurringSupportExpectations(
  view: RecurringSupportSubscriptionView,
): HyperliquidRouteExpectations | undefined {
  const invoice = view.invoice;
  if (!invoice) return undefined;
  return {
    inputToken: invoice.asset,
    outputToken: invoice.asset,
    target: invoice.asset,
  };
}

export function recurringSupportSubscriptionStorageKey(
  config: Pick<X402RouterConfig, "gateway">,
  boardroom: Address,
  payer: Address,
  planId: string,
): string {
  return [
    SUPPORT_SUBSCRIPTION_STORAGE_PREFIX,
    config.gateway.toLowerCase(),
    boardroom.toLowerCase(),
    payer.toLowerCase(),
    uuidValue(planId, "support plan ID"),
  ].join(":");
}

export function saveRecurringSupportSubscription(
  storage: Pick<Storage, "setItem">,
  config: Pick<X402RouterConfig, "gateway">,
  view: RecurringSupportSubscriptionView,
): void {
  storage.setItem(
    recurringSupportSubscriptionStorageKey(
      config,
      view.plan.boardroom,
      view.subscription.payer,
      view.plan.id,
    ),
    JSON.stringify({
      id: view.subscription.id,
      version: 1,
    }),
  );
}

export function assertRecurringSupportStorageAvailable(
  storage: Pick<Storage, "getItem" | "removeItem" | "setItem">,
): void {
  const key = `${SUPPORT_SUBSCRIPTION_STORAGE_PREFIX}:probe:${crypto.randomUUID()}`;
  storage.setItem(key, "1");
  const preserved = storage.getItem(key) === "1";
  storage.removeItem(key);
  if (!preserved) {
    throw new Error("Browser storage could not preserve the support schedule.");
  }
}

export function loadRecurringSupportSubscriptionId(
  storage: Pick<Storage, "getItem">,
  config: Pick<X402RouterConfig, "gateway">,
  boardroom: Address,
  payer: Address,
  planId: string,
): string | undefined {
  const serialized = storage.getItem(
    recurringSupportSubscriptionStorageKey(
      config,
      boardroom,
      payer,
      planId,
    ),
  );
  if (!serialized) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch {
    throw new Error("Stored recurring-support subscription data is unreadable.");
  }
  const record = objectValue(value, "stored support subscription");
  if (record.version !== 1) {
    throw new Error("Stored recurring-support subscription data has an unsupported version.");
  }
  return uuidValue(record.id, "stored support subscription ID");
}

async function createChallenge(
  config: X402RouterConfig,
  path: string,
  body: unknown,
  options: FetchOptions,
): Promise<RecurringSupportChallenge> {
  const response = await supportRequest(`${config.baseUrl}${path}`, {
    ...(body === undefined ? {} : { body }),
    fetch: options.fetch,
    method: "POST",
    signal: options.signal,
  });
  return supportChallengeValue(response);
}

async function signChallenge(
  context: HyperliquidCheckoutContext,
  challenge: RecurringSupportChallenge,
): Promise<Hex> {
  const wallet = context.walletClient();
  const account = wallet.account?.address;
  if (!account || account.toLowerCase() !== challenge.actor.toLowerCase()) {
    throw new Error("The active wallet is not the signer required by this support action.");
  }
  return (wallet.signMessage as unknown as (input: {
    account: Address;
    message: string;
  }) => Promise<Hex>)({
    account: getAddress(account),
    message: challenge.message,
  });
}

function assertChallengeBoundary(
  challenge: RecurringSupportChallenge,
  config: X402RouterConfig,
  expected: {
    action: RecurringSupportChallenge["action"];
    actor: Address;
    boardroom: Address;
    payload: Record<string, unknown>;
    planId: string;
  },
): void {
  const payloadHash = keccak256(
    stringToHex(JSON.stringify(canonicalJson(challenge.payload))),
  );
  if (
    challenge.action !== expected.action
    || challenge.actor.toLowerCase() !== expected.actor.toLowerCase()
    || challenge.boardroom.toLowerCase() !== expected.boardroom.toLowerCase()
    || challenge.planId !== expected.planId
    || payloadHash.toLowerCase() !== challenge.payloadHash.toLowerCase()
    || JSON.stringify(canonicalJson(challenge.payload))
      !== JSON.stringify(canonicalJson(expected.payload))
  ) {
    throw new Error("The router challenge changed the requested support action.");
  }
  const expiry = Date.parse(challenge.expiresAt);
  const now = Date.now();
  if (expiry <= now || expiry > now + 5 * 60 * 1_000 + 5_000) {
    throw new Error("The router challenge has an invalid expiry.");
  }
  const expectedMessage = buildChallengeMessage({
    action: challenge.action,
    actor: challenge.actor,
    boardroom: challenge.boardroom,
    chainId: challenge.chainId,
    challengeId: challenge.challengeId,
    expiresAt: challenge.expiresAt,
    origin: config.baseUrl,
    payloadHash: challenge.payloadHash,
    planId: challenge.planId,
  });
  if (challenge.message !== expectedMessage) {
    throw new Error("The router challenge message changed the signed support terms.");
  }
}

function buildChallengeMessage(input: {
  action: RecurringSupportChallenge["action"];
  actor: Address;
  boardroom: Address;
  chainId: 998;
  challengeId: string;
  expiresAt: string;
  origin: string;
  payloadHash: Hex;
  planId: string;
}): string {
  const action = input.action === "plan_create"
    ? "Publish support plan"
    : input.action === "plan_retire"
      ? "Retire support plan"
      : input.action === "subscription_create"
        ? "Create support subscription"
        : "Cancel support subscription";
  const scope = input.action === "subscription_create"
    ? "This records a monthly schedule. It cannot move funds or approve future payments."
    : input.action === "subscription_cancel"
      ? "This stops future unpaid invoices. It cannot reverse a settled payment."
      : input.action === "plan_create"
        ? "This publishes immutable support terms for this Boardroom."
        : "This retires the plan and stops new invoices.";
  return [
    "pledge.cash recurring support",
    "",
    `Action: ${action}`,
    `Actor: ${input.actor}`,
    `Chain ID: ${input.chainId}`,
    `Boardroom: ${input.boardroom}`,
    `Plan ID: ${input.planId}`,
    `Payload hash: ${input.payloadHash}`,
    `Challenge ID: ${input.challengeId}`,
    `Origin: ${input.origin}`,
    `Expires at: ${input.expiresAt}`,
    "",
    scope,
    "Every contribution still requires a separate x402 payment signature.",
  ].join("\n");
}

async function supportRequest(
  url: string,
  options: {
    body?: unknown;
    fetch?: typeof globalThis.fetch | undefined;
    method?: "GET" | "POST";
    signal?: AbortSignal | undefined;
  },
): Promise<unknown> {
  const response = await (options.fetch ?? globalThis.fetch)(url, {
    ...(options.body === undefined
      ? {}
      : {
          body: JSON.stringify(options.body),
          headers: { "content-type": "application/json" },
        }),
    method: options.method ?? "GET",
    ...(options.signal ? { signal: options.signal } : {}),
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`The recurring-support API returned HTTP ${response.status.toString()} without JSON.`);
  }
  if (!response.ok) {
    const record = isObject(body) ? body : undefined;
    const error = record && isObject(record.error) ? record.error : undefined;
    const message = error && typeof error.message === "string"
      ? error.message
      : "The recurring-support request failed.";
    throw new Error(`${message} (HTTP ${response.status.toString()})`);
  }
  return body;
}

function supportChallengeValue(value: unknown): RecurringSupportChallenge {
  const record = objectValue(value, "support challenge");
  const action = record.action;
  if (
    action !== "plan_create"
    && action !== "plan_retire"
    && action !== "subscription_create"
    && action !== "subscription_cancel"
  ) {
    throw new Error("The router returned an invalid support challenge action.");
  }
  return {
    challengeId: uuidValue(record.challengeId, "support challenge ID"),
    action,
    actor: addressValue(record.actor, "support challenge actor"),
    boardroom: addressValue(record.boardroom, "support challenge Boardroom"),
    chainId: literal998(record.chainId),
    planId: uuidValue(record.planId, "support plan ID"),
    message: nonemptyString(record.message, "support challenge message"),
    payload: objectValue(record.payload, "support challenge payload"),
    payloadHash: hashValue(record.payloadHash, "support payload hash"),
    expiresAt: dateTimeValue(record.expiresAt, "support challenge expiry"),
  };
}

function supportPlanValue(value: unknown): RecurringSupportPlan {
  const record = objectValue(value, "support plan");
  const status = record.status;
  const authorityMode = record.authorityMode;
  if (status !== "active" && status !== "retired") {
    throw new Error("The router returned an invalid support plan status.");
  }
  if (
    authorityMode !== "prelaunch_owner"
    && authorityMode !== "launched_controller"
  ) {
    throw new Error("The router returned an invalid support plan authority.");
  }
  return {
    id: uuidValue(record.id, "support plan ID"),
    chainId: literal998(record.chainId),
    boardroom: addressValue(record.boardroom, "support plan Boardroom"),
    asset: addressValue(record.asset, "support plan asset"),
    amount: positiveDecimal(record.amount, "support plan amount"),
    cadence: literalMonthly(record.cadence),
    title: boundedString(record.title, "support plan title", 80),
    description: boundedString(
      record.description,
      "support plan description",
      280,
    ),
    termsHash: hashValue(record.termsHash, "support plan terms hash"),
    status,
    authority: addressValue(record.authority, "support plan authority"),
    authorityMode,
    createdAt: dateTimeValue(record.createdAt, "support plan creation"),
    ...(record.retiredAt === undefined
      ? {}
      : { retiredAt: dateTimeValue(record.retiredAt, "support plan retirement") }),
  };
}

function supportSubscriptionViewValue(
  value: unknown,
): RecurringSupportSubscriptionView {
  const record = objectValue(value, "support subscription response");
  const subscriptionRecord = objectValue(
    record.subscription,
    "support subscription",
  );
  const status = subscriptionRecord.status;
  if (status !== "active" && status !== "cancelled") {
    throw new Error("The router returned an invalid support subscription status.");
  }
  return {
    plan: supportPlanValue(record.plan),
    subscription: {
      id: uuidValue(subscriptionRecord.id, "support subscription ID"),
      planId: uuidValue(subscriptionRecord.planId, "support plan ID"),
      payer: addressValue(subscriptionRecord.payer, "support payer"),
      status,
      startedAt: dateTimeValue(
        subscriptionRecord.startedAt,
        "support subscription start",
      ),
      createdAt: dateTimeValue(
        subscriptionRecord.createdAt,
        "support subscription creation",
      ),
      ...(subscriptionRecord.cancelledAt === undefined
        ? {}
        : {
            cancelledAt: dateTimeValue(
              subscriptionRecord.cancelledAt,
              "support subscription cancellation",
            ),
          }),
    },
    ...(record.invoice === undefined
      ? {}
      : { invoice: supportInvoiceValue(record.invoice) }),
  };
}

function assertPlanBoundary(
  plan: RecurringSupportPlan,
  config: X402RouterConfig,
  boardroom: Address,
): void {
  if (
    plan.chainId !== 998
    || plan.boardroom.toLowerCase() !== boardroom.toLowerCase()
    || plan.asset.toLowerCase() !== config.hyperevmUsdc.toLowerCase()
  ) {
    throw new Error(
      "The support plan does not match the trusted Boardroom and HyperEVM USDC route.",
    );
  }
}

function assertSubscriptionViewBoundary(
  view: RecurringSupportSubscriptionView,
  config: X402RouterConfig,
): void {
  assertPlanBoundary(view.plan, config, view.plan.boardroom);
  if (view.subscription.planId !== view.plan.id) {
    throw new Error("The support schedule belongs to a different plan.");
  }
  const invoice = view.invoice;
  if (!invoice) return;
  if (
    invoice.subscriptionId !== view.subscription.id
    || invoice.planId !== view.plan.id
    || invoice.payer.toLowerCase() !== view.subscription.payer.toLowerCase()
    || invoice.boardroom.toLowerCase() !== view.plan.boardroom.toLowerCase()
    || invoice.asset.toLowerCase() !== config.hyperevmUsdc.toLowerCase()
    || invoice.amount !== view.plan.amount
    || invoice.dueAt !== invoice.periodStart
    || Date.parse(invoice.periodEnd) <= Date.parse(invoice.periodStart)
  ) {
    throw new Error(
      "The support invoice does not match its immutable plan and schedule.",
    );
  }
}

function supportInvoiceValue(value: unknown): RecurringSupportInvoice {
  const record = objectValue(value, "support invoice");
  const status = record.status;
  if (
    status !== "open"
    && status !== "payment_pending"
    && status !== "paid"
    && status !== "cancelled"
    && status !== "manual_intervention"
  ) {
    throw new Error("The router returned an invalid support invoice status.");
  }
  const lastAttemptStatus = record.lastAttemptStatus;
  if (
    lastAttemptStatus !== undefined
    && lastAttemptStatus !== "refunded"
    && lastAttemptStatus !== "payment_failed"
  ) {
    throw new Error("The router returned an invalid support attempt status.");
  }
  return {
    id: uuidValue(record.id, "support invoice ID"),
    subscriptionId: uuidValue(
      record.subscriptionId,
      "support subscription ID",
    ),
    planId: uuidValue(record.planId, "support plan ID"),
    periodIndex: nonnegativeInteger(record.periodIndex, "support period index"),
    periodStart: dateTimeValue(record.periodStart, "support period start"),
    periodEnd: dateTimeValue(record.periodEnd, "support period end"),
    dueAt: dateTimeValue(record.dueAt, "support invoice due date"),
    payer: addressValue(record.payer, "support invoice payer"),
    boardroom: addressValue(record.boardroom, "support invoice Boardroom"),
    asset: addressValue(record.asset, "support invoice asset"),
    amount: positiveDecimal(record.amount, "support invoice amount"),
    status,
    ...(record.latestQuoteId === undefined
      ? {}
      : {
          latestQuoteId: nonemptyString(
            record.latestQuoteId,
            "support quote ID",
          ),
        }),
    ...(lastAttemptStatus ? { lastAttemptStatus } : {}),
  };
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

function hashValue(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/i.test(value)) {
    throw new Error(`The router returned an invalid ${label}.`);
  }
  return value.toLowerCase() as Hex;
}

function uuidValue(value: unknown, label: string): string {
  if (
    typeof value !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new Error(`The router returned an invalid ${label}.`);
  }
  return value.toLowerCase();
}

function dateTimeValue(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`The router returned an invalid ${label}.`);
  }
  return value;
}

function nonemptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`The router returned an invalid ${label}.`);
  }
  return value;
}

function boundedString(
  value: unknown,
  label: string,
  maximum: number,
): string {
  const text = nonemptyString(value, label);
  if (text.trim() !== text || text.length > maximum) {
    throw new Error(`The router returned an invalid ${label}.`);
  }
  return text;
}

function positiveDecimal(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`The router returned an invalid ${label}.`);
  }
  return value;
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`The router returned an invalid ${label}.`);
  }
  return value as number;
}

function literal998(value: unknown): 998 {
  if (value !== 998) throw new Error("The router returned an unsupported support chain.");
  return value;
}

function literalMonthly(value: unknown): "monthly" {
  if (value !== "monthly") {
    throw new Error("The router returned an unsupported support cadence.");
  }
  return value;
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalJson(item)]),
  );
}
