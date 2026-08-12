import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getAddress, verifyMessage, type Address, type Hex } from "viem";
import { parseSiweMessage } from "viem/siwe";

import { WALLET_LINK_SIWE_STATEMENT } from "../better-auth";
import {
  createRateLimitMiddleware,
  createSessionMiddleware,
  AuthRateLimitError,
  AuthWalletCredentialRejectedError,
  getNow,
  jsonError,
  parseJson,
  type ApiEnv,
  type SentinelApiDeps
} from "../auth";
import {
  AUTH_SIWE_MAX_MESSAGE_LENGTH,
  LinkWalletRequestSchema,
  LinkWalletResponseSchema,
  WalletNonceRequestSchema,
  WalletNonceResponseSchema,
  type AddressDto
} from "../dto";

const WALLET_LINK_JSON_MAX_BODY_BYTES = AUTH_SIWE_MAX_MESSAGE_LENGTH * 2;

function webOriginHost(webOrigin: string): string {
  return new URL(webOrigin).host;
}

export function normalizeAddress(address: string): AddressDto {
  return getAddress(address).toLowerCase() as AddressDto;
}

export function createWalletRoutes(deps: SentinelApiDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const requireSession = createSessionMiddleware(deps);
  const rateLimit = createRateLimitMiddleware(deps, "wallets");
  const walletLinkBodyLimit = bodyLimit({
    maxSize: WALLET_LINK_JSON_MAX_BODY_BYTES,
    onError: (c) => jsonError(c, 413, "Request body is too large")
  });

  app.use("*", requireSession);

  app.post("/nonce", rateLimit, async (c) => {
    const parsed = await parseJson(c, WalletNonceRequestSchema);
    if (!parsed.ok) {
      return parsed.response;
    }

    if (parsed.value.address === undefined || parsed.value.chainId === undefined) {
      return jsonError(c, 400, "address and chainId are required");
    }
    const user = c.get("user");
    const challenge = await deps.auth.createWalletChallenge({
      address: normalizeAddress(parsed.value.address),
      chainId: parsed.value.chainId,
      ...(c.env?.clientIp === undefined ? {} : { clientIp: c.env.clientIp }),
      purpose: "link",
      userId: user.id
    });
    return c.json(WalletNonceResponseSchema.parse(challenge));
  });

  app.post("/", walletLinkBodyLimit, rateLimit, async (c) => {
    const parsed = await parseJson(c, LinkWalletRequestSchema);
    if (!parsed.ok) {
      return parsed.response;
    }

    const siwe = parseSiweMessage(parsed.value.message);
    if (
      siwe.address === undefined ||
      siwe.chainId === undefined ||
      siwe.domain === undefined ||
      siwe.nonce === undefined ||
      siwe.uri === undefined ||
      siwe.version !== "1"
    ) {
      return jsonError(c, 400, "SIWE message is missing required fields");
    }
    if (siwe.statement !== WALLET_LINK_SIWE_STATEMENT) {
      return jsonError(
        c,
        400,
        "SIWE statement is not valid for wallet linking"
      );
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
      if (error instanceof AuthRateLimitError) {
        return jsonError(c, 429, error.message);
      }
      const message = error instanceof Error ? error.message : "";
      const migrationRequired =
        /must sign in through peezy\.tech Identity/i.test(message);
      const credentialConflict =
        /already linked|another account|multiple PledgeCash users/i.test(
          message
        );
      if (migrationRequired) {
        return jsonError(
          c,
          409,
          "Sign in through peezy.tech Identity before linking another wallet"
        );
      }
      if (credentialConflict) {
        return jsonError(
          c,
          409,
          "Wallet is already linked to another account"
        );
      }
      if (error instanceof AuthWalletCredentialRejectedError) {
        return jsonError(c, 400, "SIWE signature is invalid");
      }
      return jsonError(c, 503, "Wallet linking is temporarily unavailable");
    }
    return c.json(LinkWalletResponseSchema.parse({ wallet }));
  });

  return app;
}
