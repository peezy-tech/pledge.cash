import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

export const HYPERLIQUID_TESTNET = "hyperliquid:testnet" as const;
export const HYPERLIQUID_TESTNET_USDC =
  "USDC:0xeb62eee3685fc4c43992febcd9e75443" as const;
export const HYPEREVM_TESTNET_CHAIN_ID = 998 as const;

const privateKeySchema = z
  .string()
  .trim()
  .regex(/^0x[0-9a-fA-F]{64}$/, "Expected a 32-byte 0x-prefixed private key")
  .refine((value) => !/^0x0{64}$/i.test(value), "Private key must not be zero")
  .transform((value) => value as Hex);

const journalEncryptionKeySchema = z
  .string()
  .trim()
  .regex(/^(?:0x)?[0-9a-fA-F]{64}$/, "Expected exactly 32 bytes encoded as hexadecimal")
  .transform((value) => {
    const hex = value.startsWith("0x") ? value : `0x${value}`;
    return hex.toLowerCase() as Hex;
  });

const addressSchema = z
  .string()
  .trim()
  .regex(/^0x[0-9a-fA-F]{40}$/, "Expected a 20-byte 0x-prefixed address")
  .transform((value, context) => {
    try {
      return getAddress(value);
    } catch {
      context.addIssue({ code: "custom", message: "Invalid EVM address checksum" });
      return z.NEVER;
    }
  });

const positiveDecimalSchema = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]*$/, "Expected a positive decimal integer")
  .max(78)
  .transform((value) => BigInt(value));

const optionalStringSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional()
);

const postgresUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "postgres:" || protocol === "postgresql:";
  }, "Expected a postgres:// or postgresql:// URL");

export const x402RouterEnvSchema = z
  .object({
    DATABASE_URL: postgresUrlSchema,
    X402_ROUTER_PORT: z.coerce.number().int().positive().max(65_535).default(8788),
    X402_ROUTER_PUBLIC_ORIGIN: z.string().url(),
    X402_ROUTER_WEB_ORIGIN: z.string().url(),
    X402_ROUTER_APPLICATION: z.string().trim().min(1).max(256),
    X402_ROUTER_GATEWAY_ADDRESS: addressSchema,
    X402_ROUTER_JOURNAL_ENCRYPTION_KEY: journalEncryptionKeySchema,

    HYPERLIQUID_NETWORK: z.literal(HYPERLIQUID_TESTNET).default(HYPERLIQUID_TESTNET),
    HYPERLIQUID_PAY_TO_ADDRESS: addressSchema,
    HYPERLIQUID_REFUND_PRIVATE_KEY: privateKeySchema,
    X402_ROUTER_PAYMENT_ASSET: z
      .literal(HYPERLIQUID_TESTNET_USDC)
      .default(HYPERLIQUID_TESTNET_USDC),
    X402_ROUTER_PAYMENT_DECIMALS: z.coerce.number().int().min(0).max(255).default(8),

    HYPEREVM_CHAIN_ID: z.coerce
      .number()
      .int()
      .refine((value) => value === HYPEREVM_TESTNET_CHAIN_ID, {
        message: `V1 supports HyperEVM testnet chain ${HYPEREVM_TESTNET_CHAIN_ID.toString()} only`
      })
      .default(HYPEREVM_TESTNET_CHAIN_ID),
    HYPEREVM_RPC_URL: z.string().url().default("https://rpc.hyperliquid-testnet.xyz/evm"),
    X402_ROUTER_HYPEREVM_USDC_ADDRESS: addressSchema,
    HYPEREVM_EXECUTOR_PRIVATE_KEY: privateKeySchema,
    HYPEREVM_CONFIRMATIONS: z.coerce.number().int().positive().max(64).default(1),
    HYPEREVM_RECEIPT_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .max(600_000)
      .default(120_000),
    HYPEREVM_MIN_GAS_BALANCE_WEI: positiveDecimalSchema.default("100000000000000000"),

    X402_ROUTER_QUOTE_TTL_SECONDS: z.coerce.number().int().min(30).max(300).default(300),
    X402_ROUTER_MAX_ORDER_ATOMIC: positiveDecimalSchema,
    X402_ROUTER_SERVICE_FEE_BPS: z.coerce.number().int().min(0).max(1_000),
    X402_ROUTER_MIN_REFUND_RESERVE_ATOMIC: positiveDecimalSchema,
    X402_ROUTER_MAX_GAS_COST_WEI: positiveDecimalSchema.default("2500000000000000"),
    X402_ROUTER_MAX_SLIPPAGE_BPS: z.coerce.number().int().min(0).max(10_000).default(100),
    X402_ROUTER_OPERATION_LEASE_MS: z.coerce
      .number()
      .int()
      .positive()
      .max(3_600_000)
      .default(60_000),

    // Explicitly ignored legacy/general-purpose key names are accepted by
    // passthrough, but never read. Every signing authority is service-specific.
    PRIVATE_KEY: optionalStringSchema
  })
  .passthrough();

export type X402RouterEnv = z.input<typeof x402RouterEnvSchema>;

