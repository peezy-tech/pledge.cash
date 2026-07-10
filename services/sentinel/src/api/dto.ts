import { z } from "zod";

export const AddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
export const HexSchema = z.string().regex(/^0x[a-fA-F0-9]*$/);
export const Bytes4Schema = z.string().regex(/^0x[a-fA-F0-9]{8}$/);
export const UuidSchema = z.string().uuid();
export const IsoDateSchema = z.string().datetime();
export const IntegerStringSchema = z.string().regex(/^-?\d+$/);
export const UintStringSchema = z.string().regex(/^\d+$/);

export const SeveritySchema = z.enum(["low", "medium", "high"]);
export const ActionEventSchema = z.enum(["queued", "cancelled", "executed", "invalidated"]);
export const ActionStatusSchema = z.enum(["queued", "cancelled", "executed", "invalidated", "expired"]);
export const DecodeStatusSchema = z.enum(["decoded", "undecoded"]);
export const ChannelTypeSchema = z.enum(["telegram", "twitter"]);
export const SubscriptionModeSchema = z.enum(["holdings", "explicit"]);
export const NotificationStatusSchema = z.enum(["pending", "sent", "failed", "dead"]);

export const OkResponseSchema = z.object({ ok: z.literal(true) });

export const CursorLagSchema = z.object({
  chainId: z.number().int().positive(),
  factoryDiscoveryBlock: IntegerStringSchema.optional(),
  governanceBlock: IntegerStringSchema.optional(),
  lagBlocks: IntegerStringSchema.optional(),
  shareTransfersBlock: IntegerStringSchema.optional()
});

export const HealthResponseSchema = z.object({
  chains: z.array(CursorLagSchema),
  database: z.literal("ok"),
  ok: z.literal(true)
});

export const SocialProviderSchema = z.enum([
  "apple",
  "discord",
  "github",
  "telegram",
  "twitter"
]);
export const AuthProviderSchema = z.enum(["siwe", ...SocialProviderSchema.options]);

export const UserDtoSchema = z.object({
  id: UuidSchema
});

export const WalletDtoSchema = z.object({
  alertsEnabled: z.boolean(),
  address: AddressSchema,
  canSignIn: z.literal(true),
  verifiedAt: IsoDateSchema
});

export const ChannelDtoSchema = z.object({
  enabled: z.boolean(),
  id: UuidSchema,
  telegramChatId: z.string().min(1).nullable(),
  type: ChannelTypeSchema
});

export const BoardroomRefSchema = z.object({
  address: AddressSchema,
  chainId: z.number().int().positive()
});

export const SubscriptionDtoSchema = z.object({
  boardrooms: z.array(BoardroomRefSchema),
  minSeverity: SeveritySchema,
  mode: SubscriptionModeSchema
});

export const AuthMeResponseSchema = z.object({
  channels: z.array(ChannelDtoSchema),
  providers: z.array(AuthProviderSchema),
  subscription: SubscriptionDtoSchema,
  user: UserDtoSchema,
  wallets: z.array(WalletDtoSchema)
});

export const AuthCapabilitiesResponseSchema = z.object({
  socialProviders: z.array(SocialProviderSchema)
});

export const AuthSiweNonceRequestSchema = z.object({
  chainId: z.number().int().positive(),
  walletAddress: AddressSchema
});

export const AuthSiweNonceResponseSchema = z.object({
  nonce: z.string().min(8)
});

export const AuthSiweVerifyRequestSchema = z.object({
  chainId: z.number().int().positive(),
  message: z.string().min(1),
  signature: HexSchema,
  walletAddress: AddressSchema
});

export const AuthRedirectRequestSchema = z.object({
  callbackURL: z.string().url(),
  errorCallbackURL: z.string().url().optional(),
  provider: SocialProviderSchema
});

export const AuthRedirectResponseSchema = z.object({
  redirect: z.boolean(),
  url: z.string().optional()
});

export const LogoutResponseSchema = OkResponseSchema;

export const WalletNonceRequestSchema = z.object({
  address: AddressSchema.optional(),
  chainId: z.number().int().positive().optional()
});

