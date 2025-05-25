import React, { useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import bs58 from 'bs58';
import { AuthContext } from '../contexts/AuthContext';
import type { AuthState } from '../contexts/AuthContext';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/utils/api';

// Query keys for auth operations
export const authKeys = {
  status: ['auth', 'status'] as const,
  nonce: ['auth', 'nonce'] as const,
};

// Hook to check authentication status
export const useAuthStatusQuery = () => {
  return useQuery({
    queryKey: authKeys.status,
    queryFn: async () => {
      const result = await api.auth_token.get();
      return result.data;
    },
    retry: false,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
};

// Hook to request nonce
export const useRequestNonceMutation = () => {
  return useMutation({
    mutationFn: async () => {
      const result = await api.auth_token.put();
      return result.data;
    },
  });
};

// Hook to login with signature
export const useLoginMutation = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ message, signature, walletAddress }: {
      message: string;
      signature: string;
      walletAddress: string;
    }) => {
      const result = await api.auth_token.post({
        message,
        signature,
        walletAddress,
      });
      return result.data;
    },
    onSuccess: () => {
      // Invalidate auth status query to refetch user data
      queryClient.invalidateQueries({ queryKey: authKeys.status });
    },
  });
};

// Hook to logout
export const useLogoutMutation = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async () => {
      const result = await api.auth_token.delete();
      return result.data;
    },
    onSuccess: () => {
      // Clear all auth-related queries
      queryClient.removeQueries({ queryKey: authKeys.status });
      queryClient.removeQueries({ queryKey: authKeys.nonce });
    },
  });
}; 

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const { connected, publicKey, signMessage } = useWallet();
  
  // React Query hooks
  const authStatusQuery = useAuthStatusQuery();
  const requestNonceMutation = useRequestNonceMutation();
  const loginMutation = useLoginMutation();
  const logoutMutation = useLogoutMutation();

  // Derive auth state from React Query states
  const authState: AuthState = {
    isAuthenticated: !!(authStatusQuery.data && 'walletAddress' in authStatusQuery.data && authStatusQuery.data.walletAddress),
    walletAddress: (authStatusQuery.data && 'walletAddress' in authStatusQuery.data) ? (authStatusQuery.data.walletAddress || null) : null,
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
    if (!publicKey || !signMessage) {
      // We can't easily set a custom error with React Query mutations
      // So we'll throw an error that will be caught by the mutation
      throw new Error('Wallet not connected or signMessage not available.');
    }

    try {
      // Step 1: Fetch nonce
      const nonceResult = await requestNonceMutation.mutateAsync();
      
      if (!nonceResult || !('nonce' in nonceResult) || !nonceResult.nonce) {
        throw new Error('Nonce not received from server');
      }

      // Step 2: Prepare and sign message
      const message = `Sign this message to log in to DramaSystem. Nonce: ${nonceResult.nonce}`;
      const messageBytes = new TextEncoder().encode(message);
      const signature = await signMessage(messageBytes);
      
      if (!signature) {
        throw new Error('Failed to sign message. User may have cancelled.');
      }

      // Step 3: Send signature to backend for verification
      const loginResult = await loginMutation.mutateAsync({
        message,
        signature: bs58.encode(signature),
        walletAddress: publicKey.toBase58(),
      });

      console.log('loginResult', loginResult);

      if (!loginResult || typeof loginResult !== 'object' || !('success' in loginResult) || !loginResult.success) {
        throw new Error('Login failed after verification');
      }

      console.log('Login successful!');

    } catch (err: any) {
      console.error('Login error:', err);
      throw err; // Re-throw to let React Query handle the error state
    }
  }, [publicKey, signMessage, requestNonceMutation, loginMutation]);

  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
      console.log('Logout successful!');
    } catch (err: any) {
      console.error('Logout error:', err);
      throw err; // Re-throw to let React Query handle the error state
    }
  }, [logoutMutation]);

  // Check auth status when wallet connection changes
  useEffect(() => {
    if (connected && publicKey) {
      checkAuthStatus();
    }
  }, [connected, publicKey, checkAuthStatus]);

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