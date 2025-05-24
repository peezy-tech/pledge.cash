import { Link } from '@tanstack/react-router'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useWallet } from '@solana/wallet-adapter-react';
import { useState } from 'react';
import bs58 from 'bs58';

// Define the API base URL - adjust if your setup is different
const API_BASE_URL = 'http://localhost:3000'; 

export default function Header() {
  const { connected, publicKey, signMessage } = useWallet();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    if (!publicKey || !signMessage) {
      setError('Wallet not connected or signMessage not available.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Step 1: Fetch nonce
      const nonceResponse = await fetch(`${API_BASE_URL}/auth_token`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      });

      if (!nonceResponse.ok) {
        const errData = await nonceResponse.json();
        throw new Error(errData.error || 'Failed to fetch nonce');
      }
      const { nonce } = await nonceResponse.json();
      if (!nonce) {
        throw new Error('Nonce not received from server');
      }

      // Step 2: Prepare and sign message
      const message = `Sign this message to log in to DramaSystem. Nonce: ${nonce}`;
      const messageBytes = new TextEncoder().encode(message);
      const signature = await signMessage(messageBytes);
      if (!signature) {
        throw new Error('Failed to sign message. User may have cancelled.');
      }

      // Step 3: Send signature to backend for verification
      const loginResponse = await fetch(`${API_BASE_URL}/auth_token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message,
          signature: bs58.encode(signature),
          walletAddress: publicKey.toBase58(),
        }),
        credentials: 'include',
      });

      if (!loginResponse.ok) {
        const errData = await loginResponse.json();
        throw new Error(errData.error || 'Login failed');
      }

      const loginResult = await loginResponse.json();
      if (loginResult.success) {
        console.log('Login successful!');
        // Optionally, trigger a state update or redirect here
        // For now, the cookie is set, and future requests will be authenticated.
      } else {
        throw new Error(loginResult.error || 'Login failed after verification');
      }

    } catch (err: any) {
      console.error('Login error:', err);
      setError(err.message || 'An unknown error occurred during login.');
    } finally {
      setIsLoading(false);
    }
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
          <button 
            onClick={handleLogin} 
            disabled={isLoading}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-md transition-colors disabled:opacity-50"
          >
            {isLoading ? 'Logging in...' : 'Login with Wallet'}
          </button>
        ) : (
          <WalletMultiButton />
        )}
        {error && <p className="text-red-500 text-sm">Error: {error}</p>}
      </div>
    </header>
  )
}