export const WalletNonceResponseSchema = z.object({
  address: AddressSchema.optional(),
  chainId: z.number().int().positive().optional(),
  domain: z.string().min(1),
  expirationTime: IsoDateSchema,
  issuedAt: IsoDateSchema,
  nonce: z.string().min(8),
  statement: z.string().min(1),
  uri: z.string().url(),
  version: z.literal("1")
});

export const LinkWalletRequestSchema = z.object({
  message: z.string().min(1),
  signature: HexSchema
});

export const LinkWalletResponseSchema = z.object({
  wallet: WalletDtoSchema
});

export const DeleteWalletResponseSchema = z.object({
  alertsEnabled: z.literal(false),
  ok: z.literal(true)
});

export const UpdateWalletAlertsRequestSchema = z.object({
  alertsEnabled: z.boolean()
});

export const UpdateWalletAlertsResponseSchema = z.object({
  wallet: WalletDtoSchema
});

export const WalletAddressParamsSchema = z.object({
  address: AddressSchema
});

export const PutSubscriptionRequestSchema = z.object({
  boardrooms: z.array(BoardroomRefSchema).default([]),
  minSeverity: SeveritySchema,
  mode: SubscriptionModeSchema
});

export const SubscriptionResponseSchema = z.object({
  subscription: SubscriptionDtoSchema
});

export const TelegramLinkCodeResponseSchema = z.object({
  code: z.string().min(6),
  deepLink: z.string().url(),
  expiresAt: IsoDateSchema
});

export const ChannelsResponseSchema = z.object({
  channels: z.array(ChannelDtoSchema)
});

export const DeleteChannelResponseSchema = OkResponseSchema;

export const ChannelIdParamsSchema = z.object({
  id: UuidSchema
});

export const ActionCallDtoSchema = z.object({
  callIndex: z.number().int().nonnegative(),
  data: HexSchema,
  decodedArgs: z.unknown().nullable(),
  decodedFunction: z.string().min(1).nullable(),
  policy: AddressSchema,
  selector: Bytes4Schema,
  target: AddressSchema,
  value: UintStringSchema
});

export const RiskFindingDtoSchema = z.object({
  callIndex: z.number().int().nonnegative().nullable(),
  detail: z.string().min(1),
  ruleId: z.string().min(1),
  severity: SeveritySchema
});

export const RiskAssessmentDtoSchema = z.object({
  evaluatedAt: IsoDateSchema,
  findings: z.array(RiskFindingDtoSchema),
  rulesetVersion: z.number().int().positive(),
  severity: SeveritySchema
});

export const AnalysisDtoSchema = z.object({
  affectedParties: z.array(z.string().min(1)),
  effects: z.array(z.string().min(1)),
  harness: z.string().min(1),
  model: z.string().min(1).nullable(),
  severityRationale: z.string().min(1),
  source: z.enum(["harness", "template"]),
  summary: z.string().min(1)
});

export const PublicActionDtoSchema = z.object({
  actionHash: HexSchema,
  analysis: AnalysisDtoSchema.nullable(),
  boardroom: z.object({
    address: AddressSchema,
    name: z.string().nullable(),
    shareToken: AddressSchema,
    status: z.enum(["prelaunch", "active", "winddown"])
  }),
  calls: z.array(ActionCallDtoSchema),
  chainId: z.number().int().positive(),
  decodeStatus: DecodeStatusSchema,
  epoch: IntegerStringSchema.nullable(),
  eta: IsoDateSchema,
  event: ActionEventSchema.optional(),
  expiresAt: IsoDateSchema.nullable(),
  id: UuidSchema,
  invalidatedByEpoch: IntegerStringSchema.nullable(),
  queueBlock: IntegerStringSchema,
  queueTxHash: HexSchema,
  risk: RiskAssessmentDtoSchema.nullable(),
  status: ActionStatusSchema
});

export const PublicActionsQuerySchema = z.object({
  boardroom: AddressSchema.optional(),
  chainId: z.coerce.number().int().positive().optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  minSeverity: SeveritySchema.optional(),
  status: ActionStatusSchema.optional()
});

export const BoardroomActionsParamsSchema = z.object({
  address: AddressSchema,
  chainId: z.coerce.number().int().positive()
});

export const BoardroomActionsQuerySchema = PublicActionsQuerySchema.omit({
  boardroom: true,
  chainId: true
});

