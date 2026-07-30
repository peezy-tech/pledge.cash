export const RELEASE_MANIFEST_SCHEMA_VERSION = 1;
export const MAX_RELEASE_SELECTORS = 256;
export const CANONICAL_MIGRATION_SELECTOR = "0x6f774fc9";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = `0x${"00".repeat(32)}`;
const ZERO_SELECTOR = "0x00000000";

const routeKindValues = {
  View: 0,
  Mutating: 1,
  Migration: 2,
} as const;

export type RouteKindName = keyof typeof routeKindValues;

export interface CanonicalRoute {
  selector: `0x${string}`;
  facet: `0x${string}`;
  codeHash: `0x${string}`;
  kind: RouteKindName;
  kindValue: 0 | 1 | 2;
}

export interface CanonicalReleaseManifest {
  schemaVersion: 1;
  release: number;
  requiredStorageVersion: number;
  predecessorFacetSetHash: `0x${string}`;
  storageLayoutHash: `0x${string}`;
  manifestHash: `0x${string}`;
  routes: CanonicalRoute[];
  migrationFacet: `0x${string}`;
  migrationSelector: `0x${string}`;
  selectorCount: number;
  tuple: string;
}

const topLevelKeys = [
  "manifestHash",
  "migrationFacet",
  "migrationSelector",
  "predecessorFacetSetHash",
  "release",
  "requiredStorageVersion",
  "routes",
  "schemaVersion",
  "storageLayoutHash",
] as const;

const routeKeys = ["codeHash", "facet", "kind", "selector"] as const;

function fail(message: string): never {
  throw new Error(`Invalid protocol facet release manifest: ${message}`);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (actual.length !== canonical.length || actual.some((key, index) => key !== canonical[index])) {
    fail(`${label} keys must be exactly: ${canonical.join(", ")}`);
  }
}

function requireSafePositiveInteger(value: unknown, label: string): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value <= 0
  ) {
    fail(`${label} must be a positive JSON safe integer`);
  }
  return value;
}

function requireHex(
  value: unknown,
  bytes: number,
  label: string,
): `0x${string}` {
  if (
    typeof value !== "string"
    || !new RegExp(`^0x[0-9a-fA-F]{${(bytes * 2).toString()}}$`).test(value)
  ) {
    fail(`${label} must be a ${bytes.toString()}-byte 0x-prefixed hex string`);
  }
  return value.toLowerCase() as `0x${string}`;
}

function requireNonzeroHex(
  value: unknown,
  bytes: number,
  label: string,
): `0x${string}` {
  const parsed = requireHex(value, bytes, label);
  if (BigInt(parsed) === 0n) fail(`${label} must be nonzero`);
  return parsed;
}

function requireKind(value: unknown, label: string): RouteKindName {
  if (
    typeof value !== "string"
    || !Object.hasOwn(routeKindValues, value)
  ) {
    fail(`${label} must be View, Mutating, or Migration`);
  }
  return value as RouteKindName;
}

function encodeTuple(
  manifest: Omit<CanonicalReleaseManifest, "selectorCount" | "tuple">,
): string {
  const routes = manifest.routes
    .map((route) =>
      `(${route.selector},${route.facet},${route.codeHash},${route.kindValue.toString()})`
    )
    .join(",");
  return [
    "(",
    manifest.release.toString(),
    ",",
    manifest.requiredStorageVersion.toString(),
    ",",
    manifest.predecessorFacetSetHash,
    ",",
    manifest.storageLayoutHash,
    ",",
    manifest.manifestHash,
    ",[",
    routes,
    "],",
    manifest.migrationFacet,
    ",",
    manifest.migrationSelector,
    ")",
  ].join("");
}

