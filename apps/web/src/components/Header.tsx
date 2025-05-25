import { Link } from '@tanstack/react-router'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useWallet } from '@solana/wallet-adapter-react';
import { useAuth } from '../hooks/useAuth';

export default function Header() {
  const { connected, publicKey } = useWallet();
  const { isAuthenticated, isLoading, error, login, logout, clearError } = useAuth();

  const handleLogin = async () => {
    await login();
  };

  const handleLogout = async () => {
    await logout();
  };

  return (
    <header className="p-2 flex gap-4 bg-black/30 backdrop-blur-sm text-white justify-between items-center">
      <nav className="flex flex-row gap-2">
        <Link 
          to="/" 
          className="px-3 py-2 font-semibold rounded-md hover:bg-white/20 transition-colors"
          activeProps={{ className: "px-3 py-2 font-semibold rounded-md bg-white/10 transition-colors" }}
          activeOptions={{ exact: true }}
        >
          Home
        </Link>

        <Link 
          to="/launch" 
          className="px-3 py-2 font-semibold rounded-md hover:bg-white/20 transition-colors"
          activeProps={{ className: "px-3 py-2 font-semibold rounded-md bg-white/10 transition-colors" }}
        >
          Launch
        </Link>
        
        <Link 
          to="/profile" 
          className="px-3 py-2 font-semibold rounded-md hover:bg-white/20 transition-colors"
          activeProps={{ className: "px-3 py-2 font-semibold rounded-md bg-white/10 transition-colors" }}
        >
          Profile
        </Link>
      </nav>
      <div className="flex items-center gap-2">
        {connected && publicKey ? (
          <div className="flex items-center gap-2">
            {isAuthenticated ? (
              <button 
                onClick={handleLogout} 
                disabled={isLoading}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-md transition-colors disabled:opacity-50"
              >
                {isLoading ? 'Logging out...' : 'Logout'}
              </button>
            ) : (
              <button 
                onClick={handleLogin} 
                disabled={isLoading}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-md transition-colors disabled:opacity-50"
              >
                {isLoading ? 'Logging in...' : 'Login with Wallet'}
              </button>
            )}
          </div>
        ) : (
          <WalletMultiButton />
        )}
        {error && (
          <div className="flex items-center gap-2">
            <p className="text-red-500 text-sm">Error: {error}</p>
            <button 
              onClick={clearError}
              className="text-red-400 hover:text-red-300 text-sm underline"
            >
              Clear
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
