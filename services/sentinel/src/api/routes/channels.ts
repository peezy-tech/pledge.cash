import { Hono } from "hono";

import {
  createRateLimitMiddleware,
  createSessionMiddleware,
  getNow,
  jsonError,
  type ApiEnv,
  type SentinelApiDeps
} from "../auth";
import {
  ChannelIdParamsSchema,
  ChannelsResponseSchema,
  DeleteChannelResponseSchema,
  TelegramLinkCodeResponseSchema
} from "../dto";

const TELEGRAM_LINK_CODE_TTL_MS = 10 * 60 * 1_000;

function telegramBotUsername(deps: SentinelApiDeps): string | undefined {
  const username = deps.config.telegram.botUsername?.trim().replace(/^@/, "");
  return username === "" ? undefined : username;
}

export function createChannelRoutes(deps: SentinelApiDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const requireSession = createSessionMiddleware(deps);
  const linkCodeRateLimit = createRateLimitMiddleware(deps, "telegram-link-code");

  app.use("*", requireSession);

  app.post("/telegram/link-code", linkCodeRateLimit, async (c) => {
    const botUsername = telegramBotUsername(deps);
    if (botUsername === undefined) {
      return jsonError(c, 503, "Telegram bot username is not configured");
    }

    const now = getNow(deps);
    const expiresAt = new Date(now.getTime() + TELEGRAM_LINK_CODE_TTL_MS);
    const code = deps.generateLinkCode?.() ?? crypto.randomUUID().replaceAll("-", "").slice(0, 12);
    const user = c.get("user");
    const linkCode = await deps.store.createTelegramLinkCode({ code, expiresAt, userId: user.id });
    const response = TelegramLinkCodeResponseSchema.parse({
      code: linkCode.code,
      deepLink: `https://t.me/${botUsername}?start=${encodeURIComponent(linkCode.code)}`,
      expiresAt: linkCode.expiresAt.toISOString()
    });

    return c.json(response);
  });

  app.get("/", async (c) => {
    const user = c.get("user");
    const channels = await deps.store.getChannels(user.id);
    return c.json(ChannelsResponseSchema.parse({ channels }));
  });

  app.delete("/:id", async (c) => {
    const parsed = ChannelIdParamsSchema.safeParse(c.req.param());
    if (!parsed.success) {
      return jsonError(c, 400, "id: Invalid channel id");
    }

    const user = c.get("user");
    const deleted = await deps.store.deleteChannel({ id: parsed.data.id, userId: user.id });
    if (!deleted) {
      return jsonError(c, 404, "Channel not found");
    }

    return c.json(DeleteChannelResponseSchema.parse({ ok: true }));
  });

  return app;
}
