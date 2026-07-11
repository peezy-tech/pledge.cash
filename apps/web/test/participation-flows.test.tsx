import { describe, expect, test } from "bun:test";
import type { Address } from "@pledge.cash/sdk";
import { renderToString } from "react-dom/server";
import type { PublicClient } from "viem";
import {
  ParticipationFlows,
  createParticipationFlowContent,
  findParticipationDistribution,
  maximumWithSlippage,
  minimumWithSlippage,
  parseMerkleProof,
  parseSlippageBps,
  participationDistributionKey,
  transactionDeadline,
} from "../src/features/participation";
import { ParticipatePage, participationOptions } from "../src/app/pages";
import { Web3Provider } from "../src/components/web3-provider";
import { SwapPanel, deadlineIsFuture, remainingDeadlineMinutes } from "../src/features/swap/swap-panel";
import { shortAddress } from "../src/lib/forms";
import type { ProductBoardroomDashboardState } from "../src/lib/product-boardroom";
import { defaultLiquidityForm, defaultRemoveLiquidityForm, defaultSwapForm } from "../src/lib/swap";
import type { BoardroomDistributionSnapshot } from "../src/lib/types";

const boardroom = "0x1000000000000000000000000000000000000000" as Address;
const owner = "0x2000000000000000000000000000000000000000" as Address;
const shareToken = "0x3000000000000000000000000000000000000000" as Address;
const paymentToken = "0x4000000000000000000000000000000000000000" as Address;
const sale = "0x5000000000000000000000000000000000000000" as Address;
const oldSale = "0x5100000000000000000000000000000000000000" as Address;
const curve = "0x6000000000000000000000000000000000000000" as Address;
const airdrop = "0x7000000000000000000000000000000000000000" as Address;
const zeroAddress = "0x0000000000000000000000000000000000000000" as Address;
const zeroHash = `0x${"00".repeat(32)}` as const;

const fixedSaleDistribution: BoardroomDistributionSnapshot = {
  address: sale,
  kind: "fixed-price-sale",
  state: {
    address: sale,
    factory: owner,
    boardroom,
    shareToken,
    paymentToken,
    saleSupply: 10_000_000_000_000_000_000n,
    remainingShares: 8_000_000_000_000_000_000n,
    price: 3_000_000n,
    maxPerBuyer: 2_000_000_000_000_000_000n,
    startTime: 0n,
    endTime: 0n,
    saleStatus: 0,
    closed: false,
  },
  shareTokenMetadata: { address: shareToken, decimals: 18, symbol: "ATLAS" },
  paymentTokenMetadata: { address: paymentToken, decimals: 6, symbol: "USDC" },
};

const curveDistribution: BoardroomDistributionSnapshot = {
  address: curve,
  kind: "migrating-bonding-curve",
  state: {
    address: curve,
    factory: owner,
    boardroom,
    lockedLiquidityFactory: owner,
    shareToken,
    quoteToken: paymentToken,
    locker: zeroAddress,
    pool: zeroAddress,
    saleSupply: 10_000_000_000_000_000_000n,
    migrationSupply: 2_000_000_000_000_000_000n,
    remainingSaleShares: 8_000_000_000_000_000_000n,
    basePrice: 1_000_000n,
    slope: 1n,
    graduationQuoteTarget: 20_000_000n,
    quoteToLpBps: 5_000,
    startTime: 0n,
    endTime: 0n,
    migrationSalt: zeroHash,
    curveStatus: 0,
    soldShares: 2_000_000_000_000_000_000n,
    quoteReserve: 2_000_000n,
    graduationLatched: false,
    canMigrate: false,
    closed: false,
  },
  shareTokenMetadata: { address: shareToken, decimals: 18, symbol: "ATLAS" },
  quoteTokenMetadata: { address: paymentToken, decimals: 6, symbol: "USDC" },
};

const airdropDistribution: BoardroomDistributionSnapshot = {
  address: airdrop,
  kind: "merkle-airdrop",
  state: {
    address: airdrop,
    factory: owner,
    boardroom,
    shareToken,
    tokenGrantFactory: owner,
    airdropSupply: 5_000_000_000_000_000_000n,
    claimedShares: 1_000_000_000_000_000_000n,
    remainingShares: 4_000_000_000_000_000_000n,
    merkleRoot: zeroHash,
    startTime: 0n,
    endTime: 0n,
    maxGrantClaims: 10,
    claimedGrantCount: 2,
    airdropStatus: 0,
    closed: false,
  },
  shareTokenMetadata: { address: shareToken, decimals: 18, symbol: "ATLAS" },
};

