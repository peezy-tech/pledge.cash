import { WorkOS } from "@workos-inc/node";

import type { Config } from "../config";
import type { AuthKitAdapter, AuthKitUser } from "./auth";

export function createWorkOsAuthAdapter(config: Pick<Config, "webOrigin" | "workos">): AuthKitAdapter {
  const apiKey = config.workos.apiKey;
  const clientId = config.workos.clientId;
  const cookiePassword = config.workos.cookiePassword;
  const redirectUri = config.workos.redirectUri;

  if (
    apiKey === undefined ||
    clientId === undefined ||
    cookiePassword === undefined ||
    redirectUri === undefined
  ) {
    return createDisabledAuthAdapter();
  }

  const workos = new WorkOS(apiKey, { clientId });

  return {
    async authenticateWithCode(input) {
      const response = await workos.userManagement.authenticateWithCode({
        clientId,
        code: input.code,
        session: { cookiePassword, sealSession: true }
      });

      if (response.sealedSession === undefined) {
        throw new Error("WorkOS did not return a sealed session");
      }

      return {
        sealedSession: response.sealedSession,
        user: toAuthKitUser(response.user)
      };
    },
    getAuthorizationUrl(input) {
      return workos.userManagement.getAuthorizationUrl({
        clientId,
        provider: "authkit",
        redirectUri,
        state: input.state ?? input.returnTo
      });
    },
    async getSession(input) {
      const session = workos.userManagement.loadSealedSession({
        cookiePassword,
        sessionData: input.sealedSession
      });
      const authenticated = await session.authenticate();
      return authenticated.authenticated ? { user: toAuthKitUser(authenticated.user) } : null;
    },
    async revokeSession(input) {
      const session = workos.userManagement.loadSealedSession({
        cookiePassword,
        sessionData: input.sealedSession
      });
      const authenticated = await session.authenticate();
      if (authenticated.authenticated) {
        await workos.userManagement.revokeSession({ sessionId: authenticated.sessionId });
      }
    }
  };
}

function createDisabledAuthAdapter(): AuthKitAdapter {
  const fail = (): never => {
    throw new Error("WorkOS AuthKit is not configured for this Sentinel runtime");
  };

  return {
    authenticateWithCode: fail,
    getAuthorizationUrl: fail,
    getSession: async () => null,
    revokeSession: async () => undefined
  };
}

function toAuthKitUser(user: { readonly email: string; readonly id: string }): AuthKitUser {
  return {
    email: user.email,
    id: user.id
  };
}