export function parseReleaseManifest(value: unknown): CanonicalReleaseManifest {
  const input = requireRecord(value, "root");
  requireExactKeys(input, topLevelKeys, "root");

  if (input.schemaVersion !== RELEASE_MANIFEST_SCHEMA_VERSION) {
    fail(`schemaVersion must equal ${RELEASE_MANIFEST_SCHEMA_VERSION.toString()}`);
  }
  const release = requireSafePositiveInteger(input.release, "release");
  if (release <= 1) {
    fail("release must be greater than 1; Deploy.s.sol owns genesis release 1");
  }
  const requiredStorageVersion = requireSafePositiveInteger(
    input.requiredStorageVersion,
    "requiredStorageVersion",
  );
  const predecessorFacetSetHash = requireNonzeroHex(
    input.predecessorFacetSetHash,
    32,
    "predecessorFacetSetHash",
  );
  const storageLayoutHash = requireNonzeroHex(
    input.storageLayoutHash,
    32,
    "storageLayoutHash",
  );
  const manifestHash = requireNonzeroHex(input.manifestHash, 32, "manifestHash");

  if (!Array.isArray(input.routes)) fail("routes must be an array");
  if (input.routes.length > MAX_RELEASE_SELECTORS) {
    fail(`routes length must be between 0 and ${MAX_RELEASE_SELECTORS.toString()}`);
  }

  let previous = -1n;
  let migrationRoute: CanonicalRoute | undefined;
  const routes = input.routes.map((rawRoute, index): CanonicalRoute => {
    const route = requireRecord(rawRoute, `routes[${index.toString()}]`);
    requireExactKeys(route, routeKeys, `routes[${index.toString()}]`);
    const selector = requireHex(route.selector, 4, `routes[${index.toString()}].selector`);
    const selectorValue = BigInt(selector);
    if (selectorValue <= previous) {
      fail("route selectors must be unique and strictly ascending");
    }
    previous = selectorValue;

    const facet = requireNonzeroHex(route.facet, 20, `routes[${index.toString()}].facet`);
    const codeHash = requireNonzeroHex(
      route.codeHash,
      32,
      `routes[${index.toString()}].codeHash`,
    );
    const kind = requireKind(route.kind, `routes[${index.toString()}].kind`);
    const canonical: CanonicalRoute = {
      selector,
      facet,
      codeHash,
      kind,
      kindValue: routeKindValues[kind],
    };
    if (kind === "Migration") {
      if (migrationRoute !== undefined) fail("routes may contain at most one Migration route");
      migrationRoute = canonical;
    }
    return canonical;
  });

  const migrationFacet = requireHex(input.migrationFacet, 20, "migrationFacet");
  const migrationSelector = requireHex(input.migrationSelector, 4, "migrationSelector");
  const hasMigrationMetadata =
    migrationFacet !== ZERO_ADDRESS || migrationSelector !== ZERO_SELECTOR;
  if (
    (migrationFacet === ZERO_ADDRESS) !== (migrationSelector === ZERO_SELECTOR)
  ) {
    fail("migrationFacet and migrationSelector must both be zero or both be nonzero");
  }
  if (hasMigrationMetadata) {
    if (migrationSelector !== CANONICAL_MIGRATION_SELECTOR) {
      fail(`migrationSelector must be ${CANONICAL_MIGRATION_SELECTOR}`);
    }
    if (
      migrationRoute === undefined
      || migrationRoute.facet !== migrationFacet
      || migrationRoute.selector !== migrationSelector
    ) {
      fail("migration metadata must name the sole Migration route");
    }
  } else if (migrationRoute !== undefined) {
    fail("a Migration route requires nonzero migration metadata");
  }

  const base = {
    schemaVersion: RELEASE_MANIFEST_SCHEMA_VERSION,
    release,
    requiredStorageVersion,
    predecessorFacetSetHash,
    storageLayoutHash,
    manifestHash,
    routes,
    migrationFacet,
    migrationSelector,
  } satisfies Omit<CanonicalReleaseManifest, "selectorCount" | "tuple">;

  return {
    ...base,
    selectorCount: routes.length,
    tuple: encodeTuple(base),
  };
}

export function parseReleaseManifestJson(source: string): CanonicalReleaseManifest {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    fail(`malformed JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parseReleaseManifest(value);
}

export const releaseManifestZeroValues = {
  address: ZERO_ADDRESS,
  bytes32: ZERO_BYTES32,
  selector: ZERO_SELECTOR,
} as const;
