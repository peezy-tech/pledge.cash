import { Hono } from "hono";
import { getAddress, verifyMessage, type Address, type Hex } from "viem";
import { parseSiweMessage } from "viem/siwe";

import { WALLET_LINK_SIWE_STATEMENT } from "../better-auth";
import {
  createRateLimitMiddleware,
  createSessionMiddleware,
  getNow,
  jsonError,
  parseJson,
  type ApiEnv,
  type SentinelApiDeps
} from "../auth";
import { identityQuotaScope } from "../identity-quota";
import {
  DeleteWalletResponseSchema,
  LinkWalletRequestSchema,
  LinkWalletResponseSchema,
  WalletAddressParamsSchema,
  UpdateWalletAlertsRequestSchema,
  UpdateWalletAlertsResponseSchema,
  WalletNonceRequestSchema,
  WalletNonceResponseSchema,
  type AddressDto,
  type BoardroomRef,
  type WalletNonceResponse
} from "../dto";

const WALLET_NONCE_TTL_MS = 10 * 60 * 1_000;
const IDENTITY_WALLET_LINK_WINDOW_MS = 5 * 60_000;
const IDENTITY_WALLET_LINK_LIMIT = 10;

function webOriginHost(webOrigin: string): string {
  return new URL(webOrigin).host;
}

export function normalizeAddress(address: string): AddressDto {
  return getAddress(address).toLowerCase() as AddressDto;
}

export function normalizeBoardrooms(boardrooms: readonly BoardroomRef[]): BoardroomRef[] {
  return boardrooms.map((boardroom) => ({
    address: normalizeAddress(boardroom.address),
    chainId: boardroom.chainId
  }));
}

function buildWalletNonceResponse(input: {
  readonly address?: AddressDto;
  readonly chainId?: number;
  readonly deps: SentinelApiDeps;
  readonly expiresAt: Date;
  readonly issuedAt: Date;
  readonly nonce: string;
}): WalletNonceResponse {
  const base = {
    domain: webOriginHost(input.deps.config.webOrigin),
    expirationTime: input.expiresAt.toISOString(),
    issuedAt: input.issuedAt.toISOString(),
    nonce: input.nonce,
    statement: WALLET_LINK_SIWE_STATEMENT,
    uri: input.deps.config.webOrigin,
    version: "1" as const
  };

  return WalletNonceResponseSchema.parse({
    ...base,
    ...(input.address === undefined ? {} : { address: input.address }),
    ...(input.chainId === undefined ? {} : { chainId: input.chainId })
  });
}

