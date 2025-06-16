import { useAuth } from '@/providers/AuthProvider';

export const AuthStatus: React.FC = () => {
  const { isAuthenticated, walletAddress, isLoading, error } = useAuth();

  if (isLoading) {
    return <div className="text-yellow-500">Checking authentication status...</div>;
  }

  if (error) {
    return <div className="text-red-500">Auth Error: {error}</div>;
  }

  if (isAuthenticated && walletAddress) {
    return (
      <div className="text-green-500">
        ✅ Authenticated as: {walletAddress.slice(0, 8)}...{walletAddress.slice(-8)}
      </div>
    );
  }

  return <div className="text-gray-500">Not authenticated</div>;
}; 