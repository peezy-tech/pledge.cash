import { describe, expect, test } from "bun:test";
import {
  LOCAL_ANVIL_CHAIN_ID,
  PLEDGE_CASH_NETWORKS,
  PUBLIC_RPC_BATCH_SIZE,
  PUBLIC_RPC_RETRY_COUNT,
  addressUrl,
  createPledgeCashNetworks,
  initialSelectedNetwork,
  networkEnvironmentIdentity,
  networkForChainId,
  persistSelectedNetwork,
  transactionUrl,
  walletRpcUrl,
} from "../src/lib/contracts";

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

  test("identifies unseeded Local, Testnet, and Custom environments truthfully", () => {
    const local = networkEnvironmentIdentity(networkForChainId(LOCAL_ANVIL_CHAIN_ID));
    const localByChainId = networkEnvironmentIdentity({ chainId: LOCAL_ANVIL_CHAIN_ID, key: "custom" });
    const localByProfileKey = networkEnvironmentIdentity({ chainId: 42_424, key: "local-anvil" });
    const testnet = networkEnvironmentIdentity(networkForChainId(998));
    const customNetwork = createPledgeCashNetworks({
      VITE_PLEDGE_CASH_CHAIN_ID: "424242",
      VITE_PLEDGE_CASH_CHAIN_NAME: "Partner chain",
      VITE_PLEDGE_CASH_RPC_URL: "https://rpc.custom.test",
    }).find((network) => network.chainId === 424242)!;
    const custom = networkEnvironmentIdentity(customNetwork);

    for (const localIdentity of [local, localByChainId, localByProfileKey]) {
      expect(localIdentity).toMatchObject({ kind: "local", label: "Local", hasRealValue: false, resettable: true, seeded: false });
      expect(localIdentity.description).toContain("Local, resettable");
      expect(localIdentity.description).toContain("no real value");
      expect(localIdentity.description).not.toMatch(/seeded|fixtures/i);
    }
    expect(testnet).toMatchObject({ kind: "testnet", label: "Testnet", hasRealValue: false });
    expect(custom).toMatchObject({ kind: "custom", label: "Custom", hasRealValue: undefined });
  });

  test("keeps JSON-RPC batches within the strictest configured provider limit", () => {
    expect(PUBLIC_RPC_BATCH_SIZE).toBe(20);
    expect(PUBLIC_RPC_RETRY_COUNT).toBe(0);
  });

  test("preserves custom legacy env chain IDs as selectable profiles", () => {
    const networks = createPledgeCashNetworks({
      VITE_PLEDGE_CASH_CHAIN_ID: "424242",
      VITE_PLEDGE_CASH_CHAIN_NAME: "Custom Testnet",
      VITE_PLEDGE_CASH_RPC_URL: "https://rpc.custom.test",
      VITE_PLEDGE_CASH_EXPLORER_NAME: "CustomScan",
      VITE_PLEDGE_CASH_EXPLORER_URL: "https://explorer.custom.test",
      VITE_PLEDGE_CASH_WRAPPED_NATIVE_SYMBOL: "WCUSTOM",
    });
    const custom = networks.find((network) => network.chainId === 424242);

    expect(networks.map((network) => network.chainId)).toEqual([998, 10143, 31337, 424242]);
    expect(custom?.key).toBe("custom");
    expect(custom?.name).toBe("Custom Testnet");
    expect(custom?.rpcUrl).toBe("https://rpc.custom.test");
    expect(custom?.explorerName).toBe("CustomScan");
    expect(custom?.explorerUrl).toBe("https://explorer.custom.test");
    expect(custom?.wrappedNativeSymbol).toBe("WCUSTOM");
    expect(custom?.chain.id).toBe(424242);
    expect(custom?.chain.rpcUrls.default.http).toEqual(["https://rpc.custom.test"]);
    expect(custom?.chain.blockExplorers?.default.url).toBe("https://explorer.custom.test");
  });

  test("preserves blank legacy explorer overrides as disabled links", () => {
    const hyperEvm = createPledgeCashNetworks({
      VITE_PLEDGE_CASH_EXPLORER_URL: "",
    }).find((network) => network.chainId === 998);
    const custom = createPledgeCashNetworks({
      VITE_PLEDGE_CASH_CHAIN_ID: "424242",
      VITE_PLEDGE_CASH_RPC_URL: "https://rpc.custom.test",
      VITE_PLEDGE_CASH_EXPLORER_URL: "",
    }).find((network) => network.chainId === 424242);

    expect(hyperEvm?.explorerUrl).toBe("");
    expect(hyperEvm?.chain.blockExplorers).toBeUndefined();
    expect(custom?.explorerUrl).toBe("");
    expect(custom?.chain.blockExplorers).toBeUndefined();
  });

  test("can resolve transaction links against the originating chain", () => {
    const hash = "0x00000000000000000000000000000000000000000000000000000000000000aa";
    const address = "0x1000000000000000000000000000000000000000";
    const hyperEvm = networkForChainId(998);

    expect(transactionUrl(hash, hyperEvm.chainId)).toBe(`${hyperEvm.explorerUrl}/tx/${hash}`);
    expect(addressUrl(address, hyperEvm.chainId)).toBe(`${hyperEvm.explorerUrl}/address/${address}`);
    expect(transactionUrl(hash, LOCAL_ANVIL_CHAIN_ID)).toBeUndefined();
    expect(addressUrl(address, LOCAL_ANVIL_CHAIN_ID)).toBeUndefined();
    expect(transactionUrl(hash, 999_999)).toBeUndefined();
  });

  test("treats selected-network storage as best effort", () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: { href: "https://example.test/pledge-cash/" },
        localStorage: {
          getItem: () => {
            throw new Error("storage unavailable");
          },
          setItem: () => {
            throw new Error("storage unavailable");
          },
        },
      },
    });

    try {
      expect(() => persistSelectedNetwork(LOCAL_ANVIL_CHAIN_ID)).not.toThrow();
      expect(initialSelectedNetwork().chainId).toBe(998);
    } finally {
      if (previousWindow) {
        Object.defineProperty(globalThis, "window", previousWindow);
      } else {
        Reflect.deleteProperty(globalThis, "window");
      }
    }
  });
});
