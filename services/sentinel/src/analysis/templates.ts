import type { AnalyzeActionInput, AnalysisContent } from "./analyze";

export function renderTemplateAnalysis(input: AnalyzeActionInput): AnalysisContent {
  const boardroomLabel = input.boardroom?.name ?? input.action.boardroom;
  const callCount = input.calls.length;
  const callWord = callCount === 1 ? "call" : "calls";
  const severity = input.risk.severity.toUpperCase();

  return {
    affectedParties: affectedParties(input),
    effects: effects(input),
    severityRationale: severityRationale(input),
    summary: `${severity} severity governance operation scheduled for ${boardroomLabel} on chain ${input.action.chainId}. The operation contains ${callCount} ${callWord}; ruleset ${input.risk.rulesetVersion} determines the severity, and this analysis is a deterministic fallback for presentation only.`
  };
}

function effects(input: AnalyzeActionInput): string[] {
  const callEffects =
    input.calls.length === 0
      ? [
          `No decoded calls are available; review raw calldata ${input.action.rawCalldata} before eta ${input.action.eta.toISOString()}.`
        ]
      : input.calls.map((call) => {
          const functionName = call.decodedFunction ?? `selector ${call.selector}`;
          return `Call ${call.callIndex}: ${functionName} on ${call.target} through policy ${call.policy} with value ${call.value}.`;
        });

  const findingEffects = input.risk.findings.map(
    (finding) => `Rule ${finding.ruleId} (${finding.severity}): ${finding.detail}`
  );

  return [...callEffects, ...findingEffects];
}

function affectedParties(input: AnalyzeActionInput): string[] {
  return unique([
    "Boardroom share holders",
    `Boardroom ${input.action.boardroom}`,
    input.boardroom === undefined ? undefined : `Share token ${input.boardroom.shareToken}`,
    `Controller ${input.action.controller}`,
    `Proposer ${input.action.proposer}`,
    ...input.calls.flatMap((call) => [`Policy ${call.policy}`, `Target ${call.target}`])
  ]);
}

function severityRationale(input: AnalyzeActionInput): string {
  if (input.risk.findings.length === 0) {
    return `The rules engine assigned ${input.risk.severity} severity using ruleset ${input.risk.rulesetVersion}; no individual findings were recorded.`;
  }

  const details = input.risk.findings
    .map((finding) => `${finding.ruleId} marked ${finding.severity}: ${finding.detail}`)
    .join(" ");
  return `The rules engine assigned ${input.risk.severity} severity using ruleset ${input.risk.rulesetVersion}. ${details}`;
}

function unique(values: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (value === undefined || seen.has(value)) {
      continue;
    }

    seen.add(value);
    result.push(value);
  }

  return result;
}