export function createWalletRoutes(deps: SentinelApiDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const requireSession = createSessionMiddleware(deps);
  const rateLimit = createRateLimitMiddleware(deps, "wallets");

  app.use("*", requireSession);

  app.post("/nonce", rateLimit, async (c) => {
    const parsed = await parseJson(c, WalletNonceRequestSchema);
    if (!parsed.ok) {
      return parsed.response;
    }

    if (deps.auth.createWalletChallenge !== undefined) {
      if (parsed.value.address === undefined || parsed.value.chainId === undefined) {
        return jsonError(c, 400, "address and chainId are required");
      }
      const user = c.get("user");
      const challenge = await deps.auth.createWalletChallenge({
        address: normalizeAddress(parsed.value.address),
        chainId: parsed.value.chainId,
        purpose: "link",
        userId: user.id
      });
      return c.json(WalletNonceResponseSchema.parse(challenge));
    }

    const issuedAt = getNow(deps);
    const expiresAt = new Date(issuedAt.getTime() + WALLET_NONCE_TTL_MS);
    const nonce = deps.generateNonce?.() ?? crypto.randomUUID().replaceAll("-", "");
    const user = c.get("user");
    await deps.store.createWalletNonce({ expiresAt, nonce, userId: user.id });

    const address =
      parsed.value.address === undefined ? undefined : normalizeAddress(parsed.value.address);
    const response = buildWalletNonceResponse({
      deps,
      expiresAt,
      issuedAt,
      nonce,
      ...(address === undefined ? {} : { address }),
      ...(parsed.value.chainId === undefined ? {} : { chainId: parsed.value.chainId })
    });

    return c.json(response);
  });

  app.post("/", rateLimit, async (c) => {
    const parsed = await parseJson(c, LinkWalletRequestSchema);
    if (!parsed.ok) {
      return parsed.response;
    }

    const siwe = parseSiweMessage(parsed.value.message);
    const delegatesCredentialLink = deps.auth.linkWalletCredential !== undefined;
    if (
      siwe.address === undefined ||
      siwe.chainId === undefined ||
      siwe.domain === undefined ||
      siwe.nonce === undefined ||
      siwe.uri === undefined ||
      (!delegatesCredentialLink && siwe.statement !== WALLET_LINK_SIWE_STATEMENT) ||
      siwe.version !== "1"
    ) {
      return jsonError(c, 400, "SIWE message is missing required fields");
    }

    if (siwe.domain !== webOriginHost(deps.config.webOrigin)) {
      return jsonError(c, 400, "SIWE domain does not match Sentinel web origin");
    }

    let siweUriOrigin: string;
    try {
      siweUriOrigin = new URL(siwe.uri).origin;
    } catch {
      return jsonError(c, 400, "SIWE URI is invalid");
    }

    if (siweUriOrigin !== new URL(deps.config.webOrigin).origin) {
      return jsonError(c, 400, "SIWE URI does not match Sentinel web origin");
    }

    const now = getNow(deps);
    if (siwe.expirationTime !== undefined && siwe.expirationTime.getTime() <= now.getTime()) {
      return jsonError(c, 400, "SIWE message has expired");
    }

    if (siwe.notBefore !== undefined && siwe.notBefore.getTime() > now.getTime()) {
      return jsonError(c, 400, "SIWE message is not active yet");
    }

    const user = c.get("user");
    if (delegatesCredentialLink && deps.auth.linkWalletCredential !== undefined) {
      // Identity v0.1 accepts only standard 65-byte EOA signatures. Reject invalid
      // proofs locally so they cannot consume the shared wallet-grant quota.
      let signatureValid = false;
      if (parsed.value.signature.length === 132) {
        try {
          signatureValid = await verifyMessage({
            address: siwe.address as Address,
            message: parsed.value.message,
            signature: parsed.value.signature as Hex
          });
        } catch {
          signatureValid = false;
        }
      }
      if (!signatureValid) {
        return jsonError(c, 400, "SIWE signature is invalid");
      }

      if (
        deps.auth.usesSharedIdentity === true &&
        !(await deps.store.takeIdentityQuota({
          capacity: IDENTITY_WALLET_LINK_LIMIT,
          now,
          scope: identityQuotaScope(
            deps.auth.sharedIdentityClientId ?? "shared-identity",
            "wallet-grant-link"
          ),
          windowMs: IDENTITY_WALLET_LINK_WINDOW_MS
        }))
      ) {
        return jsonError(c, 429, "Rate limit exceeded");
      }
      let wallet;
      try {
        wallet = await deps.auth.linkWalletCredential({
          address: normalizeAddress(siwe.address),
          chainId: siwe.chainId,
          message: parsed.value.message,
          signature: parsed.value.signature,
          userId: user.id,
          verifiedAt: now
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const migrationRequired =
          /must sign in through peezy\.tech Identity/i.test(message);
        const credentialConflict =
          /already linked|another account|multiple PledgeCash users/i.test(
            message
          );
        return jsonError(
          c,
          credentialConflict || migrationRequired ? 409 : 400,
          migrationRequired
            ? "Sign in through peezy.tech Identity before linking another wallet"
            : credentialConflict
            ? "Wallet is already linked to another account"
            : "SIWE signature is invalid"
        );
      }
      return c.json(LinkWalletResponseSchema.parse({ wallet }));
    }

    const nonce = await deps.store.getWalletNonce(siwe.nonce);
    if (nonce === null || nonce.userId !== user.id) {
      return jsonError(c, 400, "Unknown SIWE nonce");
    }

    if (nonce.usedAt !== null) {
      return jsonError(c, 409, "SIWE nonce has already been used");
    }

    if (nonce.expiresAt.getTime() <= now.getTime()) {
      return jsonError(c, 400, "SIWE nonce has expired");
    }

    const address = normalizeAddress(siwe.address);
    const signatureOk = await deps.verifySiweSignature?.({
      address,
      chainId: siwe.chainId,
      message: parsed.value.message,
      signature: parsed.value.signature
    });

    if (signatureOk !== true) {
      return jsonError(c, 400, "SIWE signature is invalid");
    }

    const consumed = await deps.store.consumeWalletNonce({ nonce: siwe.nonce, now, userId: user.id });
    if (!consumed) {
      return jsonError(c, 409, "SIWE nonce has already been used");
    }

    const wallet = await deps.store.linkWallet({
      address,
      chainId: siwe.chainId,
      siweMessage: parsed.value.message,
      userId: user.id,
      verifiedAt: now
    });

    if (wallet === null) {
      return jsonError(c, 409, "Wallet is already linked to another account");
    }

    return c.json(LinkWalletResponseSchema.parse({ wallet }));
  });

  app.patch("/:address", rateLimit, async (c) => {
    const parsed = WalletAddressParamsSchema.safeParse(c.req.param());
    if (!parsed.success) {
      return jsonError(c, 400, "address: Invalid wallet address");
    }

    const body = await parseJson(c, UpdateWalletAlertsRequestSchema);
    if (!body.ok) {
      return body.response;
    }

    const user = c.get("user");
    let wallet = await deps.store.setWalletAlerts({
      address: normalizeAddress(parsed.data.address),
      alertsEnabled: body.value.alertsEnabled,
      userId: user.id
    });

    if (wallet === null) {
      return jsonError(c, 404, "Wallet link not found");
    }

    if (deps.auth.hydrateWallet !== undefined) {
      try {
        wallet = await deps.auth.hydrateWallet(user.id, wallet);
      } catch {
        wallet = { ...wallet, canSignIn: false };
      }
    }

    return c.json(UpdateWalletAlertsResponseSchema.parse({ wallet }));
  });

  // Retain the original route as a backwards-compatible alias for clients built
  // before alert coverage became an explicit setting. It never unlinks a credential.
  app.delete("/:address", rateLimit, async (c) => {
    const parsed = WalletAddressParamsSchema.safeParse(c.req.param());
    if (!parsed.success) {
      return jsonError(c, 400, "address: Invalid wallet address");
    }

    const user = c.get("user");
    const wallet = await deps.store.setWalletAlerts({
      address: normalizeAddress(parsed.data.address),
      alertsEnabled: false,
      userId: user.id
    });

    if (wallet === null) {
      return jsonError(c, 404, "Wallet link not found");
    }

    return c.json(DeleteWalletResponseSchema.parse({ alertsEnabled: false, ok: true }));
  });

  return app;
}
