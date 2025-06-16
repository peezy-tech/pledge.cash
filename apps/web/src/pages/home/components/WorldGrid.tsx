import { useEffect, useState } from 'react';
import { Connection, PublicKey } from '@solana/web3.js';
import { DynamicBondingCurveClient, TokenType } from '@meteora-ag/dynamic-bonding-curve-sdk';
import type { VirtualPool, PoolConfig } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { NATIVE_MINT } from "@solana/spl-token";
import { WorldCard } from './WorldCard'
import { useQuery } from '@tanstack/react-query';
import { api } from '@/utils/api';

// Define a local ProgramAccount type as it's not directly exported by the SDK in a way the linter likes
interface ProgramAccount<T = any> {
    publicKey: PublicKey;
    account: T;
}

// Define GameServer type (similar to one in AdminGameServers.tsx)
interface GameServer {
  id: string;
  port: number; // Port might still be useful for display or other contexts
  url: string; // Expect the full URL from the API
  status: "starting" | "running" | "stopping" | "stopped";
  // Add other fields if needed, like createdAt, containerId
}

// Define the props for WorldCard, assuming it's not exported from WorldCard.tsx
// If WorldCard.tsx exports its props, import it instead.
export interface WorldCardProps {
  id: string; // Pool address (which is also the baseMintAddress and game server ID)
  title: string;
  imageUrl: string;
  price: number;
  poolData: VirtualPool; 
  poolConfig: PoolConfig;
  baseDecimals: number | null; 
  quoteDecimals: number | null;
  gameServerStatus?: GameServer['status'];
  gameServerUrl?: string; 
}

// Placeholder - Replace with your actual configuration address
const DEFAULT_CONFIG_ADDRESS = "BHMiRzpd8B2D1cbUYMea3FdgAWv5gh6ZvbKyzUdqLmwW";
const RPC_URL = "https://devnet.helius-rpc.com/?api-key=81b1290d-9852-4dcc-9c9c-4a4be7ddf3e3"; // Reusing RPC from CreateSwapForm

// React Query keys for game server status
const gameServerKeys = {
  all: ['gameServers'] as const,
  details: () => [...gameServerKeys.all, 'detail'] as const,
  detail: (serverId: string | undefined) => [...gameServerKeys.details(), serverId] as const,
};

// Custom hook to fetch game server status
const useGameServerStatusQuery = (serverId: string | undefined, options?: { enabled?: boolean }) => {
  return useQuery({
    queryKey: gameServerKeys.detail(serverId),
    queryFn: async () => {
      if (!serverId) {
        console.warn("useGameServerStatusQuery attempted to run with undefined serverId.");
        return undefined;
      }

      const response = await api['game-servers'][serverId].get();

      if (response.error) {
        // According to persistent linter errors, response.error.status might be too strictly typed
        // (e.g., only allowing 422, making a 404 check seem impossible to the type system).
        // To satisfy the linter and avoid an infinite loop, we will remove the direct 404 status check here.
        // Any error that populates `response.error` will be thrown.
        // If a 404 occurs but is typed as another status (e.g., 422), it will be caught by react-query as an error.
        // This assumes that a "not found" scenario that should be treated as data:undefined
        // would result in response.data being null/undefined, NOT response.error being populated,
        // or that the type definitions are the absolute source of truth.
        
        const errorValue = response.error.value as { error?: string; message?: string };
        // We will use the message from the error value, or a generic message including the status code we received.
        const errorMessage = errorValue?.error || errorValue?.message || `API Error (status: ${response.error.status}) fetching game server ${serverId}`;
        console.warn(`Error fetching game server ${serverId}: ${errorMessage}`); // Add a warning before throwing
        throw new Error(errorMessage);
      }

      if (response.data) {
        const apiResponse = response.data as { success: boolean; data?: GameServer; error?: string };
        if (apiResponse.success && apiResponse.data) {
          return apiResponse.data;
        }
        // If data exists but indicates an error (e.g., success:false in payload)
        const detailMessage = apiResponse.error || `API response for ${serverId} indicates failure in data payload.`;
        console.warn(`Error in game server response data for ${serverId}: ${detailMessage}`);
        throw new Error(detailMessage);
      }
      
      // This case should ideally not be reached if API is well-behaved (either data or error)
      const unexpectedMessage = `Unexpected response structure from API for game server ${serverId} (no data and no error field).`;
      console.warn(unexpectedMessage);
      throw new Error(unexpectedMessage);
    },
    enabled: !!serverId && (options?.enabled === undefined ? true : options.enabled),
    retry: 0, // Original fetch logic did not have retries.
    staleTime: 1000 * 60 * 2, // Cache for 2 minutes
    // gcTime defaults to 5 minutes, which is usually fine.
  });
};

