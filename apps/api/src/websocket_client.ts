import * as hl from "@nktkas/hyperliquid";
import { EventEmitter } from "events";

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

      // Load initial spot tokens data from API
      await this.refreshSpotTokens();

      // Subscribe to allMids for real-time updates
      await this.subscribeToAllMids();

      // Set up periodic refresh of spot metadata
      this.setupPeriodicRefresh();

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
        this.emit("spotTokensUpdated", this.spotTokensCache);
      }
    } catch (error) {
      console.error("Error refreshing spot tokens:", error);
      this.emit("error", error);
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