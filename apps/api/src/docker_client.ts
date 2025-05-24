import { Elysia } from "elysia";
import Docker from "dockerode";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs/promises";

// const VOLUME_PATH = './media' //process.env.GAME_SERVER_VOLUME_PATH || '/media'
const VOLUME_PATH = path.resolve(__dirname, "media");
const isProd = process.env.PRODUCTION === "true";
const baseDomain = process.env.BASE_DOMAIN ?? "localhost";
const traefikNet = "coolify";
const certRes = "letsencrypt";

console.log("[DockerClient] vars:", {
  isProd,
  baseDomain,
  traefikNet,
  certRes,
});

// Initialize Docker client
const docker = new Docker({
  socketPath: "/var/run/docker.sock", // Mounted from host
});

interface GameServer {
  id: string;
  containerId: string;
  port: number;
  status: "starting" | "running" | "stopping" | "stopped";
  createdAt: Date;
}

// In-memory store (consider Redis for production)
const gameServers = new Map<string, GameServer>();
const usedPorts = new Set<number>();

class GameServerManager {
  private basePort = 9100; // Start allocating ports from here
  private maxServers = 100; // Adjust based on your needs

  private getAvailablePort(): number {
    console.log("[GameServerManager] getAvailablePort called");
    for (
      let port = this.basePort;
      port < this.basePort + this.maxServers * 10;
      port++
    ) {
      if (!usedPorts.has(port)) {
        usedPorts.add(port);
        console.log(`[GameServerManager] Port ${port} allocated`);
        return port;
      }
    }
    console.error("[GameServerManager] No available ports");
    throw new Error("No available ports");
  }

  private releasePort(port: number): void {
    console.log(`[GameServerManager] releasePort called for port: ${port}`);
    usedPorts.delete(port);
  }

  async createGameServer(): Promise<GameServer> {
    console.log("[GameServerManager] createGameServer called");
    const serverId = randomUUID();
    const port = this.getAvailablePort();
    console.log(
      `[GameServerManager] Creating game server ${serverId} on port ${port}`
    );

    const router = `0-${serverId}`; // must be unique
    const labels: Record<string, string> = {
      "managed-by": "game-server-api",
      "game-server-id": serverId,
    };

    if (isProd) {
      console.log("[GameServerManager] isProd is true");
      // ── Middlewares ────────────────────────────────────────────
      labels["traefik.enable"] = "true";
      labels["traefik.http.middlewares.gzip.compress"] = "true";
      labels[
        "traefik.http.middlewares.redirect-to-https.redirectscheme.scheme"
      ] = "https";

      // ── HTTP router (80) → redirect ───────────────────────────
      labels[`traefik.http.routers.http-${router}.entryPoints`] = "http";
      labels[`traefik.http.routers.http-${router}.middlewares`] =
        "redirect-to-https";
      labels[`traefik.http.routers.http-${router}.rule`] =
        `Host(\`${serverId}.${baseDomain}\`) && PathPrefix(\`/\`)`;
      labels[`traefik.http.routers.http-${router}.service`] = `http-${router}`;
      // HTTP service definition
      labels[`traefik.http.services.http-${router}.loadbalancer.server.port`] =
        "3000";
      labels[`traefik.http.services.https-${router}.loadbalancer.server.port`] =
        "3000";

      // ── HTTPS router (443) ─────────────────────────────────────
      labels[`traefik.http.routers.https-${router}.entryPoints`] = "https";
      labels[`traefik.http.routers.https-${router}.middlewares`] = "gzip";
      labels[`traefik.http.routers.https-${router}.rule`] =
        `Host(\`${serverId}.${baseDomain}\`) && PathPrefix(\`/\`)`;
      labels[`traefik.http.routers.https-${router}.service`] =
        `https-${router}`;
      labels[`traefik.http.routers.https-${router}.tls`] = "true";
      labels[`traefik.http.routers.https-${router}.tls.certresolver`] = certRes;
      // HTTPS service definition
      labels[`traefik.http.services.https-${router}.loadbalancer.server.port`] =
        "3000";
    } else {
      console.log("[GameServerManager] isProd is false");
    }

    const gameServer: GameServer = {
      id: serverId,
      containerId: "",
      port,
      status: "starting",
      createdAt: new Date(),
    };

    try {
      // Create the volume directory on host
      await this.ensureVolumeDirectory(serverId);
      console.log(
        `[GameServerManager] Volume directory ensured for ${serverId}`
      );

      // Pull the image
      console.log(
        "[GameServerManager] Pulling image ghcr.io/hyperfy-xyz/hyperfy:dev"
      );
      await docker.pull("ghcr.io/hyperfy-xyz/hyperfy:dev");
      console.log("[GameServerManager] Image pulled successfully");

      // Create and start container
      console.log(
        `[GameServerManager] Creating container for game server ${serverId}`
      );
      const container = await docker.createContainer({
        Image: "ghcr.io/hyperfy-xyz/hyperfy:dev",
        name: `game-server-${serverId}`,
        ExposedPorts: {
          "3000/tcp": {}, // Adjust based on your game's port
        },
        HostConfig: {
          Binds: [`${VOLUME_PATH}/${serverId}:/app/world:rw`],
          RestartPolicy: { Name: "unless-stopped" },
          Memory: 512 * 1024 * 1024,
          CpuShares: 512,
          ...(isProd
            ? { NetworkMode: traefikNet }
            : {
                PortBindings: { "3000/tcp": [{ HostPort: port.toString() }] },
              }),
        },
        NetworkingConfig: isProd
          ? { EndpointsConfig: { [traefikNet]: {} } }
          : undefined,
        Env: [
          `GAME_SERVER_ID=${serverId}`,
          `PORT=3000`,
          `WORLD=world`,
          `JWT_SECRET=hyper`,
          `ADMIN_CODE=`,
          `SAVE_INTERVAL=5`,
          `PUBLIC_MAX_UPLOAD_SIZE=512`,
          `PUBLIC_WS_URL=${isProd ? `https://${serverId}.${baseDomain}/ws` : `http://localhost:${port}/ws`}`,
          `PUBLIC_API_URL=${isProd ? `https://${serverId}.${baseDomain}/api` : `http://localhost:${port}/api`}`,
          `PUBLIC_ASSETS_URL=${isProd ? `https://${serverId}.${baseDomain}/assets` : `http://localhost:${port}/assets`}`,
        ],
        Labels: labels,
      });

      await container.start();
      console.log(
        `[GameServerManager] Container started for game server ${serverId}`
      );

      gameServer.containerId = container.id;
      gameServer.status = "running";
      gameServers.set(serverId, gameServer);

      console.log(
        `[GameServerManager] Created game server ${serverId} on port ${port}`
      );
      return gameServer;
    } catch (error) {
      this.releasePort(port);
      gameServer.status = "stopped";
      console.error(
        `[GameServerManager] Failed to create game server ${serverId}:`,
        error
      );
      throw error;
    }
  }