// Helper to fetch metadata and extract image
async function fetchMetadataImage(uri: string): Promise<string | undefined> {
  if (!uri) return undefined;
  // Basic check if URI itself is an image URL
  if (/\\.(jpeg|jpg|gif|png)$/i.test(uri)) {
      return uri;
  }
  // Otherwise, assume it's a metadata JSON URL
  try {
    const response = await fetch(uri);
    if (!response.ok) {
        console.warn(`Failed to fetch metadata from ${uri}, status: ${response.status}`);
        return undefined;
    }
    const metadata = await response.json();
    return metadata.image; // Assuming standard metadata structure (e.g., Metaplex token metadata)
  } catch (error) {
    console.warn(`Failed to fetch or parse metadata from ${uri}:`, error);
    return undefined;
  }
}

// Helper function to map TokenDecimal enum to number (from CreateSwapForm.tsx)
const mapTokenDecimalEnumToNumber = (tokenDecimalEnum: number | undefined): number => {
    if (tokenDecimalEnum === undefined) return 9; // Default if undefined
    // enum TokenDecimal { NINE, SIX, THREE, ZERO } from SDK
    if (tokenDecimalEnum === 0) return 9; // NINE
    if (tokenDecimalEnum === 1) return 6; // SIX
    if (tokenDecimalEnum === 2) return 3; // THREE
    if (tokenDecimalEnum === 3) return 0; // ZERO
    console.warn("Unknown TokenDecimal enum value:", tokenDecimalEnum, "defaulting to 9 decimals.")
    return 9;
};

// Type for the data resolved for each world before server status is fetched
type ResolvedWorldData = Omit<WorldCardProps, 'gameServerStatus' | 'gameServerUrl'>;

// New component to handle fetching server status for a single card and rendering WorldCard
interface WorldCardWithServerStatusProps {
  worldData: ResolvedWorldData;
  serverIdToQuery: string | undefined;
}

const WorldCardWithServerStatus: React.FC<WorldCardWithServerStatusProps> = ({ worldData, serverIdToQuery }) => {
  const { data: gameServer, isLoading: isLoadingServerStatus, error: serverStatusError } = useGameServerStatusQuery(serverIdToQuery, {
    enabled: !!serverIdToQuery, // Only fetch if serverIdToQuery is defined
  });

  // Optional: Handle loading/error state for server status specifically within the card
  // For now, if loading or error, gameServerStatus/Url will be undefined, which WorldCard should handle.
  if (isLoadingServerStatus && serverIdToQuery) {
    // You could render a specific loading state or pass a "loading" status to WorldCard
    // console.log(`Loading server status for ${serverIdToQuery}`);
  }

  if (serverStatusError && serverIdToQuery) {
    console.warn(`Failed to load server status for ${worldData.id} (server ID: ${serverIdToQuery}):`, serverStatusError.message);
    // WorldCard will render without server status if gameServer is undefined
  }
  
  return (
    <WorldCard
      {...worldData} // Spread the original world data (id, title, imageUrl, etc.)
      gameServerStatus={gameServer?.status}
      gameServerUrl={gameServer?.url}
    />
  );
};