const dashboard: ProductBoardroomDashboardState = {
  address: boardroom,
  catalog: [],
  nativeBalance: 0n,
  snapshot: {
    address: boardroom,
    owner,
    policyRegistry: owner,
    wrappedNative: owner,
    shareToken,
    status: 0,
    launched: true,
    executor: owner,
    governanceDelay: 86_400n,
    governanceEpoch: 1n,
    governanceEligibleSupply: 10_000_000_000_000_000_000n,
    governanceConfig: { minimumDelay: 86_400n, actionGracePeriod: 604_800n, vetoBps: 2_000n, windDownBps: 3_000n },
    redeemableAssets: [],
    issuedGrants: [],
    issuedDistributions: [sale, curve, airdrop],
    lockedLiquidityPositions: [],
    shareTokenMetadata: { address: shareToken, decimals: 18, symbol: "ATLAS" },
    grantSummaries: [],
    distributionSummaries: [fixedSaleDistribution, curveDistribution, airdropDistribution],
    lockedLiquiditySummaries: [],
  },
  treasuryAssets: [],
};

const publicClient = { readContract: async () => 0n } as unknown as PublicClient;
const context = {
  account: owner,
  dashboard,
  pendingAction: undefined,
  publicClient,
  runAction: async (_label: string, action: () => Promise<void>) => action(),
  submitTransaction: async () => undefined,
};

describe("participation bounds and proof parsing", () => {
  test("never presents an expired transaction deadline as future time", () => {
    expect(deadlineIsFuture("1000", 1000)).toBe(false);
    expect(remainingDeadlineMinutes("1000", 1000)).toBeUndefined();
    expect(deadlineIsFuture("2200.5", 1000)).toBe(false);
    expect(remainingDeadlineMinutes("2200.5", 1000)).toBeUndefined();
    expect(deadlineIsFuture("2200", 1000)).toBe(true);
    expect(remainingDeadlineMinutes("2200", 1000)).toBe(20);
  });

  test("rounds protective maximums up and minimums down", () => {
    expect(parseSlippageBps("0.25")).toBe(25n);
    expect(maximumWithSlippage(101n, 100n)).toBe(103n);
    expect(minimumWithSlippage(101n, 100n)).toBe(100n);
    expect(() => parseSlippageBps("50.01")).toThrow("between 0% and 50%");
    expect(transactionDeadline("20", 1_000)).toBe(2_200n);
  });

  test("accepts JSON or line-separated bytes32 proofs and rejects malformed nodes", () => {
    const nodeA = `0x${"11".repeat(32)}`;
    const nodeB = `0x${"22".repeat(32)}`;
    expect(parseMerkleProof(`["${nodeA}","${nodeB}"]`)).toEqual([nodeA, nodeB]);
    expect(parseMerkleProof(`${nodeA}\n${nodeB}`)).toEqual([nodeA, nodeB]);
    expect(parseMerkleProof("")).toEqual([]);
    expect(() => parseMerkleProof("0x1234")).toThrow("32-byte hex");
  });
});

