import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { migrate } from "@repo/db";
import { staticPlugin } from "@elysiajs/static";
import { auth_routes } from "./auth";
import { hyperliquidRoutes } from "./hyperliquid_routes";
import { initializeWebSocketClient, cleanupWebSocketClient } from "./websocket_client";
import { startPaymentsProcessor } from "./payments_processor";

migrate();

// Initialize WebSocket client
const IS_TESTNET = true;

console.log("Initializing WebSocket client...");
initializeWebSocketClient(IS_TESTNET)
  .then(() => {
    console.log("WebSocket client initialized successfully");
  })
  .catch((error) => {
    console.error("Failed to initialize WebSocket client:", error);
    console.log("Server will continue without WebSocket functionality");
  });

const app = new Elysia()
  .use(
    cors({
      origin: () => true,
      methods: ["GET", "PUT", "POST", "DELETE"],
      allowedHeaders: ["Content-Type", "Authorization", "sec-fetch-site"],
      credentials: true,
    })
  )
  .use(auth_routes)
  .use(hyperliquidRoutes)
  .use(
    staticPlugin({
      prefix: "/",
      alwaysStatic: true,
      indexHTML: true,
    })
  )
  .get("/*", () => Bun.file(`public/index.html`))
  .listen(3000);

export type App = typeof app;

// Graceful shutdown handling
const stopPayments = startPaymentsProcessor();
process.on("SIGTERM", async () => {
  console.log("Received SIGTERM signal, shutting down gracefully...");
  if (stopPayments) stopPayments();
  await cleanupWebSocketClient();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("Received SIGINT signal, shutting down gracefully...");
  if (stopPayments) stopPayments();
  await cleanupWebSocketClient();
  process.exit(0);
});

// Log server startup
console.log("🦊 Elysia is running at localhost:3000");
console.log("WebSocket client will connect in the background and cache spot tokens data");
console.log("Available endpoints:");
console.log("  - GET /hyperliquid/spot-tokens - Get cached spot tokens data");
console.log("  - GET /hyperliquid/ws-status - Get WebSocket client status");
console.log("  - POST/GET /hyperliquid/recurring - Recurring plans");
console.log("  - POST /hyperliquid/recurring/:id/run - Run a plan now");
console.log("  - POST/GET /hyperliquid/pledge-campaigns, /pledges - Pledges");
console.log("  - POST /hyperliquid/donations/record - Record a donation");
