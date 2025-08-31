import React, { useCallback, useEffect, createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { useAccount, useSignMessage, useDisconnect } from 'wagmi'; 
import { SiweMessage } from 'siwe'; 
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAction, useMutation as useConvexMutation } from 'convex/react'
import { api as convexApi } from '../../../convex/convex/_generated/api'


export interface AuthState {
  isAuthenticated: boolean;
  walletAddress: string | null;
  isLoading: boolean;
  error: string | null;
}

interface AuthContextType extends AuthState {
  login: () => Promise<void>;
  logout: () => Promise<void>;
  checkAuthStatus: () => Promise<void>;
  clearError: () => void;
}

export const AuthContext = createContext<AuthContextType | null>(null); 

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  
  return context;
}; 

const authKeys = {
  status: ['auth', 'status'] as const,
  nonce: ['auth', 'nonce'] as const,
};

// Hook to check authentication status
export const useAuthStatusQuery = () => {
  return useQuery({
    queryKey: authKeys.status,
    queryFn: async () => {
      const stored = localStorage.getItem('siweAddress') as `0x${string}` | null
      return { address: stored } as { address: string | null }
    },
    retry: false,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
};

// Hook to request nonce
export const useRequestNonceMutation = () => {
  const getNonce = useAction(convexApi.auth.nonce)
  return useMutation({
    mutationFn: async () => {
      const result = await getNonce({})
      return result as { nonce: string }
    },
  })
};

// Hook to login with signature
export const useLoginMutation = () => {
  const queryClient = useQueryClient();
  const verify = useAction(convexApi.auth.verify)
  const ensureUser = useConvexMutation(convexApi.users.ensure)
  return useMutation({
    mutationFn: async ({ message, signature, address, nonce }: {
      message: SiweMessage; 
      signature: `0x${string}`;
      address: `0x${string}`;
      nonce: string;
    }) => {
      const result = await verify({
        message: message.toMessage(),
        signature,
        address,
        nonce,
      } as any)
      if (result && (result as any).success) {
        // Ensure the user exists in Convex
        await ensureUser({ evmAddress: address })
        // Persist a stateless session locally
        localStorage.setItem('siweAddress', address)
      }
      return result
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: authKeys.status });
    },
  });
};

// Hook to logout
export const useLogoutMutation = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async () => {
      localStorage.removeItem('siweAddress')
      return { success: true }
    },
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: authKeys.status });
      queryClient.removeQueries({ queryKey: authKeys.nonce });
    },
  });
}; 

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const { address, chain, isConnected } = useAccount(); 
  const { signMessageAsync } = useSignMessage(); 
  const { disconnect } = useDisconnect(); 
  
  const authStatusQuery = useAuthStatusQuery();
  const requestNonceMutation = useRequestNonceMutation();
  const loginMutation = useLoginMutation();
  const logoutMutation = useLogoutMutation();

  const authState: AuthState = {
    isAuthenticated: !!(authStatusQuery.data && 'address' in authStatusQuery.data && authStatusQuery.data.address),
    walletAddress: (authStatusQuery.data && 'address' in authStatusQuery.data && authStatusQuery.data.address) ? authStatusQuery.data.address : null,
    isLoading: authStatusQuery.isLoading || requestNonceMutation.isPending || loginMutation.isPending || logoutMutation.isPending,
    error: authStatusQuery.error?.message || 
           requestNonceMutation.error?.message || 
           loginMutation.error?.message || 
           logoutMutation.error?.message || 
           null,
  };

  const clearError = useCallback(() => {
    authStatusQuery.refetch();
    requestNonceMutation.reset();
    loginMutation.reset();
    logoutMutation.reset();
  }, [authStatusQuery, requestNonceMutation, loginMutation, logoutMutation]);

  const checkAuthStatus = useCallback(async () => {
    await authStatusQuery.refetch();
  }, [authStatusQuery]);

  const login = useCallback(async () => {
    if (!isConnected || !address || !chain) {
      throw new Error('Wallet not connected, address or chainId not available.');
    }

    try {
      const nonceResult = await requestNonceMutation.mutateAsync();
      if (!nonceResult || !nonceResult.nonce) {
        throw new Error('Nonce not received from server');
      }

      const siweMessage = new SiweMessage({
        domain: window.location.host,
        address: address as `0x${string}`,
        statement: 'Sign in with Ethereum to the app.', 
        uri: window.location.origin,
        version: '1',
        chainId: chain.id,
        nonce: nonceResult.nonce,
      });

      const messageToSign = siweMessage.prepareMessage();
      const signature = await signMessageAsync({ message: messageToSign });
      
      if (!signature) {
        throw new Error('Failed to sign message. User may have cancelled.');
      }
      
      const loginResult = await loginMutation.mutateAsync({
        message: siweMessage,
        signature,
        address: address as `0x${string}`,
        nonce: nonceResult.nonce,
      });

      // Ensure success field is checked correctly, even if type is 'any' or 'unknown'
      if (!loginResult || typeof loginResult !== 'object' || !('success' in (loginResult as object)) || !(loginResult as { success: boolean }).success) {
        throw new Error('Login failed after verification');
      }

      console.log('Login successful!');
      await authStatusQuery.refetch(); 

    } catch (err: any) {
      console.error('Login error:', err);
      throw err; 
    }
  }, [isConnected, address, chain, signMessageAsync, requestNonceMutation, loginMutation, authStatusQuery]);

  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
      disconnect(); 
      console.log('Logout successful!');
    } catch (err: any) {
      console.error('Logout error:', err);
      throw err;
    }
  }, [logoutMutation, disconnect]);

  useEffect(() => {
    if (isConnected && address) {
      checkAuthStatus();
    } 
    // Basic effect, more complex state synchronization (e.g., auto-logout on disconnect) can be added if needed.
  }, [isConnected, address, checkAuthStatus]);

  const contextValue = {
    ...authState,
    login,
    logout,
    checkAuthStatus,
    clearError,
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}; 
