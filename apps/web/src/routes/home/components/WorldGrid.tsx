import { useEffect, useState } from 'react';
import { Connection, PublicKey } from '@solana/web3.js';
import { DynamicBondingCurveClient, TokenType } from '@meteora-ag/dynamic-bonding-curve-sdk';
import type { VirtualPool, PoolConfig } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { NATIVE_MINT } from "@solana/spl-token";
import { WorldCard } from './WorldCard'

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


export function WorldGrid() {
  const [worlds, setWorlds] = useState<WorldCardProps[]>([]);
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

        // Fetch game server statuses for each world
        const worldsWithServerStatus = await Promise.all(resolvedWorlds.map(async (world) => {
          // world.id is the poolAddress. We need baseMintAddress for game server ID.
          if (!world.poolData || !world.poolData.baseMint) {
            console.warn(`World ${world.id} is missing poolData or baseMint, cannot fetch server status.`);
            return world; // Return original world if essential data for serverId is missing
          }

          try {
            const serverId = world.poolData.baseMint.toBase58(); // Use baseMintAddress as serverId
            const response = await fetch(`/api/game-servers/${serverId}`);
            if (response.ok) {
              const serverResult: { success: boolean; data?: GameServer; error?: string } = await response.json();
              if (serverResult.success && serverResult.data) {
                return {
                  ...world,
                  gameServerStatus: serverResult.data.status,
                  gameServerUrl: serverResult.data.url, 
                };
              }
            } else {
              if (response.status !== 404) {
                 console.warn(`Failed to fetch game server status for ${serverId} (baseMint: ${world.poolData.baseMint.toBase58()}): ${response.status}`);
              }
            }
          } catch (e) {
            console.error(`Error fetching game server status for baseMint ${world.poolData.baseMint.toBase58()}:`, e);
          }
          return world; 
        }));

        setWorlds(worldsWithServerStatus);

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
      {worlds.map(world => (
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
          gameServerStatus={world.gameServerStatus}
          gameServerUrl={world.gameServerUrl}
        />
      ))}
    </div>
  );
} 