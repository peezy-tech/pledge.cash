import { describe, expect, test } from "bun:test";
import type { Address, PledgeCashDeployment, PledgeCashReadClient } from "@pledge.cash/sdk";
import { readSwapTokenList } from "../src/lib/swap";

const factory = "0x1000000000000000000000000000000000000000" as Address;
const pool = "0x2000000000000000000000000000000000000000" as Address;
const usdc = "0x3000000000000000000000000000000000000000" as Address;
const share = "0x4000000000000000000000000000000000000000" as Address;
const whype = "0x5000000000000000000000000000000000000000" as Address;
const account = "0x6000000000000000000000000000000000000000" as Address;

describe("swap token discovery", () => {
  test("lists AMM pool tokens plus pinned seed tokens", async () => {
    const state = await readSwapTokenList(fakeReadClient(), { chainId: 31337, ammFactory: factory, wrappedNative: whype }, {
      cashToken: usdc,
      boardroomShareToken: share,
    }, account);

    expect(state.error).toBeUndefined();
    expect(state.pools).toHaveLength(1);
    expect(state.tokens.map((token) => token.address)).toEqual([whype, usdc, share]);

    const cash = state.tokens.find((token) => token.address === usdc);
    expect(cash?.label).toBe("USDC / cash");
    expect(cash?.sources).toEqual(["seed", "pool"]);
    expect(cash?.pairAddresses).toEqual([share]);
    expect(cash?.balance).toBe(1_000_000n);

    const wrappedNative = state.tokens.find((token) => token.address === whype);
    expect(wrappedNative?.label).toBe("WHYPE");
    expect(wrappedNative?.pools).toHaveLength(0);
  });
});

function fakeReadClient(): PledgeCashReadClient {
  const symbols = new Map<Address, string>([
    [usdc, "USDC"],
    [share, "PLDG"],
    [whype, "WHYPE"],
  ]);

  return {
    async readContract(rawRequest: unknown): Promise<unknown> {
      const request = rawRequest as { address: Address; functionName: string; args?: readonly unknown[] };
      if (request.address === factory && request.functionName === "allPoolsLength") return 1n;
      if (request.address === factory && request.functionName === "allPools" && request.args?.[0] === 0n) return pool;
      if (request.address === pool && request.functionName === "token0") return usdc;
      if (request.address === pool && request.functionName === "token1") return share;
      if (request.address === pool && request.functionName === "getReserves") return [1_000_000n, 2_000_000n, 0] as const;
      if (request.functionName === "symbol") return symbols.get(request.address) ?? "TKN";
      if (request.functionName === "decimals") return request.address === usdc ? 6 : 18;
      if (request.functionName === "balanceOf") return request.address === usdc ? 1_000_000n : 0n;
      throw new Error(`Unexpected read ${request.functionName} on ${request.address}`);
    },
  } as PledgeCashReadClient;
}