  async stopGameServer(serverId: string): Promise<void> {
    console.log(
      `[GameServerManager] stopGameServer called for serverId: ${serverId}`
    );
    const gameServer = gameServers.get(serverId);
    if (!gameServer) {
      console.error(
        `[GameServerManager] Game server ${serverId} not found for stopping`
      );
      throw new Error(`Game server ${serverId} not found`);
    }

    try {
      gameServer.status = "stopping";
      console.log(
        `[GameServerManager] Stopping container for game server ${serverId}`
      );

      const container = docker.getContainer(gameServer.containerId);
      await container.stop({ t: 10 }); // 10 second grace period
      console.log(
        `[GameServerManager] Container stopped for game server ${serverId}`
      );
      await container.remove();
      console.log(
        `[GameServerManager] Container removed for game server ${serverId}`
      );

      this.releasePort(gameServer.port);
      gameServer.status = "stopped";

      // Optionally cleanup volume (be careful!)
      // await this.cleanupVolume(serverId)

      console.log(`[GameServerManager] Stopped game server ${serverId}`);
    } catch (error) {
      console.error(
        `[GameServerManager] Failed to stop game server ${serverId}:`,
        error
      );
      // Preserve existing status if stopping failed mid-way or re-throw if appropriate
      // gameServer.status = 'running'; // Or some other error state
      throw error;
    }
  }

  async getGameServer(serverId: string): Promise<GameServer | undefined> {
    console.log(
      `[GameServerManager] getGameServer called for serverId: ${serverId}`
    );
    const gameServer = gameServers.get(serverId);
    if (!gameServer) {
      console.log(`[GameServerManager] Game server ${serverId} not found`);
      return undefined;
    }
    console.log(
      `[GameServerManager] Found game server ${serverId} in memory:`,
      gameServer
    );

    // Check actual container status
    try {
      console.log(
        `[GameServerManager] Inspecting container ${gameServer.containerId} for server ${serverId}`
      );
      const container = docker.getContainer(gameServer.containerId);
      const containerInfo = await container.inspect();
      console.log(
        `[GameServerManager] Container info for ${serverId}:`,
        containerInfo.State
      );

      if (containerInfo.State.Running) {
        gameServer.status = "running";
      } else {
        gameServer.status = "stopped";
      }
    } catch (error) {
      console.error(
        `[GameServerManager] Error inspecting container for server ${serverId}:`,
        error
      );
      gameServer.status = "stopped"; // Assume stopped if inspection fails
    }
    console.log(
      `[GameServerManager] Game server ${serverId} status updated to: ${gameServer.status}`
    );
    return gameServer;
  }

  async listGameServers(): Promise<GameServer[]> {
    console.log("[GameServerManager] listGameServers called");
    // Update statuses before returning
    for (const [id, server] of gameServers.entries()) {
      console.log(
        `[GameServerManager] Updating status for server ${id} in listGameServers`
      );
      await this.getGameServer(id); // This already logs
    }
    const servers = Array.from(gameServers.values());
    console.log("[GameServerManager] Returning game servers list:", servers);
    return servers;
  }