export type X402RouterConfig = {
  readonly databaseUrl: string;
  readonly port: number;
  readonly publicOrigin: string;
  readonly webOrigin: string;
  readonly intentDomain: {
    readonly application: string;
    readonly gateway: Address;
  };
  readonly journalEncryptionKey: Hex;
  readonly hyperliquid: {
    readonly network: typeof HYPERLIQUID_TESTNET;
    readonly payTo: Address;
    readonly refundPrivateKey: Hex;
    readonly refundAccount: Address;
    readonly paymentAsset: typeof HYPERLIQUID_TESTNET_USDC;
    readonly paymentDecimals: 8;
    readonly minimumRefundReserveAtomic: bigint;
  };
  readonly hyperevm: {
    readonly chainId: typeof HYPEREVM_TESTNET_CHAIN_ID;
    readonly rpcUrl: string;
    readonly destinationUsdc: Address;
    readonly executorPrivateKey: Hex;
    readonly executor: Address;
    readonly confirmations: number;
    readonly receiptTimeoutMs: number;
    readonly minimumGasBalanceWei: bigint;
  };
  readonly quotes: {
    readonly ttlSeconds: number;
    readonly maximumOrderAtomic: bigint;
    readonly serviceFeeBps: number;
    readonly maximumGasCostWei: bigint;
    readonly maximumSlippageBps: number;
  };
  readonly operationLeaseMs: number;
};

function readOrigin(value: string, name: string): string {
  const url = new URL(value);
  if (
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(`${name} must be an origin without a path, query, or fragment`);
  }
  const local =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error(`${name} must use HTTPS outside localhost`);
  }
  return url.origin;
}

function readRpcUrl(value: string): string {
  const url = new URL(value);
  if (url.username !== "" || url.password !== "" || url.hash !== "") {
    throw new Error(
      "HYPEREVM_RPC_URL cannot contain user information or a fragment",
    );
  }
  const local =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("HYPEREVM_RPC_URL must use HTTPS outside localhost");
  }
  return url.toString();
}

function sameAddress(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env
): X402RouterConfig {
  const raw = x402RouterEnvSchema.parse(env);
  const executor = privateKeyToAccount(raw.HYPEREVM_EXECUTOR_PRIVATE_KEY).address;
  const refundAccount = privateKeyToAccount(raw.HYPERLIQUID_REFUND_PRIVATE_KEY).address;

  if (!sameAddress(executor, raw.X402_ROUTER_GATEWAY_ADDRESS)) {
    throw new Error(
      "X402_ROUTER_GATEWAY_ADDRESS must match the account derived from HYPEREVM_EXECUTOR_PRIVATE_KEY"
    );
  }
  if (!sameAddress(refundAccount, raw.HYPERLIQUID_PAY_TO_ADDRESS)) {
    throw new Error(
      "HYPERLIQUID_PAY_TO_ADDRESS must match the account derived from HYPERLIQUID_REFUND_PRIVATE_KEY"
    );
  }
  if (raw.X402_ROUTER_PAYMENT_DECIMALS !== 8) {
    throw new Error("Hyperliquid testnet USDC must use 8 payment decimals");
  }

  return {
    databaseUrl: raw.DATABASE_URL,
    port: raw.X402_ROUTER_PORT,
    publicOrigin: readOrigin(raw.X402_ROUTER_PUBLIC_ORIGIN, "X402_ROUTER_PUBLIC_ORIGIN"),
    webOrigin: readOrigin(raw.X402_ROUTER_WEB_ORIGIN, "X402_ROUTER_WEB_ORIGIN"),
    intentDomain: {
      application: raw.X402_ROUTER_APPLICATION,
      gateway: raw.X402_ROUTER_GATEWAY_ADDRESS
    },
    journalEncryptionKey: raw.X402_ROUTER_JOURNAL_ENCRYPTION_KEY,
    hyperliquid: {
      network: HYPERLIQUID_TESTNET,
      payTo: raw.HYPERLIQUID_PAY_TO_ADDRESS,
      refundPrivateKey: raw.HYPERLIQUID_REFUND_PRIVATE_KEY,
      refundAccount,
      paymentAsset: HYPERLIQUID_TESTNET_USDC,
      paymentDecimals: 8,
      minimumRefundReserveAtomic: raw.X402_ROUTER_MIN_REFUND_RESERVE_ATOMIC
    },
    hyperevm: {
      chainId: HYPEREVM_TESTNET_CHAIN_ID,
      rpcUrl: readRpcUrl(raw.HYPEREVM_RPC_URL),
      destinationUsdc: raw.X402_ROUTER_HYPEREVM_USDC_ADDRESS,
      executorPrivateKey: raw.HYPEREVM_EXECUTOR_PRIVATE_KEY,
      executor,
      confirmations: raw.HYPEREVM_CONFIRMATIONS,
      receiptTimeoutMs: raw.HYPEREVM_RECEIPT_TIMEOUT_MS,
      minimumGasBalanceWei: raw.HYPEREVM_MIN_GAS_BALANCE_WEI
    },
    quotes: {
      ttlSeconds: raw.X402_ROUTER_QUOTE_TTL_SECONDS,
      maximumOrderAtomic: raw.X402_ROUTER_MAX_ORDER_ATOMIC,
      serviceFeeBps: raw.X402_ROUTER_SERVICE_FEE_BPS,
      maximumGasCostWei: raw.X402_ROUTER_MAX_GAS_COST_WEI,
      maximumSlippageBps: raw.X402_ROUTER_MAX_SLIPPAGE_BPS
    },
    operationLeaseMs: raw.X402_ROUTER_OPERATION_LEASE_MS
  };
}
