import { Hono } from "hono";

import {
  createSessionMiddleware,
  jsonError,
  parseJson,
  type ApiEnv,
  type SentinelApiDeps
} from "../auth";
import { PutSubscriptionRequestSchema, SubscriptionResponseSchema } from "../dto";
import { normalizeBoardrooms } from "./wallets";

export function createSubscriptionRoutes(deps: SentinelApiDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const requireSession = createSessionMiddleware(deps);

  app.use("*", requireSession);

  app.get("/", async (c) => {
    const user = c.get("user");
    const subscription = await deps.store.getSubscription(user.id);
    return c.json(SubscriptionResponseSchema.parse({ subscription }));
  });

  app.put("/", async (c) => {
    const parsed = await parseJson(c, PutSubscriptionRequestSchema);
    if (!parsed.ok) {
      return parsed.response;
    }

    const boardrooms = parsed.value.boardrooms ?? [];

    if (parsed.value.mode === "explicit" && boardrooms.length === 0) {
      return jsonError(c, 400, "Explicit subscriptions require at least one boardroom");
    }

    const user = c.get("user");
    const subscription = await deps.store.putSubscription({
      boardrooms: normalizeBoardrooms(boardrooms),
      minSeverity: parsed.value.minSeverity,
      mode: parsed.value.mode,
      userId: user.id
    });

    return c.json(SubscriptionResponseSchema.parse({ subscription }));
  });

  return app;
}
