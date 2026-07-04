import { describe, expect, test } from "bun:test";
import {
  LOCAL_ANVIL_CHAIN_ID,
  PLEDGE_CASH_NETWORKS,
  createPledgeCashNetworks,
  initialSelectedNetwork,
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

  test("can resolve transaction links against the originating chain", () => {
    const hash = "0x00000000000000000000000000000000000000000000000000000000000000aa";
    const hyperEvm = networkForChainId(998);

    expect(transactionUrl(hash, hyperEvm.chainId)).toBe(`${hyperEvm.explorerUrl}/tx/${hash}`);
    expect(transactionUrl(hash, LOCAL_ANVIL_CHAIN_ID)).toBeUndefined();
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
