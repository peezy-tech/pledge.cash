import type { ProductBoardroomDashboardState } from "./product-boardroom";

export const PROJECT_EVIDENCE_SCHEMA = "pledge.cash/project-evidence@1" as const;

export type ProjectEvidenceBundle = {
  schema: typeof PROJECT_EVIDENCE_SCHEMA;
  capturedAt: string;
  chainId: number;
  boardroom: string;
  currentState: JsonObject;
  coverage: JsonObject | null;
  history: JsonValue;
  warnings: string[];
};

type JsonPrimitive = boolean | null | number | string;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

/**
 * Builds a portable record from the exact project state currently rendered by the app.
 * The record is intentionally evidence, not an atomic chain proof: bounded or failed reads
 * remain visible through coverage and warnings instead of being converted to zeroes.
 */
export function createProjectEvidenceBundle(
  dashboard: ProductBoardroomDashboardState,
  chainId: number,
  capturedAt = new Date().toISOString(),
): ProjectEvidenceBundle {
  const history = dashboard.histories?.length
    ? dashboard.histories
    : dashboard.history
      ? [dashboard.history]
      : [];
  const warnings = uniqueStrings([
    ...(dashboard.snapshot.summaryWarnings ?? []),
    ...(dashboard.historyErrors ?? []),
    ...dashboard.treasuryAssets.flatMap((asset) => asset.error ? [`${asset.address}: ${asset.error}`] : []),
    ...dashboard.snapshot.grantSummaries.flatMap((grant) => grant.error ? [`${grant.address}: ${grant.error}`] : []),
    ...dashboard.snapshot.distributionSummaries.flatMap((distribution) =>
      distribution.error ? [`${distribution.address}: ${distribution.error}`] : []),
    ...dashboard.snapshot.lockedLiquiditySummaries.flatMap((position) =>
      position.error ? [`${position.address}: ${position.error}`] : []),
  ]);

  return {
    schema: PROJECT_EVIDENCE_SCHEMA,
    capturedAt,
    chainId,
    boardroom: dashboard.address,
    currentState: toJsonValue({
      nativeBalance: dashboard.nativeBalance,
      boardroom: dashboard.snapshot,
      treasuryAssets: dashboard.treasuryAssets,
    }) as JsonObject,
    coverage: dashboard.currentStateCoverage
      ? toJsonValue(dashboard.currentStateCoverage) as JsonObject
      : null,
    history: toJsonValue(history),
    warnings,
  };
}

export function projectEvidenceJson(bundle: ProjectEvidenceBundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

export function projectEvidenceFilename(bundle: Pick<ProjectEvidenceBundle, "boardroom" | "chainId">): string {
  return `pledge-cash-project-${bundle.chainId.toString()}-${bundle.boardroom.toLowerCase()}.json`;
}

export function downloadProjectEvidenceBundle(bundle: ProjectEvidenceBundle): void {
  const objectUrl = URL.createObjectURL(new Blob([projectEvidenceJson(bundle)], { type: "application/json" }));
  try {
    const link = document.createElement("a");
    link.download = projectEvidenceFilename(bundle);
    link.href = objectUrl;
    link.click();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null) return null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (typeof value === "object") {
    const entries = Object.entries(value).flatMap(([key, child]) =>
      child === undefined ? [] : [[key, toJsonValue(child)] as const]);
    return Object.fromEntries(entries) as JsonObject;
  }
  return String(value);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
