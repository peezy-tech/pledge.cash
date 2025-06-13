import { Link } from '@tanstack/react-router'
// import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'; // Removed Solana's WalletMultiButton
// import { useWallet } from '@solana/wallet-adapter-react'; // Removed Solana's useWallet
import { useAuth } from '../contexts/AuthContext';
import { useAccount, useConnect, useDisconnect } from 'wagmi'; // Added Wagmi hooks
import { ConnectKitButton } from 'connectkit';
import ThemeSwitch from '@/components/ThemeSwitch';

interface AuthButtonProps {
  isConnected: boolean;
  isAuthenticated: boolean;
  isLoading: boolean;
  onLogin: () => Promise<void>;
  onLogout: () => Promise<void>;
}

function AuthButton({ isConnected, isAuthenticated, isLoading, onLogin, onLogout }: AuthButtonProps) {
  if (!isConnected) {
    return <ConnectKitButton />;
  }

  return (
    <div className="flex items-center gap-2">
      {isAuthenticated ? (
        <button 
          onClick={onLogout} 
          disabled={isLoading}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-md transition-colors disabled:opacity-50"
        >
          {isLoading ? 'Logging out...' : 'Logout'}
        </button>
      ) : (
        <button 
          onClick={onLogin} 
          disabled={isLoading}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-md transition-colors disabled:opacity-50"
        >
          {isLoading ? 'Logging in...' : 'Login with Wallet'}
        </button>
      )}
    </div>
  );
}

export default function Header() {
  // useWallet() from Solana is replaced by relying on useAuth and useAccount from Wagmi
  const { isAuthenticated, isLoading, error, login, logout, clearError, walletAddress } = useAuth();
  const { isConnected } = useAccount(); // Use isConnected to decide whether to show ConnectWalletButton

  const handleLogin = async () => {
    // `login` from useAuth is now Wagmi/SIWE compatible
    await login();
  };

  const handleLogout = async () => {
    // `logout` from useAuth is now Wagmi/SIWE compatible (includes disconnect)
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
        <ThemeSwitch />
        <AuthButton 
          isConnected={isConnected}
          isAuthenticated={isAuthenticated}
          isLoading={isLoading}
          onLogin={handleLogin}
          onLogout={handleLogout}
        />
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
