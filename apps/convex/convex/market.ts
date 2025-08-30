// convex/market.ts
import { action } from "./_generated/server";
import { infoClient } from "./lib/hyperliquid";

export const spotTokens = action({
  args: {},
  handler: async () => {
    const ic = infoClient();
    const meta = await ic.spotMeta();
    const tokens = meta?.tokens?.reduce((acc: any, t: any) => {
      acc[t.name] = t;
      return acc;
    }, {} as Record<string, any>);
    return { success: true, data: tokens, count: Object.keys(tokens).length };
  },
});

export const wsStatus = action({
  args: {},
  handler: async () => {
    return {
      success: true,
      data: { connected: false, lastUpdated: 0, note: "No WS client in Convex" },
    };
  },
});
