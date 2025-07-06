import * as hl from "@nktkas/hyperliquid";
import { EventEmitter } from "events";
import { db } from "db";
import { spotTokensMetadata, spotTokensMidPrices, spotTokensCache } from "db/schema";
import { eq, desc } from "drizzle-orm";

export interface SpotTokensData {
  tokens: Record<string, hl.SpotToken>;
  mids: Record<string, string>;
  lastUpdated: number;
  source: "websocket" | "rest" | "cache";
}

export interface WebSocketClientStatus {
  isConnected: boolean;
  lastConnected: number | null;
  lastError: string | null;
  reconnectAttempts: number;
  subscriptions: string[];
}

export class HyperliquidWebSocketClient extends EventEmitter {
  private transport: hl.WebSocketTransport | null = null;
  private subsClient: hl.SubscriptionClient | null = null;
  private infoClient: hl.InfoClient;
  private spotTokensCache: SpotTokensData | null = null;
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000; // Start with 1 second
  private maxReconnectDelay = 30000; // Max 30 seconds
  private reconnectTimer: NodeJS.Timeout | null = null;
  private lastError: string | null = null;
  private lastConnected: number | null = null;
  private subscriptions: Set<string> = new Set();
  private refreshInterval: NodeJS.Timeout | null = null;
  private isTestnet: boolean;
  private lastDatabaseSync: number | null = null;
  private databaseSyncInterval: NodeJS.Timeout | null = null;

  constructor(isTestnet = false) {
    super();
    this.isTestnet = isTestnet;
    
    // Initialize REST client for fallback
    const httpTransport = new hl.HttpTransport({ isTestnet });
    this.infoClient = new hl.InfoClient({ transport: httpTransport });
  }

  /**
   * Initialize and connect to the WebSocket
   */
  async connect(): Promise<void> {
    try {
      console.log("Initializing Hyperliquid WebSocket client...");
      
      // Initialize transport and subscription client
      this.transport = new hl.WebSocketTransport();
      this.subsClient = new hl.SubscriptionClient({ transport: this.transport });

      // Load initial spot tokens data from database or API
      await this.loadInitialSpotTokens();

      // Subscribe to allMids for real-time updates
      await this.subscribeToAllMids();

      // Set up periodic refresh of spot metadata
      this.setupPeriodicRefresh();

      // Set up periodic database sync
      this.setupDatabaseSync();

      this.isConnected = true;
      this.lastConnected = Date.now();
      this.reconnectAttempts = 0;
      this.lastError = null;

      console.log("Hyperliquid WebSocket client connected successfully");
      this.emit("connected");
    } catch (error) {
      this.handleConnectionError(error);
    }
  }

  /**
   * Disconnect from the WebSocket
   */
  async disconnect(): Promise<void> {
    console.log("Disconnecting Hyperliquid WebSocket client...");
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }

    if (this.databaseSyncInterval) {
      clearInterval(this.databaseSyncInterval);
      this.databaseSyncInterval = null;
    }

    // Perform final database sync before disconnecting
    await this.syncToDatabase();

    // Clean up subscriptions
    this.subscriptions.clear();
    
    // Clean up transport
    if (this.transport) {
      try {
        this.transport = null;
      } catch (error) {
        console.error("Error cleaning up transport:", error);
      }
    }

    this.subsClient = null;
    this.isConnected = false;
    
