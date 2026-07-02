import { erc20Abi, isZeroAddress, type Address, type PledgeCashReadClient } from "@pledge.cash/sdk";
import { isAddress, type PublicClient } from "viem";
import { readBoardroomSnapshot } from "./boardroom-snapshot";
import { errorMessage } from "./forms";
import { formatNativeTokenAmount, formatTokenAmount } from "./token-amounts";
import type { BoardroomSnapshot } from "./types";

export type ProductBoardroomSeed = {
  boardroom?: Address | undefined;
  boardroomOwner?: Address | undefined;
  boardroomShareToken?: Address | undefined;
  cashToken?: Address | undefined;
  equityToken?: Address | undefined;
  directPartiallySettledGrant?: Address | undefined;
  directTransferredPaidGrant?: Address | undefined;
  directHaltedGrant?: Address | undefined;
  boardroomShareGrant?: Address | undefined;
  boardroomShareSaleGrant?: Address | undefined;
  boardroomPayrollGrant?: Address | undefined;
  seedNonce?: number | undefined;
};

export type ProductTreasuryAsset = {
  address: Address;
  label: string;
  balance?: bigint;
  decimals?: number;
  symbol?: string;
  totalSupply?: bigint;
  error?: string;
};

export type ProductBoardroomDashboardState = {
  address: Address;
  nativeBalance: bigint;
  seed?: ProductBoardroomSeed | undefined;
  snapshot: BoardroomSnapshot;
  treasuryAssets: ProductTreasuryAsset[];
};

type ProductBoardroomClient = PledgeCashReadClient & Pick<PublicClient, "getBalance">;

export async function loadProductBoardroomSeed(chainId: number): Promise<ProductBoardroomSeed | undefined> {
  const response = await fetch(`${import.meta.env.BASE_URL}deployments/${chainId}.seed.json`, { cache: "no-store" });
  if (!response.ok) return undefined;

  const raw = await readJsonObjectResponse(response);
  if (!raw) return undefined;

  return {
    boardroom: addressField(raw.boardroom),
    boardroomOwner: addressField(raw.boardroomOwner),
    boardroomShareToken: addressField(raw.boardroomShareToken),
    cashToken: addressField(raw.cashToken),
    equityToken: addressField(raw.equityToken),
    directPartiallySettledGrant: addressField(raw.directPartiallySettledGrant),
    directTransferredPaidGrant: addressField(raw.directTransferredPaidGrant),
    directHaltedGrant: addressField(raw.directHaltedGrant),
    boardroomShareGrant: addressField(raw.boardroomShareGrant),
    boardroomShareSaleGrant: addressField(raw.boardroomShareSaleGrant),
    boardroomPayrollGrant: addressField(raw.boardroomPayrollGrant),
    seedNonce: typeof raw.seedNonce === "number" ? raw.seedNonce : undefined,
  };
}

export async function readJsonObjectResponse(response: Response): Promise<Record<string, unknown> | undefined> {
  const contentType = response.headers.get("content-type") ?? "";
  const raw = await response.text();
  const trimmed = raw.trimStart();

  if (!contentType.includes("application/json") && !trimmed.startsWith("{")) {
    return undefined;
  }

  const parsed = JSON.parse(raw) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
}

export async function readProductBoardroomDashboard(
  client: ProductBoardroomClient,
  input: { address: Address; seed?: ProductBoardroomSeed | undefined },
): Promise<ProductBoardroomDashboardState> {
  const [snapshot, nativeBalance] = await Promise.all([
    readBoardroomSnapshot(client, input.address),
    client.getBalance({ address: input.address }),
  ]);
  const treasuryAssets = await readTreasuryAssets(client, snapshot, input.seed);

  return {
    address: input.address,
    nativeBalance,
    seed: input.seed,
    snapshot,
    treasuryAssets,
  };
}

export function resolveProductBoardroomAddress(seed: ProductBoardroomSeed | undefined): Address | undefined {
  const configured = import.meta.env.VITE_PLEDGE_CASH_PRODUCT_BOARDROOM_ADDRESS;
  if (typeof configured === "string" && isAddress(configured)) return configured;
  return seed?.boardroom;
}

export function formatTokenBalance(asset: ProductTreasuryAsset): string {
  return formatTokenAmount(asset.balance, asset);
}

export function formatNativeBalance(balance: bigint): string {
  return formatNativeTokenAmount(balance);
}

async function readTreasuryAssets(
  client: PledgeCashReadClient,
  snapshot: BoardroomSnapshot,
  seed: ProductBoardroomSeed | undefined,
): Promise<ProductTreasuryAsset[]> {
  const labels = new Map<Address, string>();
  addAsset(labels, snapshot.shareToken, "Treasury shares");
  addAsset(labels, snapshot.wrappedNative, "Wrapped native");
  addAsset(labels, seed?.cashToken, "Cash / quote");
  addAsset(labels, seed?.equityToken, "Equity seed");
  for (const asset of snapshot.redeemableAssets) {
    addAsset(labels, asset, "Redeemable asset");
  }
  for (const grant of snapshot.grantSummaries) {
    if (grant.state) {
      addAsset(labels, grant.state.token, grant.state.token.toLowerCase() === snapshot.shareToken.toLowerCase() ? "Treasury shares" : "Grant token");
      if (!isZeroAddress(grant.state.paymentToken)) {
        addAsset(labels, grant.state.paymentToken, "Revenue token");
      }
    }
  }

  return await Promise.all(
    Array.from(labels.entries()).map(async ([address, label]) => await readTreasuryAsset(client, snapshot.address, address, label)),
  );
}

async function readTreasuryAsset(
  client: PledgeCashReadClient,
  holder: Address,
  address: Address,
  label: string,
): Promise<ProductTreasuryAsset> {
  try {
    const [balance, symbol, decimals, totalSupply] = await Promise.all([
      client.readContract({ address, abi: erc20Abi, functionName: "balanceOf", args: [holder] }),
      client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
      client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
      client.readContract({ address, abi: erc20Abi, functionName: "totalSupply" }),
    ]);

    return {
      address,
      label,
      balance: balance as bigint,
      decimals: Number(decimals),
      symbol: symbol as string,
      totalSupply: totalSupply as bigint,
    };
  } catch (error) {
    return { address, label, error: errorMessage(error) };
  }
}

function addAsset(labels: Map<Address, string>, address: Address | undefined, label: string): void {
  if (!address || isZeroAddress(address)) return;
  const existing = Array.from(labels.keys()).find((key) => key.toLowerCase() === address.toLowerCase());
  if (existing) {
    if (labels.get(existing) === "Grant token" && label !== "Grant token") labels.set(existing, label);
    return;
  }
  labels.set(address, label);
}

function addressField(value: unknown): Address | undefined {
  return typeof value === "string" && isAddress(value) ? value : undefined;
}
