import { z } from "zod";

export const AddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
export const HexSchema = z.string().regex(/^0x[a-fA-F0-9]*$/);
export const UuidSchema = z.string().uuid();
export const IsoDateSchema = z.string().datetime();

export const OkResponseSchema = z.object({ ok: z.literal(true) });

export const HealthResponseSchema = z.object({
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
  address: AddressSchema,
  canSignIn: z.boolean(),
  verifiedAt: IsoDateSchema
});

export const AuthMeResponseSchema = z.object({
  providers: z.array(AuthProviderSchema),
  user: UserDtoSchema,
  wallets: z.array(WalletDtoSchema)
});

export const AuthCapabilitiesResponseSchema = z.object({
  socialProviders: z.array(SocialProviderSchema),
  walletlessSocialSignIn: z.boolean()
});

export const AuthSiweNonceRequestSchema = z.object({
  chainId: z.number().int().positive(),
  walletAddress: AddressSchema
});

export const AuthSiweNonceResponseSchema = z.object({
  message: z.string().min(1).optional(),
  nonce: z.string().min(8)
});

export const AUTH_SIWE_MAX_MESSAGE_LENGTH = 16_384;

export const AuthSiweVerifyRequestSchema = z.object({
  chainId: z.number().int().positive(),
  message: z.string().min(1).max(AUTH_SIWE_MAX_MESSAGE_LENGTH),
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
  message: z.string().min(1).optional(),
  nonce: z.string().min(8),
  statement: z.string().min(1),
  uri: z.string().url(),
  version: z.literal("1")
});

export const LinkWalletRequestSchema = z.object({
  message: z.string().min(1).max(AUTH_SIWE_MAX_MESSAGE_LENGTH),
  signature: HexSchema
});

export const LinkWalletResponseSchema = z.object({
  wallet: WalletDtoSchema
});

export type AddressDto = z.infer<typeof AddressSchema>;
export type SocialProviderDto = z.infer<typeof SocialProviderSchema>;
export type AuthProviderDto = z.infer<typeof AuthProviderSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type UserDto = z.infer<typeof UserDtoSchema>;
export type WalletDto = z.infer<typeof WalletDtoSchema>;
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
