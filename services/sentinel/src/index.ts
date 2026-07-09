export { loadConfig, sentinelEnvSchema } from "./config";
export type { Config, HarnessName, SentinelChainConfig, SentinelEnv } from "./config";
export type {
  ActionEvent,
  ActionPipelineEvent,
  ActionStatus,
  AnalysisResult,
  BoardroomRow,
  BoardroomStatus,
  ChannelRow,
  ChannelType,
  DecodeStatus,
  OutboxRow,
  QueuedActionRow,
  RenderedMessage,
  RiskAssessment,
  RiskFinding,
  Severity,
  StoredCall,
  UserRow
} from "./types";

export function startSentinel(): never {
  throw new Error("Sentinel runtime assembly is implemented in WP8.");
}

if (import.meta.main) {
  console.log("Sentinel WP0 contracts are installed. Runtime assembly is implemented in WP8.");
}