  private async ensureVolumeDirectory(serverId: string): Promise<void> {
    console.log(
      `[GameServerManager] ensureVolumeDirectory called for serverId: ${serverId}`
    );
    // This would ideally be done through Docker API or init container
    // For now, assuming the directory is created externally or via mounted script

    const dirPath = `${VOLUME_PATH}/${serverId}`; // Renamed path to dirPath to avoid conflict
    console.log(`[GameServerManager] Ensuring directory exists: ${dirPath}`);

    try {
      await fs.mkdir(dirPath, { recursive: true });
      console.log(
        `[GameServerManager] Directory ${dirPath} created or already exists.`
      );
      // await fs.chown(path, 1000, 1000) // Adjust UID/GID as needed
    } catch (error) {
      console.warn(
        `[GameServerManager] Could not create/chown directory ${dirPath}:`,
        error
      );
    }
  }

  private async cleanupVolume(serverId: string): Promise<void> {
    console.log(
      `[GameServerManager] cleanupVolume called for serverId: ${serverId}`
    );
    // Be very careful with this - only enable if you want auto-cleanup
    // const fs = require('fs').promises
    // await fs.rm(`/media/${serverId}`, { recursive: true, force: true })
    console.log(
      `[GameServerManager] Volume cleanup for ${serverId} is currently disabled.`
    );
  }

  // Cleanup orphaned containers on startup
  async cleanup(): Promise<void> {
    console.log("[GameServerManager] cleanup called");
    try {
      console.log("[GameServerManager] Listing containers for cleanup");
      const containers = await docker.listContainers({
        all: true,
        filters: {
          label: ["managed-by=game-server-api"],
        },
      });

      for (const containerInfo of containers) {
        const serverId = containerInfo.Labels["game-server-id"];
        if (serverId && !gameServers.has(serverId)) {
          console.log(
            `[GameServerManager] Cleaning up orphaned container ${containerInfo.Id} for serverId ${serverId}`
          );
          const container = docker.getContainer(containerInfo.Id);
          try {
            await container.stop();
            console.log(
              `[GameServerManager] Stopped orphaned container ${containerInfo.Id}`
            );
          } catch (stopError) {
            console.warn(
              `[GameServerManager] Failed to stop orphaned container ${containerInfo.Id}, it might be already stopped:`,
              stopError
            );
          } // Ignore if already stopped
          await container.remove();
          console.log(
            `[GameServerManager] Removed orphaned container ${containerInfo.Id}`
          );
        }
      }
      console.log("[GameServerManager] Cleanup finished");
    } catch (error) {
      console.error("[GameServerManager] Cleanup failed:", error);
    }
  }
}

const serverManager = new GameServerManager();
console.log("[DockerClient] GameServerManager initialized");

// Initialize cleanup on startup
console.log("[DockerClient] Initializing cleanup on startup");
serverManager.cleanup();

// Create Elysia app
const app = new Elysia()
  .get("/health", () => {
    console.log("[Elysia] /health endpoint called");
    return { status: "ok", timestamp: new Date() };
  })

  .post("/game-servers", async (context) => {
    console.log("[Elysia] POST /game-servers endpoint called", {
      body: context.body,
      query: context.query,
      params: context.params,
    });
    try {
      const gameServer = await serverManager.createGameServer();
      console.log("[Elysia] POST /game-servers success:", gameServer);
      return {
        success: true,
        data: gameServer,
      };
    } catch (error) {
      console.error("[Elysia] POST /game-servers error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  })

  .get("/game-servers", async (context) => {
    console.log("[Elysia] GET /game-servers endpoint called", {
      query: context.query,
    });
    const servers = await serverManager.listGameServers();
    console.log("[Elysia] GET /game-servers success:", servers);
    return {
      success: true,
      data: servers,
    };
  })

  .get("/game-servers/:id", async ({ params: { id } }) => {
    console.log(`[Elysia] GET /game-servers/${id} endpoint called`);
    const server = await serverManager.getGameServer(id);
    if (!server) {
      console.log(`[Elysia] GET /game-servers/${id} - server not found`);
      return {
        success: false,
        error: "Game server not found",
      };
    }
    console.log(`[Elysia] GET /game-servers/${id} success:`, server);
    return {
      success: true,
      data: server,
    };
  })

  .delete("/game-servers/:id", async ({ params: { id } }) => {
    console.log(`[Elysia] DELETE /game-servers/${id} endpoint called`);
    try {
      await serverManager.stopGameServer(id);
      console.log(
        `[Elysia] DELETE /game-servers/${id} - server stopped successfully`
      );
      return {
        success: true,
        message: `Game server ${id} stopped`,
      };
    } catch (error) {
      console.error(`[Elysia] DELETE /game-servers/${id} error:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

export default app;
