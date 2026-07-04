import { describe, expect, test } from "bun:test";
import { LOCAL_ANVIL_CHAIN_ID, PLEDGE_CASH_NETWORKS, networkForChainId, walletRpcUrl } from "../src/lib/contracts";

describe("web network profiles", () => {
  test("includes the local Anvil profile", () => {
    const local = networkForChainId(LOCAL_ANVIL_CHAIN_ID);

    expect(local.name).toBe("Local Anvil");
    expect(local.rpcUrl).toBe("http://127.0.0.1:8547");
    expect(local.wrappedNativeSymbol).toBe("WHYPE");
    expect(walletRpcUrl(local)).toBe(local.rpcUrl);
  });

  test("keeps HyperEVM, Monad, and local selectable", () => {
    expect(PLEDGE_CASH_NETWORKS.map((network) => network.chainId)).toEqual([998, 10143, 31337]);
  });
});
