import type { InferSelectModel } from "drizzle-orm";
import type { Address, Hex } from "viem";

import type {
  actionCalls,
  analyses,
  boardrooms,
  channels,
  notifications,
  scheduledOperations,
  riskAssessments,
  users
} from "./db/schema";
import type { JsonValue } from "./db/schema";

export type ChainId = number;
export type AddressString = Lowercase<Address>;
export type HexString = Hex;
export type Uint256String = `${bigint}`;

export type Severity = "low" | "medium" | "high";
export type ActionEvent = "scheduled" | "cancelled" | "executed" | "invalidated";
export type NotificationEvent = ActionEvent | "policy-admin" | "reminder";
export type ActionStatus = "scheduled" | "cancelled" | "executed" | "invalidated";
export type DecodeStatus = "decoded" | "undecoded";
export type BoardroomStatus = "prelaunch" | "active" | "winddown" | "snapshotting" | "redemptions-open";
export type AnalysisSource = "harness" | "template";
export type ChannelType = "telegram" | "twitter";
export type SubscriptionMode = "holdings" | "explicit";

export type UserRow = InferSelectModel<typeof users>;
export type BoardroomRow = InferSelectModel<typeof boardrooms>;
export type ScheduledOperationRow = InferSelectModel<typeof scheduledOperations>;
export type ChannelRow = InferSelectModel<typeof channels>;

export type StoredCall = Omit<InferSelectModel<typeof actionCalls>, "decodedArgs" | "value"> & {
  decodedArgs: JsonValue | null;
  value: Uint256String;
};

export type RiskFinding = {
  readonly callIndex: number | null;
  readonly detail: string;
  readonly ruleId: string;
  readonly severity: Severity;
};

export type RiskAssessment = Omit<InferSelectModel<typeof riskAssessments>, "findings" | "severity"> & {
  readonly findings: RiskFinding[];
  readonly severity: Severity;
};

export type AnalysisResult = Omit<
  InferSelectModel<typeof analyses>,
  "affectedParties" | "effects" | "source"
> & {
  readonly affectedParties: string[];
  readonly effects: string[];
  readonly source: AnalysisSource;
};

export type NotificationPayload = {
  readonly action: {
    readonly operationId: HexString;
    readonly boardroom: AddressString;
    readonly chainId: ChainId;
    readonly boardroomEpoch?: string | null;
    readonly configurationEpoch: string;
    readonly controller: AddressString;
    readonly controllerGeneration: string;
    readonly eta: string;
    readonly expiresAt?: string | null;
    readonly id: string;
    readonly invalidatedByEpoch?: string | null;
    readonly operationKind: "boardroom" | "controller";
    readonly proposer: AddressString;
    readonly status: ActionStatus;
  };
  readonly analysis?: {
    readonly affectedParties: string[];
    readonly effects: string[];
    readonly severityRationale: string;
    readonly summary: string;
  };
  readonly risk?: {
    readonly findings: RiskFinding[];
    readonly severity: Severity;
  };
};

export type OutboxRow = Omit<InferSelectModel<typeof notifications>, "event" | "payload"> & {
  readonly event: NotificationEvent;
  readonly payload: NotificationPayload;
};

export type RenderedMessage = {
  readonly html?: string;
  readonly subject?: string;
  readonly text: string;
  readonly url?: string;
};

export type ActionPipelineEvent = {
  readonly action: ScheduledOperationRow;
  readonly calls: StoredCall[];
  readonly event: ActionEvent;
};