    console.log("Hyperliquid WebSocket client disconnected");
    this.emit("disconnected");
  }

  /**
   * Get current connection status
   */
  getStatus(): WebSocketClientStatus {
    return {
      isConnected: this.isConnected,
      lastConnected: this.lastConnected,
      lastError: this.lastError,
      reconnectAttempts: this.reconnectAttempts,
      subscriptions: Array.from(this.subscriptions),
    };
  }

  /**
   * Get cached spot tokens data
   */
  getSpotTokensData(): SpotTokensData | null {
    return this.spotTokensCache;
  }

  /**
   * Force refresh spot tokens from REST API
   */
  async refreshSpotTokens(): Promise<void> {
    try {
      console.log("Refreshing spot tokens from REST API...");
      const spotMeta = await this.infoClient.spotMeta();
      
      if (spotMeta && spotMeta.tokens) {
        const tokens = spotMeta.tokens.reduce((acc, token) => {
          acc[token.name] = token;
          return acc;
        }, {} as Record<string, hl.SpotToken>);

        this.spotTokensCache = {
          tokens,
          mids: this.spotTokensCache?.mids || {},
          lastUpdated: Date.now(),
          source: "rest",
        };

        console.log(`Refreshed ${Object.keys(tokens).length} spot tokens`);
        
        // Persist to database
        await this.persistSpotTokensMetadata(spotMeta.tokens);
        
        this.emit("spotTokensUpdated", this.spotTokensCache);
      }
    } catch (error) {
      console.error("Error refreshing spot tokens:", error);
      this.emit("error", error);
    }
  }

  /**
   * Load initial spot tokens data from database or API
   */
  private async loadInitialSpotTokens(): Promise<void> {
    try {
      // First try to load from database
      const cachedData = await this.loadFromDatabase();
      
      if (cachedData && this.isCacheValid(cachedData)) {
        console.log("Loaded spot tokens from database cache");
        this.spotTokensCache = cachedData;
        this.emit("spotTokensUpdated", this.spotTokensCache);
      }
      
      // Always refresh from API to ensure we have latest data
      await this.refreshSpotTokens();
    } catch (error) {
      console.error("Error loading initial spot tokens:", error);
      // Fallback to API only
      await this.refreshSpotTokens();
    }
  }

  /**
   * Subscribe to allMids for real-time price updates
   */
  private async subscribeToAllMids(): Promise<void> {
    if (!this.subsClient) {
      throw new Error("Subscription client not initialized");
    }

    try {
      console.log("Subscribing to allMids...");
      
      await this.subsClient.allMids((data) => {
        this.handleAllMidsUpdate(data);
      });

      this.subscriptions.add("allMids");
      console.log("Successfully subscribed to allMids");
    } catch (error) {
      console.error("Error subscribing to allMids:", error);
      throw error;
    }
  }

  /**
   * Handle allMids updates
   */
  private handleAllMidsUpdate(data: hl.WsAllMids): void {
    if (this.spotTokensCache) {
      this.spotTokensCache = {
        ...this.spotTokensCache,
        mids: data.mids,
        lastUpdated: Date.now(),
        source: "websocket",
      };

      this.emit("spotTokensUpdated", this.spotTokensCache);
    }
  }

  /**
   * Set up periodic refresh of spot metadata
   */
  private setupPeriodicRefresh(): void {
    // Refresh spot metadata every 5 minutes
    this.refreshInterval = setInterval(() => {
      this.refreshSpotTokens();
    }, 5 * 60 * 1000);
  }

  /**
   * Handle connection errors and implement reconnection logic
   */
  private handleConnectionError(error: any): void {
    console.error("WebSocket connection error:", error);
    
    this.lastError = error.message || "Connection failed";
    this.isConnected = false;
    this.emit("error", error);

    // Implement exponential backoff for reconnection
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(
        this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
        this.maxReconnectDelay
      );

      console.log(`Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms...`);
      
      this.reconnectTimer = setTimeout(() => {
        this.connect();
      }, delay);
    } else {
      console.error("Max reconnection attempts reached");
      this.emit("maxReconnectAttemptsReached");
    }
  }

  /**
   * Load spot tokens data from database
   */
  private async loadFromDatabase(): Promise<SpotTokensData | null> {
    try {
      // Load metadata from database
      const tokensFromDb = await db.select().from(spotTokensMetadata);
      
      if (tokensFromDb.length === 0) {
        return null;
      }

      // Convert to the expected format
      const tokens = tokensFromDb.reduce((acc, token) => {
        const spotToken: any = {
          name: token.tokenName,
          szDecimals: token.szDecimals,
          weiDecimals: token.weiDecimals,
          index: token.index,
          tokenId: token.tokenId as `0x${string}`,
          isCanonical: token.isCanonical,
        };
        
        if (token.fullName) {
          spotToken.fullName = token.fullName;
        }
        
        if (token.evmContract && typeof token.evmContract === 'string') {
          try {
            spotToken.evmContract = JSON.parse(token.evmContract);
          } catch (error) {
            console.warn("Failed to parse evmContract JSON:", error);
          }
        }
        
        acc[token.tokenName] = spotToken as hl.SpotToken;
        return acc;
      }, {} as Record<string, hl.SpotToken>);

      // Load latest mid prices
      const mids: Record<string, string> = {};
      for (const tokenName of Object.keys(tokens)) {
        const latestPrice = await db
          .select()
          .from(spotTokensMidPrices)
          .where(eq(spotTokensMidPrices.tokenName, tokenName))
          .orderBy(desc(spotTokensMidPrices.timestamp))
          .limit(1)
          .get();
        
        if (latestPrice) {
          mids[tokenName] = latestPrice.midPrice;
        }
      }

      // Get cache metadata
      const cacheInfo = await db
        .select()
        .from(spotTokensCache)
        .where(eq(spotTokensCache.cacheKey, "spot_tokens_metadata"))
        .get();

      return {
        tokens,
        mids,
        lastUpdated: cacheInfo?.lastUpdated || Date.now(),
        source: "cache",
      };
    } catch (error) {
      console.error("Error loading from database:", error);
      return null;
    }
  }

  /**
   * Check if cached data is still valid
   */
  private isCacheValid(cachedData: SpotTokensData): boolean {
    const maxAge = 30 * 60 * 1000; // 30 minutes
    return Date.now() - cachedData.lastUpdated < maxAge;
  }

  /**
   * Persist spot tokens metadata to database
   */
  private async persistSpotTokensMetadata(tokens: hl.SpotToken[]): Promise<void> {
    try {
      const now = Date.now();
      
      // Upsert tokens metadata
      for (const token of tokens) {
        const existingToken = await db
          .select()
          .from(spotTokensMetadata)
          .where(eq(spotTokensMetadata.tokenName, token.name))
          .get();

        const tokenData = {
          tokenName: token.name,
          szDecimals: token.szDecimals,
          weiDecimals: token.weiDecimals,
          tokenId: token.tokenId,
          isCanonical: token.isCanonical,
          fullName: token.fullName || null,
          evmContract: token.evmContract ? JSON.stringify(token.evmContract) : null,
          index: token.index,
          updatedAt: now,
        };

        if (existingToken) {
          await db
            .update(spotTokensMetadata)
            .set(tokenData)
            .where(eq(spotTokensMetadata.tokenName, token.name));
        } else {
          await db.insert(spotTokensMetadata).values({
            ...tokenData,
            createdAt: now,
          });
        }
      }

      // Update cache metadata
      await this.updateCacheMetadata("spot_tokens_metadata", tokens.length, "rest");
      
      console.log(`Persisted ${tokens.length} spot tokens to database`);
    } catch (error) {
      console.error("Error persisting spot tokens metadata:", error);
    }
  }

  /**
   * Persist mid prices to database
   */
  private async persistMidPrices(mids: Record<string, string>): Promise<void> {
    try {
      const now = Date.now();
      
      // Insert new mid prices
      const midPriceEntries = Object.entries(mids).map(([tokenName, midPrice]) => ({
        tokenName,
        midPrice,
        timestamp: now,
        source: "websocket" as const,
      }));

      if (midPriceEntries.length > 0) {
        await db.insert(spotTokensMidPrices).values(midPriceEntries);
        
        // Clean up old entries (keep only last 24 hours)
        const cutoffTime = now - (24 * 60 * 60 * 1000);
        
        // Note: We'll keep the cleanup simple for now
        // In production, you might want a more sophisticated cleanup strategy
        console.log(`Persisted ${midPriceEntries.length} mid prices to database`);
      }

      // Update cache metadata
      await this.updateCacheMetadata("spot_tokens_mids", Object.keys(mids).length, "websocket");
    } catch (error) {
      console.error("Error persisting mid prices:", error);
    }
  }

  /**
   * Update cache metadata
   */
  private async updateCacheMetadata(
    cacheKey: string, 
    dataCount: number, 
    source: "websocket" | "rest" | "manual"
  ): Promise<void> {
    try {
      const now = Date.now();
      
      const existingCache = await db
        .select()
        .from(spotTokensCache)
        .where(eq(spotTokensCache.cacheKey, cacheKey))
        .get();

      const cacheData = {
        cacheKey,
        lastUpdated: now,
        lastUpdateSource: source,
        dataCount,
        isValid: true,
      };

      if (existingCache) {
        await db
          .update(spotTokensCache)
          .set(cacheData)
          .where(eq(spotTokensCache.cacheKey, cacheKey));
      } else {
        await db.insert(spotTokensCache).values(cacheData);
      }
    } catch (error) {
      console.error("Error updating cache metadata:", error);
    }
  }

  /**
   * Set up periodic database sync
   */
  private setupDatabaseSync(): void {
    // Sync to database every 2 minutes
    this.databaseSyncInterval = setInterval(() => {
      this.syncToDatabase();
    }, 2 * 60 * 1000);
  }

  /**
   * Sync current data to database
   */
  private async syncToDatabase(): Promise<void> {
    if (!this.spotTokensCache) {
      return;
    }

    try {
      // Only persist mid prices (metadata is handled in refreshSpotTokens)
      if (this.spotTokensCache.mids && Object.keys(this.spotTokensCache.mids).length > 0) {
        await this.persistMidPrices(this.spotTokensCache.mids);
        this.lastDatabaseSync = Date.now();
      }
    } catch (error) {
      console.error("Error syncing to database:", error);
    }
  }
}

// Singleton instance
let wsClient: HyperliquidWebSocketClient | null = null;

/**
 * Get or create the WebSocket client instance
 */
export function getWebSocketClient(isTestnet = false): HyperliquidWebSocketClient {
  if (!wsClient) {
    wsClient = new HyperliquidWebSocketClient(isTestnet);
  }
  return wsClient;
}

/**
 * Initialize the WebSocket client
 */
export async function initializeWebSocketClient(isTestnet = false): Promise<HyperliquidWebSocketClient> {
  const client = getWebSocketClient(isTestnet);
  await client.connect();
  return client;
}

/**
 * Cleanup the WebSocket client
 */
export async function cleanupWebSocketClient(): Promise<void> {
  if (wsClient) {
    await wsClient.disconnect();
    wsClient = null;
  }
} 