import { Elysia } from 'elysia'
import Docker from 'dockerode'
import { randomUUID } from 'crypto'
import path from 'path'
import fs from 'fs/promises'


// const VOLUME_PATH = './media' //process.env.GAME_SERVER_VOLUME_PATH || '/media'
const VOLUME_PATH = path.resolve(__dirname, 'media')

// Initialize Docker client
const docker = new Docker({
  socketPath: '/var/run/docker.sock' // Mounted from host
})

interface GameServer {
  id: string
  containerId: string
  port: number
  status: 'starting' | 'running' | 'stopping' | 'stopped'
  createdAt: Date
}

// In-memory store (consider Redis for production)
const gameServers = new Map<string, GameServer>()
const usedPorts = new Set<number>()

class GameServerManager {
  private basePort = 8000 // Start allocating ports from here
  private maxServers = 100 // Adjust based on your needs

  private getAvailablePort(): number {
    for (let port = this.basePort; port < this.basePort + this.maxServers * 10; port++) {
      if (!usedPorts.has(port)) {
        usedPorts.add(port)
        return port
      }
    }
    throw new Error('No available ports')
  }

  private releasePort(port: number): void {
    usedPorts.delete(port)
  }

  async createGameServer(): Promise<GameServer> {
    const serverId = randomUUID()
    const port = this.getAvailablePort()
    
    const gameServer: GameServer = {
      id: serverId,
      containerId: '',
      port,
      status: 'starting',
      createdAt: new Date()
    }

    try {
      // Create the volume directory on host
      await this.ensureVolumeDirectory(serverId)

      // Pull the image
      await docker.pull('ghcr.io/hyperfy-xyz/hyperfy:dev')

      // Create and start container
      const container = await docker.createContainer({
        Image: 'ghcr.io/hyperfy-xyz/hyperfy:dev',
        name: `game-server-${serverId}`,
        ExposedPorts: {
          '3000/tcp': {} // Adjust based on your game's port
        },
        HostConfig: {
          PortBindings: {
            '3000/tcp': [{ HostPort: port.toString() }]
          },
          Binds: [
            `${VOLUME_PATH}/${serverId}:/app/world:rw`
          ],
          RestartPolicy: {
            Name: 'unless-stopped'
          },
          Memory: 512 * 1024 * 1024, // 512MB limit
          CpuShares: 512 // Adjust based on needs
        },
        Env: [
          `GAME_SERVER_ID=${serverId}`,
          `PORT=3000`,
          `WORLD=world`,
          `JWT_SECRET=hyper`,
          `ADMIN_CODE=`,
          `SAVE_INTERVAL=5`,
          `PUBLIC_MAX_UPLOAD_SIZE=512`,
          `PUBLIC_WS_URL=http://localhost:${port}/ws`,
          `PUBLIC_API_URL=http://localhost:${port}/api`,
          `PUBLIC_ASSETS_URL=http://localhost:${port}/assets`
        ],
        Labels: {
          'managed-by': 'game-server-api',
          'game-server-id': serverId
        }
      })

      await container.start()
      
      gameServer.containerId = container.id
      gameServer.status = 'running'
      gameServers.set(serverId, gameServer)

      console.log(`Created game server ${serverId} on port ${port}`)
      return gameServer

    } catch (error) {
      this.releasePort(port)
      gameServer.status = 'stopped'
      console.error(`Failed to create game server ${serverId}:`, error)
      throw error
    }
  }

  async stopGameServer(serverId: string): Promise<void> {
    const gameServer = gameServers.get(serverId)
    if (!gameServer) {
      throw new Error(`Game server ${serverId} not found`)
    }

    try {
      gameServer.status = 'stopping'
      
      const container = docker.getContainer(gameServer.containerId)
      await container.stop({ t: 10 }) // 10 second grace period
      await container.remove()

      this.releasePort(gameServer.port)
      gameServer.status = 'stopped'
      
      // Optionally cleanup volume (be careful!)
      // await this.cleanupVolume(serverId)

      console.log(`Stopped game server ${serverId}`)
      
    } catch (error) {
      console.error(`Failed to stop game server ${serverId}:`, error)
      throw error
    }
  }

  async getGameServer(serverId: string): Promise<GameServer | undefined> {
    const gameServer = gameServers.get(serverId)
    if (!gameServer) return undefined

    // Check actual container status
    try {
      const container = docker.getContainer(gameServer.containerId)
      const containerInfo = await container.inspect()
      
      if (containerInfo.State.Running) {
        gameServer.status = 'running'
      } else {
        gameServer.status = 'stopped'
      }
    } catch (error) {
      gameServer.status = 'stopped'
    }

    return gameServer
  }

  async listGameServers(): Promise<GameServer[]> {
    // Update statuses before returning
    for (const [id, server] of gameServers.entries()) {
      await this.getGameServer(id)
    }
    
    return Array.from(gameServers.values())
  }

  private async ensureVolumeDirectory(serverId: string): Promise<void> {
    // This would ideally be done through Docker API or init container
    // For now, assuming the directory is created externally or via mounted script

    const path = `${VOLUME_PATH}/${serverId}`
    
    try {
      await fs.mkdir(path, { recursive: true })
      // await fs.chown(path, 1000, 1000) // Adjust UID/GID as needed
    } catch (error) {
      console.warn(`Could not create/chown directory ${path}:`, error)
    }
  }

  private async cleanupVolume(serverId: string): Promise<void> {
    // Be very careful with this - only enable if you want auto-cleanup
    // const fs = require('fs').promises
    // await fs.rm(`/media/${serverId}`, { recursive: true, force: true })
  }

  // Cleanup orphaned containers on startup
  async cleanup(): Promise<void> {
    try {
      const containers = await docker.listContainers({
        all: true,
        filters: {
          label: ['managed-by=game-server-api']
        }
      })

      for (const containerInfo of containers) {
        const serverId = containerInfo.Labels['game-server-id']
        if (serverId && !gameServers.has(serverId)) {
          console.log(`Cleaning up orphaned container ${containerInfo.Id}`)
          const container = docker.getContainer(containerInfo.Id)
          try {
            await container.stop()
          } catch {} // Ignore if already stopped
          await container.remove()
        }
      }
    } catch (error) {
      console.error('Cleanup failed:', error)
    }
  }
}

const serverManager = new GameServerManager()

// Initialize cleanup on startup
serverManager.cleanup()

// Create Elysia app
const app = new Elysia()
  .get('/health', () => ({ status: 'ok', timestamp: new Date() }))
  
  .post('/game-servers', async () => {
    try {
      const gameServer = await serverManager.createGameServer()
      return {
        success: true,
        data: gameServer
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  })
  
  .get('/game-servers', async () => {
    const servers = await serverManager.listGameServers()
    return {
      success: true,
      data: servers
    }
  })
  
  .get('/game-servers/:id', async ({ params: { id } }) => {
    const server = await serverManager.getGameServer(id)
    if (!server) {
      return {
        success: false,
        error: 'Game server not found'
      }
    }
    return {
      success: true,
      data: server
    }
  })
  
  .delete('/game-servers/:id', async ({ params: { id } }) => {
    try {
      await serverManager.stopGameServer(id)
      return {
        success: true,
        message: `Game server ${id} stopped`
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  })

export default app