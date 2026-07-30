import { describe, expect, test } from "bun:test";

import {
  CANONICAL_MIGRATION_SELECTOR,
  parseReleaseManifest,
  releaseManifestZeroValues,
} from "./manifest";

const facetA = "0x1111111111111111111111111111111111111111";
const facetB = "0x2222222222222222222222222222222222222222";
const hashA = `0x${"11".repeat(32)}`;
const hashB = `0x${"22".repeat(32)}`;
const predecessor = `0x${"aa".repeat(32)}`;
const layout = `0x${"bb".repeat(32)}`;
const humanManifest = `0x${"cc".repeat(32)}`;

function validManifest() {
  return {
    schemaVersion: 1,
    release: 2,
    requiredStorageVersion: 2,
    predecessorFacetSetHash: predecessor,
    storageLayoutHash: layout,
    manifestHash: humanManifest,
    routes: [
      {
        selector: "0x01020304",
        facet: facetA,
        codeHash: hashA,
        kind: "View",
      },
      {
        selector: CANONICAL_MIGRATION_SELECTOR,
        facet: facetB,
        codeHash: hashB,
        kind: "Migration",
      },
    ],
    migrationFacet: facetB,
    migrationSelector: CANONICAL_MIGRATION_SELECTOR,
  };
}

describe("post-genesis protocol facet manifest", () => {
  test("normalizes and encodes a complete ordered release", () => {
    const manifest = parseReleaseManifest(validManifest());
    expect(manifest.selectorCount).toBe(2);
    expect(manifest.routes.map((route) => route.kindValue)).toEqual([0, 2]);
    expect(manifest.tuple).toContain(
      "(0x01020304,0x1111111111111111111111111111111111111111",
    );
    expect(manifest.tuple).toEndWith(
      `,0x2222222222222222222222222222222222222222,${CANONICAL_MIGRATION_SELECTOR})`,
    );
  });

  test("rejects genesis releases", () => {
    expect(() => parseReleaseManifest({ ...validManifest(), release: 1 })).toThrow(
      "Deploy.s.sol owns genesis",
    );
  });

  test("rejects unknown fields", () => {
    expect(() =>
      parseReleaseManifest({ ...validManifest(), expectedFacetSetHash: hashA })
    ).toThrow("root keys must be exactly");
  });

  test("rejects zero commitments", () => {
    expect(() =>
      parseReleaseManifest({
        ...validManifest(),
        storageLayoutHash: releaseManifestZeroValues.bytes32,
      })
    ).toThrow("storageLayoutHash must be nonzero");
  });

  test("rejects unordered and duplicate selectors", () => {
    const value = validManifest();
    value.routes[1] = { ...value.routes[1], selector: "0x00000001" };
    expect(() => parseReleaseManifest(value)).toThrow("strictly ascending");

    const duplicate = validManifest();
    duplicate.routes[1] = {
      ...duplicate.routes[1],
      selector: duplicate.routes[0]!.selector,
    };
    duplicate.migrationSelector = duplicate.routes[0]!.selector;
    expect(() => parseReleaseManifest(duplicate)).toThrow("strictly ascending");
  });

  test("rejects missing and zero-code facets", () => {
    const zeroFacet = validManifest();
    zeroFacet.routes[0] = {
      ...zeroFacet.routes[0],
      facet: releaseManifestZeroValues.address,
    };
    expect(() => parseReleaseManifest(zeroFacet)).toThrow(
      "routes[0].facet must be nonzero",
    );

    const zeroHash = validManifest();
    zeroHash.routes[0] = {
      ...zeroHash.routes[0],
      codeHash: releaseManifestZeroValues.bytes32,
    };
    expect(() => parseReleaseManifest(zeroHash)).toThrow(
      "routes[0].codeHash must be nonzero",
    );
  });

  test("rejects unknown route kinds", () => {
    const value = validManifest();
    value.routes[0] = { ...value.routes[0], kind: "Write" };
    expect(() => parseReleaseManifest(value)).toThrow(
      "must be View, Mutating, or Migration",
    );
  });

  test("requires exactly one migration route matching metadata", () => {
    const noncanonical = validManifest();
    noncanonical.routes[1] = { ...noncanonical.routes[1], selector: "0xaabbccdd" };
    noncanonical.migrationSelector = "0xaabbccdd";
    expect(() => parseReleaseManifest(noncanonical)).toThrow(
      `migrationSelector must be ${CANONICAL_MIGRATION_SELECTOR}`,
    );

    const missing = validManifest();
    missing.routes[1] = { ...missing.routes[1], kind: "Mutating" };
    expect(() => parseReleaseManifest(missing)).toThrow(
      "migration metadata must name the sole Migration route",
    );

    const extra = validManifest();
    extra.routes[0] = { ...extra.routes[0], kind: "Migration" };
    expect(() => parseReleaseManifest(extra)).toThrow(
      "at most one Migration route",
    );

    const wrongFacet = validManifest();
    wrongFacet.migrationFacet = facetA;
    expect(() => parseReleaseManifest(wrongFacet)).toThrow(
      "migration metadata must name the sole Migration route",
    );
  });

  test("accepts an explicit no-migration release", () => {
    const value = validManifest();
    value.requiredStorageVersion = 1;
    value.routes[1] = { ...value.routes[1], kind: "Mutating" };
    value.migrationFacet = releaseManifestZeroValues.address;
    value.migrationSelector = releaseManifestZeroValues.selector;
    const manifest = parseReleaseManifest(value);
    expect(manifest.routes[1]?.kindValue).toBe(1);
  });

  test("accepts a structurally complete empty release before registry continuity checks", () => {
    const value = validManifest();
    value.routes = [];
    value.migrationFacet = releaseManifestZeroValues.address;
    value.migrationSelector = releaseManifestZeroValues.selector;
    const manifest = parseReleaseManifest(value);
    expect(manifest.selectorCount).toBe(0);
    expect(manifest.tuple).toContain(",[],");
  });
});
