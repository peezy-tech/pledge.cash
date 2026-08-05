import { describe, expect, test } from "bun:test";

import {
  loadNetworkManifest,
  parseNetworkManifest,
  SUPPORTED_MAINNET_CHAIN_IDS,
  SUPPORTED_PUBLIC_CHAIN_IDS,
  SUPPORTED_TESTNET_CHAIN_IDS,
  validateDeploymentCoverage,
} from "./network-profiles";

describe("canonical network profiles", () => {
  test("pins the approved two-testnet and four-mainnet support policy", async () => {
    const manifest = await loadNetworkManifest();

    expect(manifest.profiles.map((profile) => profile.chainId)).toEqual([...SUPPORTED_PUBLIC_CHAIN_IDS]);
    expect(manifest.supportPolicy.testnetChainIds).toEqual([...SUPPORTED_TESTNET_CHAIN_IDS]);
    expect(manifest.supportPolicy.mainnetChainIds).toEqual([...SUPPORTED_MAINNET_CHAIN_IDS]);
    expect(manifest.supportPolicy.defaultChainId).toBe(11155111);
    expect(manifest.profiles.filter((profile) => profile.deploymentPhase === "testnet-candidate")).toHaveLength(2);
    expect(manifest.profiles.filter((profile) => profile.deploymentPhase === "mainnet-planned")).toHaveLength(4);
  });

  test("keeps every external dependency address and runtime hash explicit", async () => {
    const manifest = await loadNetworkManifest();

    for (const profile of manifest.profiles) {
      const dependencies = [
        profile.create2Factory,
        profile.wrappedNative,
        profile.uniswap.poolManager,
        profile.uniswap.universalRouter,
        profile.uniswap.quoter,
        profile.uniswap.stateView,
        profile.uniswap.positionManager,
        profile.uniswap.permit2,
      ];
      expect(dependencies.every(({ address }) => /^0x[0-9a-fA-F]{40}$/.test(address))).toBe(true);
      expect(dependencies.every(({ codeHash }) => /^0x[0-9a-f]{64}$/.test(codeHash))).toBe(true);
    }
  });

  test("requires checked-in deployment status for every supported public chain", async () => {
    const manifest = await loadNetworkManifest();
    await expect(validateDeploymentCoverage(manifest)).resolves.toBeUndefined();
  });

  test("rejects support-policy expansion without an explicit parser change", async () => {
    const manifest = await loadNetworkManifest();
    const expanded = structuredClone(manifest) as unknown as Record<string, unknown>;
    const profiles = expanded.profiles as unknown[];
    profiles.push({ ...(profiles[0] as object), chainId: 10, key: "optimism", name: "Optimism" });

    expect(() => parseNetworkManifest(expanded)).toThrow("outside the approved support policy");
  });
});
