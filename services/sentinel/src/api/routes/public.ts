import { Hono, type Context } from "hono";

import { jsonError, parseQuery, type ApiEnv, type SentinelApiDeps } from "../auth";
import {
  BoardroomActionsParamsSchema,
  BoardroomActionsQuerySchema,
  PublicActionsQuerySchema,
  PublicActionsResponseSchema,
  type PublicActionsQuery
} from "../dto";
import { normalizeAddress } from "./wallets";

function withCacheHeaders(c: Context<ApiEnv>): void {
  c.header("Cache-Control", "public, max-age=15");
}

function normalizePublicQuery(query: PublicActionsQuery): PublicActionsQuery {
  return {
    ...query,
    ...(query.boardroom === undefined ? {} : { boardroom: normalizeAddress(query.boardroom) })
  };
}

export function createPublicRoutes(deps: SentinelApiDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();

  app.get("/actions", async (c) => {
    const parsed = parseQuery(c, PublicActionsQuerySchema, c.req.query());
    if (!parsed.ok) {
      return parsed.response;
    }

    const response = await deps.store.getPublicActions(
      normalizePublicQuery({ ...parsed.value, limit: parsed.value.limit ?? 25 })
    );
    withCacheHeaders(c);
    return c.json(PublicActionsResponseSchema.parse(response));
  });

  app.get("/chains/:chainId/boardrooms/:address/actions", async (c) => {
    const params = BoardroomActionsParamsSchema.safeParse(c.req.param());
    if (!params.success) {
      return jsonError(c, 400, "chainId or address is invalid");
    }

    const query = parseQuery(c, BoardroomActionsQuerySchema, c.req.query());
    if (!query.ok) {
      return query.response;
    }

    const response = await deps.store.getPublicActions({
      ...query.value,
      boardroom: normalizeAddress(params.data.address),
      chainId: params.data.chainId,
      limit: query.value.limit ?? 25
    });

    withCacheHeaders(c);
    return c.json(PublicActionsResponseSchema.parse(response));
  });

  return app;
}
