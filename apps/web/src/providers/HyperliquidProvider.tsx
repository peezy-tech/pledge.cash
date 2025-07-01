import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import * as hl from '@nktkas/hyperliquid';

const IS_TESTNET = true;

export interface HyperliquidState {
  transport: hl.HttpTransport | null;
  exchangeClient: hl.ExchangeClient | null;
  infoClient: hl.InfoClient | null;
  isReady: boolean;
  error: string | null;
}

interface HyperliquidContextType extends HyperliquidState {
  refreshClients: () => void;
  clearError: () => void;
}

export const HyperliquidContext = createContext<HyperliquidContextType | null>(null);

export const useHyperliquid = (): HyperliquidContextType => {
  const context = useContext(HyperliquidContext);
  
  if (!context) {
    throw new Error('useHyperliquid must be used within a HyperliquidProvider');
  }
  
  return context;
};

interface HyperliquidProviderProps {
  children: ReactNode;
}

export const HyperliquidProvider: React.FC<HyperliquidProviderProps> = ({ children }) => {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  
  const [transport, setTransport] = useState<hl.HttpTransport | null>(null);
  const [exchangeClient, setExchangeClient] = useState<hl.ExchangeClient | null>(null);
  const [infoClient, setInfoClient] = useState<hl.InfoClient | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Initialize transport and info client (these don't require wallet)
  useEffect(() => {
    try {
      const newTransport = new hl.HttpTransport({isTestnet: IS_TESTNET});
      setTransport(newTransport);
      
      const newInfoClient = new hl.InfoClient({ transport: newTransport });
      setInfoClient(newInfoClient);
      
      setError(null);
    } catch (err) {
      console.error('Error initializing Hyperliquid transport/info client:', err);
      setError(err instanceof Error ? err.message : 'Failed to initialize Hyperliquid clients');
    }
  }, []);

  // Initialize exchange client when wallet is available
  useEffect(() => {
    if (!transport) {
      setExchangeClient(null);
      return;
    }

    if (isConnected && walletClient && address) {
      try {
        const newExchangeClient = new hl.ExchangeClient({
          wallet: walletClient,
          transport,
          isTestnet: IS_TESTNET,
        });
        setExchangeClient(newExchangeClient);
        setError(null);
      } catch (err) {
        console.error('Error initializing Hyperliquid exchange client:', err);
        setError(err instanceof Error ? err.message : 'Failed to initialize Hyperliquid exchange client');
        setExchangeClient(null);
      }
    } else {
      setExchangeClient(null);
    }
  }, [transport, isConnected, walletClient, address]);

  const isReady = useMemo(() => {
    return !!(transport && infoClient);
  }, [transport, infoClient]);

  const refreshClients = useCallback(() => {
    try {
      const newTransport = new hl.HttpTransport({isTestnet: IS_TESTNET});
      setTransport(newTransport);
      
      const newInfoClient = new hl.InfoClient({ transport: newTransport });
      setInfoClient(newInfoClient);
      
      if (isConnected && walletClient && address) {
        const newExchangeClient = new hl.ExchangeClient({
          wallet: walletClient,
          transport: newTransport,
          isTestnet: IS_TESTNET,
        });
        setExchangeClient(newExchangeClient);
      }
      
      setError(null);
    } catch (err) {
      console.error('Error refreshing Hyperliquid clients:', err);
      setError(err instanceof Error ? err.message : 'Failed to refresh Hyperliquid clients');
    }
  }, [isConnected, walletClient, address]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const contextValue: HyperliquidContextType = {
    transport,
    exchangeClient,
    infoClient,
    isReady,
    error,
    refreshClients,
    clearError,
  };

  return (
    <HyperliquidContext.Provider value={contextValue}>
      {children}
    </HyperliquidContext.Provider>
  );
};

