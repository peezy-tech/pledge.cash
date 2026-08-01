import { describe, expect, test } from "bun:test";
import {
  fixedPriceSaleAbi,
  migratingBondingCurveAbi,
  pledgeV4LiquidityVaultAbi,
  type PledgeCashLogClient
} from "@pledge.cash/sdk";
import { encodeFunctionData, type Address, type Hex } from "viem";

import {
  marketStateUpdateForEvent,
  queryMarketLifecycleEvents
} from "../src/chain/market-events";
import { decodeKnownCall } from "../src/chain/watcher";

const boardroom = address("b0a4d");
const otherBoardroom = address("b0a4e");
const curve = address("c011");
const spoofCurve = address("bad");
const vault = address("10cc");
const poolId = hex32("a110");
const quote = address("a55e7");
const factory = address("fac");
const txHash = hex32("123");
const salt = hex32("44");

describe("market lifecycle projector", () => {
  test("projects only canonically bound Boardroom, curve, factory, and v4 vault sources", async () => {
    const logs: RawLog[] = [
      rawLog("BondingCurvePrecommitted", boardroom, 1n, 0, { curve, quoteAsset: quote, fundingAmount: 100n }),
      rawLog("ProtocolLiquidityReserved", boardroom, 1n, 1, {
        expectedVault: vault,
        expectedPoolId: poolId,
        quoteAsset: quote,
        curve,
        salt,
        expiresAt: 1_000n
      }),
      rawLog("MigrationReserved", factory, 1n, 2, {
        boardroom,
        curve,
        expectedVault: vault,
        expectedPoolId: poolId,
        salt
      }),
      rawLog("CurvePhaseChanged", curve, 2n, 0, { phase: 1, reason: 0, phaseEndsAt: 2_000n }),
      rawLog("QuoteForfeitureOpened", curve, 3n, 0, { windowEndsAt: 3_000n }),
      rawLog("FeesForwarded", vault, 3n, 1, {
        boardroom,
        protocolFeeRecipient: quote,
        boardroomAmount0: 3n,
        boardroomAmount1: 4n,
        protocolAmount0: 1n,
        protocolAmount1: 1n
      }),
      rawLog("CurvePhaseChanged", spoofCurve, 3n, 2, { phase: 5, reason: 2, phaseEndsAt: 0n })
    ];

    const events = await queryMarketLifecycleEvents(client(logs), {
      boardrooms: [{ boardroom }],
      fromBlock: 0n,
      pledgeV4LiquidityFactory: factory,
      toBlock: 10n
    });

    expect(events.map((event) => event.kind)).toEqual([
      "BondingCurvePrecommitted",
      "ProtocolLiquidityReserved",
      "MigrationReserved",
      "CurvePhaseChanged",
      "QuoteForfeitureOpened",
      "FeesForwarded"
    ]);
    expect(events.some((event) => event.contractAddress === spoofCurve)).toBe(false);
    expect(marketStateUpdateForEvent(events[0]!)).toMatchObject({
      bondingCurve: curve,
      primaryMarketMode: 1,
      primaryMarketQuoteAsset: quote
    });
    expect(marketStateUpdateForEvent(events[2]!)).toMatchObject({
      liquidityReservationExpectedVault: vault,
      liquidityReservationExpectedPoolId: poolId
    });
  });

  test("rejects one market contract being bound to two Boardrooms", async () => {
    await expect(queryMarketLifecycleEvents(client([]), {
      boardrooms: [{ boardroom, bondingCurve: curve }, { boardroom: otherBoardroom, bondingCurve: curve }],
      fromBlock: 0n,
      toBlock: 1n
    })).rejects.toThrow("Conflicting market topology");
  });

  test("keeps overloaded selector identities explicitly ambiguous", () => {
    const cancel = decodeKnownCall(encodeFunctionData({ abi: migratingBondingCurveAbi, functionName: "cancel" }));
    expect(cancel.decodedFunction).toContain("FixedPriceSale.cancel");
    expect(cancel.decodedFunction).toContain("MigratingBondingCurve.cancel");
    expect(cancel.decodedFunction).toContain("MerkleAirdrop.cancel");

    const claim = decodeKnownCall(encodeFunctionData({ abi: pledgeV4LiquidityVaultAbi, functionName: "claimFees" }));
    expect(claim.decodedFunction).toContain("PledgeV4LiquidityVault.claimFees");

    expect(encodeFunctionData({ abi: fixedPriceSaleAbi, functionName: "cancel" })).toBe(
      encodeFunctionData({ abi: migratingBondingCurveAbi, functionName: "cancel" })
    );
  });
});

type RawLog = {
  readonly address: Address;
  readonly args: Record<string, unknown>;
  readonly blockNumber: bigint;
  readonly eventName: string;
  readonly logIndex: number;
  readonly transactionHash: Hex;
};

function client(logs: readonly RawLog[]): PledgeCashLogClient {
  return {
    async getLogs(params: { address?: Address | Address[]; event?: { name?: string } }) {
      const addresses = new Set(
        (Array.isArray(params.address) ? params.address : params.address ? [params.address] : [])
          .map((value) => value.toLowerCase())
      );
      return logs.filter((log) =>
        (addresses.size === 0 || addresses.has(log.address.toLowerCase()))
        && (!params.event?.name || params.event.name === log.eventName)
      );
    }
  } as PledgeCashLogClient;
}

function rawLog(
  eventName: string,
  logAddress: Address,
  blockNumber: bigint,
  logIndex: number,
  args: Record<string, unknown>
): RawLog {
  return { address: logAddress, args, blockNumber, eventName, logIndex, transactionHash: txHash };
}

function address(value: string): Lowercase<Address> {
  return `0x${value.padStart(40, "0")}` as Lowercase<Address>;
}

function hex32(value: string): Lowercase<Hex> {
  return `0x${value.padStart(64, "0")}` as Lowercase<Hex>;
}
