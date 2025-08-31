import React, { useCallback, useEffect, createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { useAccount, useSignMessage, useDisconnect } from 'wagmi'; 
import { SiweMessage } from 'siwe'; 
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/utils/api';


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
      const result = await api.siwe.get(); 
      return result.data as { address: string | null } | null;
    },
    retry: false,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
};

// Hook to request nonce
export const useRequestNonceMutation = () => {
  return useMutation({
    mutationFn: async () => {
      const result = await api.siwe.put(undefined);
      return result.data as { nonce: string } | null;
    },
  });
};

// Hook to login with signature
export const useLoginMutation = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ message, signature }: {
      message: SiweMessage; 
      signature: `0x${string}`;
    }) => {
      const result = await api.siwe.post({
        message: message.toMessage(),
        signature,
      });
      return result.data;
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
      const result = await api.siwe.delete();
      return result.data;
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
      console.log({ isConnected, address, chain });
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