export function WorldGrid() {
  const [worlds, setWorlds] = useState<ResolvedWorldData[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Using the placeholder. This should be configurable or passed as a prop in a real app.
  const configAddress = DEFAULT_CONFIG_ADDRESS;

  useEffect(() => {
    const fetchPools = async () => {
      setIsLoading(true);
      setError(null);
      setWorlds([]); 

      try {
        const connection = new Connection(RPC_URL, "confirmed");
        // Initialize client similar to CreateSwapForm.tsx
        const client = new DynamicBondingCurveClient(connection as any, "confirmed");

        console.log(`Fetching pools for config address: ${configAddress}`);
        const poolsByConfig = await client.state.getPoolsByConfig(new PublicKey(configAddress));
        console.log(`Fetched ${poolsByConfig.length} pools.`);

        if (poolsByConfig.length === 0) {
            setWorlds([]);
            setIsLoading(false);
            return;
        }

        const detailedWorldsPromises = poolsByConfig.map(async (poolAccount: ProgramAccount<VirtualPool>) => {
          const poolData = poolAccount.account;
          const poolKeyStr = poolAccount.publicKey.toBase58();
          
          let imageUrl = 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=684&q=80'; // Default placeholder
          // Cast poolData to any to access potentially dynamic properties like uri
          const pData: any = poolData;

          if (pData.uri) {
            try {
                const metadataImage = await fetchMetadataImage(pData.uri);
                if (metadataImage) {
                    imageUrl = metadataImage;
                } else {
                    console.warn(`Could not resolve image from metadata URI: ${pData.uri} for pool ${poolKeyStr}. Using placeholder.`);
                }
            } catch (e) {
                 console.warn(`Error fetching image for pool ${poolKeyStr} from URI ${pData.uri}:`, e);
            }
          } else {
            console.warn(`No URI provided for pool ${poolKeyStr}. Using placeholder image.`);
          }

          let price = 0;
          let fetchedBaseDecimals: number | null = null;
          let fetchedQuoteDecimals: number | null = null;
          let fetchedPoolConfigData: PoolConfig | null = null;

          try {
            fetchedPoolConfigData = await client.state.getPoolConfig(poolData.config);
            if (fetchedPoolConfigData && poolData.baseReserve.gtn(0)) { 
                
                let baseDecimalsNum = 9; 
                try {
                    baseDecimalsNum = await client.state.getTokenDecimals(poolData.baseMint, fetchedPoolConfigData.tokenType);
                } catch (e) {
                    console.warn(`Could not fetch base decimals for mint ${poolData.baseMint.toBase58()} via API for pool ${poolKeyStr}, falling back to enum map. Error:`, e);
                    baseDecimalsNum = mapTokenDecimalEnumToNumber(fetchedPoolConfigData.tokenDecimal);
                }
                fetchedBaseDecimals = baseDecimalsNum;

                let quoteDecimalsNum = 9; 
                try {
                    if (fetchedPoolConfigData.quoteMint.equals(NATIVE_MINT)) {
                        quoteDecimalsNum = 9;
                    } else {
                        quoteDecimalsNum = await client.state.getTokenDecimals(fetchedPoolConfigData.quoteMint, TokenType.SPL);
                    }
                } catch (e) { 
                    console.warn(`Could not fetch quote decimals for mint ${fetchedPoolConfigData.quoteMint.toBase58()} for pool ${poolKeyStr}, defaulting. Error:`, e);
                }
                fetchedQuoteDecimals = quoteDecimalsNum;
                
                const baseReserveAdjusted = parseFloat(poolData.baseReserve.toString()) / Math.pow(10, baseDecimalsNum);
                const quoteReserveAdjusted = parseFloat(poolData.quoteReserve.toString()) / Math.pow(10, quoteDecimalsNum);

                if (baseReserveAdjusted > 0) {
                    price = quoteReserveAdjusted / baseReserveAdjusted;
                } else {
                    price = 0; 
                }
            }
          } catch (e) {
            console.warn(`Failed to calculate price or fetch config/decimals for pool ${poolKeyStr}:`, e);
          }
          
          return {
            id: poolKeyStr,
            title: pData.name || `Pool ${poolKeyStr.substring(0,6)}...`,
            imageUrl: imageUrl,
            price: parseFloat(price.toFixed(6)),
            poolData: poolData, // Pass the full poolData object
            poolConfig: fetchedPoolConfigData!, // Pass the fetched poolConfigData, assert non-null as it's used above
            baseDecimals: fetchedBaseDecimals,
            quoteDecimals: fetchedQuoteDecimals,
          };
        });
        
        const resolvedWorlds = await Promise.all(detailedWorldsPromises);

        setWorlds(resolvedWorlds); // Set worlds without server status; status will be fetched by each card

      } catch (err: any) {
        console.error("Failed to fetch or process worlds:", err);
        setError(`Failed to fetch worlds: ${err.message}`);
      } finally {
        setIsLoading(false);
      }
    };

    fetchPools();
  }, [configAddress]);

  if (isLoading) {
    return <div className="text-center py-10">Loading virtual worlds...</div>;
  }

  if (error) {
    return <div className="text-center py-10 text-red-500">Error: {error}</div>;
  }

  if (worlds.length === 0 && !isLoading) {
    return <div className="text-center py-10">No virtual worlds found for this configuration. Please check the config address or try another.</div>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-5">
      {worlds.map(world => {
        // Extract serverId for the query. world.poolData might be undefined initially if not careful,
        // but resolvedWorlds should ensure it's populated if the pool was processed.
        const serverIdToQuery = world.poolData?.baseMint?.toBase58();
        if (!serverIdToQuery) {
          // If no serverId, render WorldCard directly without attempting to fetch server status
          // This handles cases where poolData or baseMint might be missing for some reason.
          console.warn(`World ${world.id} is missing poolData.baseMint, cannot query server status. Rendering card without it.`);
          return (
            <WorldCard
              key={world.id}
              id={world.id}
              title={world.title}
              imageUrl={world.imageUrl}
              price={world.price}
              poolData={world.poolData}
              poolConfig={world.poolConfig}
              baseDecimals={world.baseDecimals}
              quoteDecimals={world.quoteDecimals}
              gameServerStatus={undefined}
              gameServerUrl={undefined}
            />
          );
        }
        
        return (
          <WorldCardWithServerStatus
            key={world.id}
            worldData={world}
            serverIdToQuery={serverIdToQuery}
          />
        );
      })}
    </div>
  );
} 