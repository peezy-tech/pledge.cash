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
    expect(local.wrappedNativeSymbol).toBe("WETH");
    expect(walletRpcUrl(local)).toBe(local.rpcUrl);
  });

  test("keeps the approved public networks and local Anvil selectable", () => {
    expect(PLEDGE_CASH_NETWORKS.map((network) => network.chainId)).toEqual([
      11155111,
      84532,
      1,
      8453,
      42161,
      4663,
      31337,
    ]);
  });

  test("identifies unseeded Local, Testnet, Mainnet, and Custom environments truthfully", () => {
    const local = networkEnvironmentIdentity(networkForChainId(LOCAL_ANVIL_CHAIN_ID));
    const localByChainId = networkEnvironmentIdentity({ chainId: LOCAL_ANVIL_CHAIN_ID, key: "custom" });
    const localByProfileKey = networkEnvironmentIdentity({ chainId: 42_424, key: "local-anvil" });
    const testnet = networkEnvironmentIdentity(networkForChainId(11155111));
    const mainnet = networkEnvironmentIdentity(networkForChainId(1));
    const custom = networkEnvironmentIdentity({ chainId: 424_242, key: "custom", environment: "custom" });

    for (const localIdentity of [local, localByChainId, localByProfileKey]) {
      expect(localIdentity).toMatchObject({ kind: "local", label: "Local", hasRealValue: false, resettable: true, seeded: false });
      expect(localIdentity.description).toContain("Local, resettable");
      expect(localIdentity.description).toContain("no real value");
      expect(localIdentity.description).not.toMatch(/seeded|fixtures/i);
    }
    expect(testnet).toMatchObject({ kind: "testnet", label: "Testnet", hasRealValue: false });
    expect(mainnet).toMatchObject({ kind: "mainnet", label: "Mainnet", hasRealValue: true });
    expect(custom).toMatchObject({ kind: "custom", label: "Custom", hasRealValue: undefined });
  });

  test("keeps JSON-RPC batches within the strictest configured provider limit", () => {
    expect(PUBLIC_RPC_BATCH_SIZE).toBe(20);
    expect(PUBLIC_RPC_RETRY_COUNT).toBe(0);
  });

  test("supports explicit canonical and local overrides", () => {
    const networks = createPledgeCashNetworks({
      VITE_PLEDGE_CASH_CHAIN_NAME_11155111: "Ethereum Sepolia mirror",
      VITE_PLEDGE_CASH_EXPLORER_URL_11155111: "",
      VITE_PLEDGE_CASH_LOCAL_EXPLORER_NAME: "Local",
      VITE_PLEDGE_CASH_LOCAL_EXPLORER_URL: "",
      VITE_PLEDGE_CASH_LOCAL_NAME: "pledge.cash local",
      VITE_PLEDGE_CASH_LOCAL_RPC_URL: "/pledge-cash/rpc",
    });
    const sepolia = networks.find((network) => network.chainId === 11155111);
    const local = networks.find((network) => network.chainId === LOCAL_ANVIL_CHAIN_ID);

    expect(sepolia?.name).toBe("Ethereum Sepolia mirror");
    expect(sepolia?.explorerUrl).toBe("");
    expect(sepolia?.chain.blockExplorers).toBeUndefined();
    expect(local?.name).toBe("pledge.cash local");
    expect(local?.rpcUrl).toBe("/pledge-cash/rpc");
    expect(local?.explorerName).toBe("Local");
    expect(local?.explorerUrl).toBe("");
    expect(local?.chain.blockExplorers).toBeUndefined();
  });

  test("can resolve transaction links against the originating chain", () => {
    const hash = "0x00000000000000000000000000000000000000000000000000000000000000aa";
    const address = "0x1000000000000000000000000000000000000000";
    const sepolia = networkForChainId(11155111);

    expect(transactionUrl(hash, sepolia.chainId)).toBe(`${sepolia.explorerUrl}/tx/${hash}`);
    expect(addressUrl(address, sepolia.chainId)).toBe(`${sepolia.explorerUrl}/address/${address}`);
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
      expect(initialSelectedNetwork().chainId).toBe(11155111);
    } finally {
      if (previousWindow) {
        Object.defineProperty(globalThis, "window", previousWindow);
      } else {
        Reflect.deleteProperty(globalThis, "window");
      }
    }
  });

  test("supports explicit per-chain RPC overrides without changing other profiles", () => {
    const networks = createPledgeCashNetworks({
      VITE_PLEDGE_CASH_RPC_URL_84532: "https://base-sepolia.example.test",
    });

    expect(networks.find((network) => network.chainId === 84532)?.rpcUrl).toBe("https://base-sepolia.example.test");
    expect(networks.find((network) => network.chainId === 11155111)?.rpcUrl).toBe("https://ethereum-sepolia-rpc.publicnode.com");
  });
});
