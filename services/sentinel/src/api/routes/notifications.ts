import { Hono } from "hono";

import {
  createSessionMiddleware,
  jsonError,
  parseQuery,
  type ApiEnv,
  type SentinelApiDeps
} from "../auth";
import {
  NotificationDeliveriesQuerySchema,
  NotificationDeliveriesResponseSchema
} from "../dto";
import { isNotificationDeliveriesCursor } from "../store";

export function createNotificationRoutes(deps: SentinelApiDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const requireSession = createSessionMiddleware(deps);

  app.use("*", requireSession);

  app.get("/", async (c) => {
    const parsed = parseQuery(c, NotificationDeliveriesQuerySchema, c.req.query());
    if (!parsed.ok) {
      return parsed.response;
    }
    if (parsed.value.cursor !== undefined && !isNotificationDeliveriesCursor(parsed.value.cursor)) {
      return jsonError(c, 400, "cursor is invalid");
    }

    const user = c.get("user");
    const response = await deps.store.getNotificationDeliveries(user.id, {
      ...parsed.value,
      limit: parsed.value.limit ?? 20
    });
    c.header("Cache-Control", "private, no-store");
    return c.json(NotificationDeliveriesResponseSchema.parse(response));
  });

  return app;
}