describe("participation flow composition", () => {
  test("prefers a live distribution over older closed deployments", () => {
    const closed: BoardroomDistributionSnapshot = {
      ...fixedSaleDistribution,
      address: oldSale,
      state: fixedSaleDistribution.state && "saleStatus" in fixedSaleDistribution.state
        ? { ...fixedSaleDistribution.state, address: oldSale, saleStatus: 1, closed: true }
        : undefined,
    };
    expect(findParticipationDistribution([closed, fixedSaleDistribution], "fixed-price-sale")?.address).toBe(sale);
  });

  test("builds injectable content for every discovered buyer path", () => {
    const content = createParticipationFlowContent(context);
    const fixedKey = participationDistributionKey("fixed-price-sale", sale);
    const curveKey = participationDistributionKey("migrating-bonding-curve", curve);
    const airdropKey = participationDistributionKey("merkle-airdrop", airdrop);
    expect(Object.keys(content)).toEqual([fixedKey, curveKey, airdropKey]);

    const fixedHtml = renderToString(content[fixedKey]);
    expect(fixedHtml).toContain("Buy from the fixed-price sale");
    expect(fixedHtml).toContain("Expected payment");
    expect(fixedHtml).toContain("Advanced purchase settings");

    const curveHtml = renderToString(<ParticipationFlows {...context} path="migrating-bonding-curve" />);
    expect(curveHtml).toContain("Trade on the bonding curve");
    expect(curveHtml).toContain("Curve inventory");
    expect(curveHtml).toContain("sell only the tokens");
    expect(curveHtml).toContain("Advanced trade settings");

    const airdropHtml = renderToString(<ParticipationFlows {...context} path="merkle-airdrop" />);
    expect(airdropHtml).toContain("Claim an airdrop allocation");
    expect(airdropHtml).toContain("Proof and claim details");
    expect(airdropHtml).toContain("Grant claim slots");
  });

  test("puts a contextual wallet connection action inside disconnected sale and curve flows", () => {
    const disconnected = { ...context, account: undefined };
    const html = renderToString(
      <Web3Provider>
        <ParticipationFlows {...disconnected} path="fixed-price-sale" />
        <ParticipationFlows {...disconnected} path="migrating-bonding-curve" />
      </Web3Provider>,
    );

    expect(html).toContain("Connect wallet to continue");
    expect(html).toContain("purchase limit, payment balance, and allowance");
    expect(html).toContain("eligible sellable amount");
    expect(html.match(/aria-label="Connect Wallet"/g)?.length).toBe(2);
  });

  test("puts a contextual wallet connection action inside a disconnected AMM swap", () => {
    const noop = async (): Promise<void> => undefined;
    const html = renderToString(
      <Web3Provider>
        <SwapPanel
          account={undefined}
          deployment={undefined}
          form={defaultSwapForm()}
          liquidityForm={defaultLiquidityForm()}
          liquidityQuote={undefined}
          position={undefined}
          pendingAction={undefined}
          quote={undefined}
          removeLiquidityForm={defaultRemoveLiquidityForm()}
          removeLiquidityQuote={undefined}
          setLiquidityForm={() => undefined}
          setRemoveLiquidityForm={() => undefined}
          setForm={() => undefined}
          tokenList={{ loaded: false, pools: [], tokens: [] }}
          tokenListLoading={false}
          wrappedNativeSymbol="WETH"
          mode="swap"
          addLiquidity={noop}
          approveLiquidityTokenA={noop}
          approveLiquidityTokenB={noop}
          approveLpToken={noop}
          approveInput={noop}
          claimAmmFees={noop}
          executeSwap={noop}
          refreshLiquidityQuote={noop}
          refreshPosition={noop}
          refreshQuote={noop}
          refreshRemoveLiquidityQuote={noop}
          refreshTokens={noop}
          removeLiquidity={noop}
          runAction={async (_label, action) => action()}
        />
      </Web3Provider>,
    );

    expect(html).toContain("Connect wallet to continue");
    expect(html).toContain("fund the swap");
    expect(html).toContain('aria-label="Connect Wallet"');
    expect(html).toContain("Slippage tolerance");
    expect(html).toContain("0.5%");
    expect(html).toContain("Quote expires in");
    expect(html).toContain('<option value="20" selected="">20');
    expect(html).toContain("Advanced transaction details");
    expect(html).not.toContain("Slippage bps");
    expect(html).not.toContain("Native swap");
    expect(html).not.toContain("Native asset handling");
  });

  test("keeps every same-type distribution address-scoped and renders the selected contract", () => {
    const closedSale: BoardroomDistributionSnapshot = {
      ...fixedSaleDistribution,
      address: oldSale,
      state: fixedSaleDistribution.state && "saleStatus" in fixedSaleDistribution.state
        ? { ...fixedSaleDistribution.state, address: oldSale, closed: true, saleStatus: 1 }
        : undefined,
    };
    const multiSaleDashboard: ProductBoardroomDashboardState = {
      ...dashboard,
      snapshot: {
        ...dashboard.snapshot,
        issuedDistributions: [oldSale, sale, curve, airdrop],
        distributionSummaries: [closedSale, fixedSaleDistribution, curveDistribution, airdropDistribution],
      },
    };
    const multiSaleContext = { ...context, dashboard: multiSaleDashboard };
    const content = createParticipationFlowContent(multiSaleContext);
    const activeKey = participationDistributionKey("fixed-price-sale", sale);
    const closedKey = participationDistributionKey("fixed-price-sale", oldSale);

    expect(Object.keys(content)).toContain(activeKey);
    expect(Object.keys(content)).toContain(closedKey);
    expect(participationOptions(multiSaleDashboard, content).filter((option) => option.path === "fixed-price-sale").map((option) => option.address))
      .toEqual([sale, oldSale]);

    const activeHtml = renderToString(content[activeKey]);
    const closedHtml = renderToString(content[closedKey]);
    expect(activeHtml).toContain(sale);
    expect(activeHtml).not.toContain(oldSale);
    expect(closedHtml).toContain(oldSale);
    expect(closedHtml).not.toContain(sale);

    const pageHtml = renderToString(
      <ParticipatePage
        content={content}
        dashboard={multiSaleDashboard}
        loading={false}
        selectedRoute={closedKey}
      />,
    );
    expect(pageHtml).toContain(shortAddress(sale));
    expect(pageHtml).toContain(shortAddress(oldSale));
    expect(pageHtml).toContain('aria-pressed="true"');
  });
});