export const PublicActionsResponseSchema = z.object({
  items: z.array(PublicActionDtoSchema),
  page: z.object({
    limit: z.number().int().min(1).max(100),
    nextCursor: z.string().min(1).nullable()
  })
});

export type AddressDto = z.infer<typeof AddressSchema>;
export type HexDto = z.infer<typeof HexSchema>;
export type SeverityDto = z.infer<typeof SeveritySchema>;
export type ActionEventDto = z.infer<typeof ActionEventSchema>;
export type ActionStatusDto = z.infer<typeof ActionStatusSchema>;
export type DecodeStatusDto = z.infer<typeof DecodeStatusSchema>;
export type ChannelTypeDto = z.infer<typeof ChannelTypeSchema>;
export type SubscriptionModeDto = z.infer<typeof SubscriptionModeSchema>;
export type SocialProviderDto = z.infer<typeof SocialProviderSchema>;
export type AuthProviderDto = z.infer<typeof AuthProviderSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type UserDto = z.infer<typeof UserDtoSchema>;
export type WalletDto = z.infer<typeof WalletDtoSchema>;
export type ChannelDto = z.infer<typeof ChannelDtoSchema>;
export type BoardroomRef = z.infer<typeof BoardroomRefSchema>;
export type SubscriptionDto = z.infer<typeof SubscriptionDtoSchema>;
export type AuthMeResponse = z.infer<typeof AuthMeResponseSchema>;
export type AuthCapabilitiesResponse = z.infer<typeof AuthCapabilitiesResponseSchema>;
export type AuthSiweNonceRequest = z.infer<typeof AuthSiweNonceRequestSchema>;
export type AuthSiweNonceResponse = z.infer<typeof AuthSiweNonceResponseSchema>;
export type AuthSiweVerifyRequest = z.infer<typeof AuthSiweVerifyRequestSchema>;
export type AuthRedirectRequest = z.infer<typeof AuthRedirectRequestSchema>;
export type AuthRedirectResponse = z.infer<typeof AuthRedirectResponseSchema>;
export type LogoutResponse = z.infer<typeof LogoutResponseSchema>;
export type WalletNonceRequest = z.infer<typeof WalletNonceRequestSchema>;
export type WalletNonceResponse = z.infer<typeof WalletNonceResponseSchema>;
export type LinkWalletRequest = z.infer<typeof LinkWalletRequestSchema>;
export type LinkWalletResponse = z.infer<typeof LinkWalletResponseSchema>;
export type DeleteWalletResponse = z.infer<typeof DeleteWalletResponseSchema>;
export type UpdateWalletAlertsRequest = z.infer<typeof UpdateWalletAlertsRequestSchema>;
export type UpdateWalletAlertsResponse = z.infer<typeof UpdateWalletAlertsResponseSchema>;
export type WalletAddressParams = z.infer<typeof WalletAddressParamsSchema>;
export type PutSubscriptionRequest = z.infer<typeof PutSubscriptionRequestSchema>;
export type SubscriptionResponse = z.infer<typeof SubscriptionResponseSchema>;
export type TelegramLinkCodeResponse = z.infer<typeof TelegramLinkCodeResponseSchema>;
export type ChannelsResponse = z.infer<typeof ChannelsResponseSchema>;
export type DeleteChannelResponse = z.infer<typeof DeleteChannelResponseSchema>;
export type ChannelIdParams = z.infer<typeof ChannelIdParamsSchema>;
export type ActionCallDto = z.infer<typeof ActionCallDtoSchema>;
export type RiskFindingDto = z.infer<typeof RiskFindingDtoSchema>;
export type RiskAssessmentDto = z.infer<typeof RiskAssessmentDtoSchema>;
export type AnalysisDto = z.infer<typeof AnalysisDtoSchema>;
export type PublicActionDto = z.infer<typeof PublicActionDtoSchema>;
export type PublicActionsQuery = z.infer<typeof PublicActionsQuerySchema>;
export type BoardroomActionsParams = z.infer<typeof BoardroomActionsParamsSchema>;
export type BoardroomActionsQuery = z.infer<typeof BoardroomActionsQuerySchema>;
export type PublicActionsResponse = z.infer<typeof PublicActionsResponseSchema>;
