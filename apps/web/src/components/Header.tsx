import { useAuth } from '@/providers/AuthProvider';
import { useAccount } from 'wagmi'; // Added Wagmi hooks
import { ConnectKitButton } from 'connectkit';
import ThemeSwitch from '@/components/ThemeSwitch';
import { NavUser } from './nav-user';

function AuthButton() {
  const { isAuthenticated, isLoading, login, logout } = useAuth();
  const { isConnected } = useAccount();

  if (!isConnected) {
    return <ConnectKitButton />;
  }

  return (
    <div className="flex items-center gap-2">
      {isAuthenticated ? (
        // <button 
        //   onClick={async () => await logout()} 
        //   disabled={isLoading}
        //   className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-md transition-colors disabled:opacity-50"
        // >
        //   {isLoading ? 'Logging out...' : 'Logout'}
        // </button>
        <NavUser user={{
          name: "John Doe",
          email: "john.doe@example.com",
          avatar: "https://github.com/shadcn.png",
        }} />
      ) : (
        <button 
          onClick={async () => await login()} 
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
  const { error, clearError } = useAuth();

  return (
    <header className="p-2 flex gap-4 justify-end items-center">
      <div className="flex items-center gap-2">
        <ThemeSwitch />
        <AuthButton />
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
