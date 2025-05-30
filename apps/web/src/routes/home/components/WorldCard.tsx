import { useState, useEffect } from 'react';
import {
  Connection,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { useNavigate } from '@tanstack/react-router';
import {
  DynamicBondingCurveClient
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import type { 
  VirtualPool,
  PoolConfig,
  QuoteResult,
  // SwapQuoteParam, // Not directly used in state, but in function calls
  // SwapParam, // Not directly used in state, but in function calls
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";
import { Buffer } from 'buffer'; // Required if transactions are serialized/deserialized client-side

// Assuming WorldGrid passes these, based on previous steps
interface WorldCardProps {
  id: string; // This is the poolAddress / baseMintAddress / game server ID
  title: string;
  imageUrl: string;
  price: number; 
  poolData: VirtualPool;
  poolConfig: PoolConfig;
  baseDecimals: number | null;
  quoteDecimals: number | null;
  gameServerStatus?: "starting" | "running" | "stopping" | "stopped"; // Explicitly list statuses
  gameServerUrl?: string;
}

// Define GameServer type for API response typing
interface GameServerDataFromApi {
    id: string;
    port: number;
    url: string;
    status: "starting" | "running" | "stopping" | "stopped";
    // other fields like containerId, createdAt might be present
}

// Re-define or import if available globally
const RPC_URL = "https://devnet.helius-rpc.com/?api-key=81b1290d-9852-4dcc-9c9c-4a4be7ddf3e3";

// Helper function from CreateSwapForm / WorldGrid
const formatBnWithDecimals = (bn: BN | undefined | null, decimals: number | null): string => {
  if (!bn || decimals === null) return "N/A";
  const bnString = bn.toString();
  const isNegative = bnString[0] === '-';
  const absBnString = isNegative ? bnString.substring(1) : bnString;
  
  let wholePart = absBnString;
  let fractionalPart = '';

  if (absBnString.length > decimals) {
      wholePart = absBnString.slice(0, absBnString.length - decimals);
      fractionalPart = absBnString.slice(absBnString.length - decimals);
  } else {
      wholePart = '0';
      fractionalPart = '0'.repeat(decimals - absBnString.length) + absBnString;
  }
  
  fractionalPart = fractionalPart.replace(/0+$/, '');
  if (fractionalPart.length === 0) {
      return (isNegative ? '-' : '') + wholePart;
  }
  return (isNegative ? '-' : '') + wholePart + "." + fractionalPart;
};

// Buffer polyfill for browser environment if not already global
if (typeof window !== 'undefined') {
  window.Buffer = window.Buffer || Buffer;
}

export function WorldCard({ 
  id, 
  title, 
  imageUrl, 
  poolData, 
  poolConfig,
  baseDecimals,
  quoteDecimals,
  gameServerStatus: initialServerStatus, // Renamed for clarity
  gameServerUrl: initialServerUrl     // Renamed for clarity
}: WorldCardProps) {
  const { publicKey: ownerPublicKey, signTransaction, connected } = useWallet();
  const navigate = useNavigate();

  const [isFlipped, setIsFlipped] = useState(false);
  const [amountIn, setAmountIn] = useState("1"); // Default to 1, user can change
  const [swapDirection, setSwapDirection] = useState<"quote_to_base" | "base_to_quote">("quote_to_base");
  // Referral account - can be added as an input if needed
  // const [referralAccount, setReferralAccount] = useState(""); 

  const [quote, setQuoteResult] = useState<QuoteResult | null>(null);
  const [minimumAmountOutToDisplay, setMinimumAmountOutToDisplay] = useState<BN | null>(null);
  const [transactionSignature, setTransactionSignature] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  // New state for game server interaction
  const [currentServerStatus, setCurrentServerStatus] = useState(initialServerStatus);
  const [currentServerUrl, setCurrentServerUrl] = useState(initialServerUrl);
  const [isInitializingWorld, setIsInitializingWorld] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  useEffect(() => {
    setCurrentServerStatus(initialServerStatus);
    setCurrentServerUrl(initialServerUrl);
  }, [initialServerStatus, initialServerUrl]);

  const calculateCurveProgress = () => {
    if (!poolData || !poolConfig || !poolConfig.migrationQuoteThreshold || poolConfig.migrationQuoteThreshold.isZero()) {
      return 0; // Or handle as an error/unavailable
    }
    if (!poolData.quoteReserve) { // Ensure quoteReserve is used
      return 0;
    }

    const threshold = poolConfig.migrationQuoteThreshold;
    const currentBalance = poolData.quoteReserve; // Ensure quoteReserve is used

    // Progress calculation (as a percentage)
    const progress = (currentBalance.toNumber() / threshold.toNumber()) * 100;
    return Math.min(progress, 100); // Cap at 100%
  };

  const handleFlip = () => {
    setIsFlipped(!isFlipped);
    // Reset swap-specific state when flipping away from the back
    if (isFlipped) {
        setQuoteResult(null);
        setMinimumAmountOutToDisplay(null);
        setError("");
        setTransactionSignature("");
    }
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAmountIn(e.target.value);
  };

  const handleGetQuote = async () => {
    if (!connected || !ownerPublicKey) {
      setError("Wallet not connected.");
      return;
    }
    if (!poolData || !poolConfig || baseDecimals === null || quoteDecimals === null) {
      setError("Pool details or token decimals are missing for this card.");
      return;
    }
    if (!amountIn) {
      setError("Amount in is required.");
      return;
    }
    
    setIsLoading(true);
    setError("");
    setQuoteResult(null);
    setMinimumAmountOutToDisplay(null);
    setTransactionSignature("");

    try {
      const connection = new Connection(RPC_URL, "confirmed");
      const client = new DynamicBondingCurveClient(connection as any, "confirmed");
      
      const currentDecimals = swapDirection === "quote_to_base" ? quoteDecimals : baseDecimals;
      const parsedAmountIn = parseFloat(amountIn);
      if (isNaN(parsedAmountIn) || parsedAmountIn <= 0) {
        setError("Invalid amount. Please enter a positive number.");
        setIsLoading(false);
        return;
      }
      const amountInBn = new BN(parsedAmountIn * Math.pow(10, currentDecimals));

      // Determine currentPoint for the quote (slot or timestamp based on config)
      // Replicating logic from CreateSwapForm, simplified for now
      let currentPointVal = new BN(0);
      if (poolConfig.activationType === 0) { // Slot based
        currentPointVal = new BN(await connection.getSlot("confirmed"));
      } else { // Timestamp based - using slot as a proxy for simplicity here
        console.warn("ActivationType is Timestamp, using current slot for quote. May need adjustment for production.");
        currentPointVal = new BN(await connection.getSlot("confirmed"));
      }

      const swapQuoteParam = {
        virtualPool: poolData,
        config: poolConfig,
        swapBaseForQuote: swapDirection === "base_to_quote",
        amountIn: amountInBn,
        slippageBps: 50, // Default slippage, make configurable if needed
        hasReferral: false, // Set true if referralAccount is used
        currentPoint: currentPointVal,
      };

      const quoteResultData = await client.pool.swapQuote(swapQuoteParam);
      setQuoteResult(quoteResultData);
      // The SDK's QuoteResult type should have amountOut. minAmountOut might be calculated based on slippage or part of the result.
      // Assuming quoteResultData includes minAmountOut or it's derived like in CreateSwapForm
      setMinimumAmountOutToDisplay((quoteResultData as any).minAmountOut || quoteResultData.amountOut);

    } catch (err: any) {
      console.error("Error getting quote:", err);
      setError(`Failed to get quote: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSwap = async () => {
    if (!connected || !ownerPublicKey || !signTransaction) {
      setError("Wallet not connected or signing function unavailable.");
      return;
    }
    if (!poolData || baseDecimals === null || quoteDecimals === null) { 
      setError("Pool details or token decimals are missing.");
      return;
    }
    if (!amountIn) {
      setError("Amount in is required.");
      return;
    }
    if (!quote || !minimumAmountOutToDisplay) {
      setError("Please get a quote first, or quote is missing minimum amount out.");
      return;
    }
    
    const currentDecimals = swapDirection === "quote_to_base" ? quoteDecimals : baseDecimals;
    const parsedAmountIn = parseFloat(amountIn);
    // Redundant check, but good for safety
    if (isNaN(parsedAmountIn) || parsedAmountIn <= 0) {
      setError("Invalid amount for swapping.");
      return;
    }
    const amountInBn = new BN(parsedAmountIn * Math.pow(10, currentDecimals));

    setIsLoading(true);
    setError("");
    setTransactionSignature("");

    try {
      const connection = new Connection(RPC_URL, "confirmed");
      const client = new DynamicBondingCurveClient(connection as any, "confirmed");
      const poolPubKey = new PublicKey(id); // id is the poolAddress

      // const referralTokenAccountPubKey = referralAccount ? new PublicKey(referralAccount) : null;

      const swapTxParam = {
        owner: ownerPublicKey,
        amountIn: amountInBn,
        minimumAmountOut: minimumAmountOutToDisplay, 
        swapBaseForQuote: swapDirection === "base_to_quote",
        pool: poolPubKey, 
        referralTokenAccount: null, // Set if referral is implemented
      };
      
      // More explicit casting for the transaction from the SDK
      let sdkTransaction = await client.pool.swap(swapTxParam) as unknown as Transaction;
      
      // Ensure feePayer and recentBlockhash are set on sdkTransaction BEFORE serialization
      if (!ownerPublicKey) {
        setError("Wallet owner public key not found. Cannot set fee payer.");
        setIsLoading(false);
        return;
      }
      sdkTransaction.feePayer = ownerPublicKey;
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      sdkTransaction.recentBlockhash = blockhash;

      // Now serialize the completed sdkTransaction
      const serializedSdkTx = sdkTransaction.serialize({ requireAllSignatures: false, verifySignatures: false });

      // Deserialize for the type workaround, though sdkTransaction is now complete
      const transaction = Transaction.from(serializedSdkTx);

      // Re-assigning to `transaction` might be redundant if `Transaction.from` preserves them perfectly,
      // but it ensures the `transaction` object we pass to `signTransaction` has them according to its type definition.
      transaction.feePayer = ownerPublicKey; 
      transaction.recentBlockhash = blockhash;

      // Cast to `any` as a workaround for persistent type mismatch issues
      const signedTransaction = await signTransaction(transaction as any);
      const signature = await connection.sendRawTransaction(signedTransaction.serialize(), {
        skipPreflight: true, // Often recommended for faster confirmation with complex txs
      });

      const confirmation = await connection.confirmTransaction(signature, "confirmed");
      if (confirmation.value.err) {
        throw new Error(`Solana transaction confirmation error: ${JSON.stringify(confirmation.value.err)}`);
      }
      
      setTransactionSignature(signature);
      console.log(`Swap completed: https://solscan.io/tx/${signature}?cluster=devnet`);
      setQuoteResult(null); // Reset quote after successful swap
      setMinimumAmountOutToDisplay(null);

    } catch (err: any) {
      console.error("Error executing swap:", err);
      setError(`Failed to execute swap: ${err.message} - ${err.stack ? err.stack : ''}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConnectOrLaunchWorld = async () => {
    setConnectError(null);
    const baseMintForServerId = poolData.baseMint.toBase58();

    if (currentServerStatus === 'running' && currentServerUrl) {
      navigate({ to: '/play-game', search: { url: currentServerUrl } });
      return;
    }

    setIsInitializingWorld(true);
    try {
      console.log(`Attempting to ensure/launch server for baseMint: ${baseMintForServerId}`);
      const response = await fetch(`/api/game-servers/ensure/${baseMintForServerId}`, {
        method: 'POST',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to ensure server and parse error json' }));
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }

      const result: { success: boolean; data?: GameServerDataFromApi; error?: string } = await response.json();

      if (result.success && result.data && result.data.url) {
        setCurrentServerStatus(result.data.status);
        setCurrentServerUrl(result.data.url);
        // If it's now running (or was already but URL was missing), navigate
        if (result.data.status === 'running') {
            navigate({ to: '/play-game', search: { url: result.data.url } });
        } else {
            // It might be 'starting', user will see "Initializing World..." or similar updated status
            console.log("Server is starting, user will see updated status.");
        }
      } else {
        throw new Error(result.error || 'Failed to get server details after ensuring.');
      }
    } catch (err: any) {
      console.error("Error connecting or launching world:", err);
      setConnectError(err.message || "Could not connect or launch the world.");
    } finally {
      setIsInitializingWorld(false);
    }
  };

  const containerStyle: React.CSSProperties = {
    width: '256px',
    height: '380px', // Increased height for swap form elements
    position: 'relative',
    cursor: 'default', // Changed from pointer as flip is via button now
    perspective: '1000px'
  };

  const cardInnerStyle: React.CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100%',
    transition: 'transform 0.6s',
    transformStyle: 'preserve-3d',
    transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
    borderRadius: '12px',
    boxShadow: '0px 4px 15px rgba(0, 0, 0, 0.2)',
  };

  const cardFaceStyle: React.CSSProperties = {
    position: 'absolute',
    width: '100%',
    height: '100%',
    backfaceVisibility: 'hidden',
    borderRadius: '12px',
    overflow: 'hidden',
    backgroundColor: 'rgba(0, 0, 0, 0.6)', // Slightly darker for better text contrast
    backdropFilter: 'blur(5px)', // Increased blur
    color: 'white',
    display: 'flex', 
    flexDirection: 'column'
  };

  const cardFrontStyle: React.CSSProperties = {
    ...cardFaceStyle,
    zIndex: 2
  };

  const cardBackStyle: React.CSSProperties = {
    ...cardFaceStyle,
    transform: 'rotateY(180deg)',
    padding: '16px', 
    justifyContent: 'space-between', 
  };
  
  const inputStyle: React.CSSProperties = {
    width: '100%', 
    padding: '8px 12px', 
    backgroundColor: 'rgba(55, 65, 81, 0.8)', 
    borderRadius: '4px', 
    color: 'white',
    border: '1px solid rgba(255,255,255,0.2)',
    boxSizing: 'border-box' // Ensure padding doesn't expand width
  };

  const buttonStyleBase: React.CSSProperties = {
    color: 'white', 
    padding: '10px 0', // Increased padding
    borderRadius: '4px',
    transition: 'background-color 0.3s',
    border: 'none',
    cursor: 'pointer',
    fontSize: '0.9rem'
  };

  const flipIconContainerStyle: React.CSSProperties = {
    position: 'absolute',
    width: '28px', // Slightly larger
    height: '28px',
    padding: '0',
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    backdropFilter: 'blur(3px)',
    borderRadius: '4px',
    cursor: 'pointer',
    zIndex: 10, // Ensure it's above other elements
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
  
  const RadioLabelStyle: React.CSSProperties = {
    fontSize: '0.8rem',
    marginRight: '10px',
    display: 'flex',
    alignItems: 'center'
  };

  const RadioInputStyle: React.CSSProperties = {
    marginRight: '4px',
    accentColor: '#4ade80'
  };

  const connectButtonStyle: React.CSSProperties = {
    ...buttonStyleBase,
    backgroundColor: '#10b981', // Green color for connect
    marginTop: '10px',
    width: 'calc(100% - 32px)', // Full width minus padding
    margin: '10px auto 0 auto',
    display: 'block'
  };

  const disabledConnectButtonStyle: React.CSSProperties = {
    ...connectButtonStyle,
    backgroundColor: '#6b7280', // Gray color for disabled
    cursor: 'not-allowed',
  };

  return (
    <div style={containerStyle}>
      <div style={cardInnerStyle}>
        {/* Front Side */}
        <div style={cardFrontStyle}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <img 
              src={imageUrl} 
              alt={title} 
              style={{ 
                width: '100%', 
                height: '192px', 
                objectFit: 'cover',
              }}
            />
            <div style={{ 
              position: 'absolute', 
              inset: 0, 
              background: 'linear-gradient(to top, rgba(0,0,0,0.8), transparent)', 
              opacity: 0.6 
            }}></div>
            <div
              onClick={(e) => { e.stopPropagation(); handleFlip(); }}
              style={{...flipIconContainerStyle, bottom: '8px', right: '8px'}}
            >
              <img src="/flip.png" alt="Flip card" style={{ width: '70%', height: '70%' }} />
            </div>
          </div>
          <div style={{ padding: '16px', flexGrow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-around' }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 'bold', marginBottom: '4px', textAlign: 'center' }}>{title}</h3>
            <p style={{ color: '#4ade80', fontSize: '1.0rem', textAlign: 'center', marginBottom: '8px' }}>
              Curve Progress: {calculateCurveProgress().toFixed(2)}%
            </p>
            
            <button 
              onClick={handleConnectOrLaunchWorld} 
              style={isInitializingWorld ? disabledConnectButtonStyle : connectButtonStyle} // Style might need adjustment
              disabled={isInitializingWorld}
            >
              {isInitializingWorld 
                ? 'Initializing World...' 
                : (currentServerStatus === 'running' && currentServerUrl) 
                  ? 'Connect to World' 
                  : 'Launch World'}
            </button>
            {connectError && <p style={{color: 'red', fontSize: '0.8rem', textAlign: 'center', marginTop: '5px'}}>{connectError}</p>}

          </div>
        </div>

        {/* Back Side - Swap Form */}
        <div style={cardBackStyle}>
            <div
              onClick={(e) => { e.stopPropagation(); handleFlip(); }}
              style={{...flipIconContainerStyle, top: '8px', right: '8px'}}
            >
              <img src="/flip.png" alt="Flip card" style={{ width: '70%', height: '70%' }} />
            </div>
          <h4 style={{ fontSize: '1.1rem', fontWeight: 'bold', marginBottom: '10px', textAlign: 'center' }}>Swap: {title}</h4>
          
          <div style={{ marginBottom: '10px' }}>
            <label htmlFor={`amount-${id}`} style={{ display: 'block', marginBottom: '4px', fontSize: '0.8rem' }}>
              Amount In:
            </label>
            <input
              id={`amount-${id}`}
              type="number"
              min="0.000001" // Allow small decimal inputs
              step="any"
              value={amountIn}
              onChange={handleAmountChange}
              style={inputStyle}
              placeholder={`Amount of ${swapDirection === "quote_to_base" ? "Quote" : "Base"}`}
              onClick={(e) => e.stopPropagation()} // Prevent card flip on input click
              disabled={isLoading}
            />
          </div>

          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '0.8rem', marginBottom: '4px'}}>Swap Direction:</div>
            <div style={{ display: 'flex', justifyContent: 'space-around'}}>
                <label style={RadioLabelStyle} onClick={(e) => e.stopPropagation()}>
                    <input 
                        type="radio" 
                        name={`swapDirection-${id}`} 
                        value="quote_to_base" 
                        checked={swapDirection === "quote_to_base"}
                        onChange={() => setSwapDirection("quote_to_base")}
                        style={RadioInputStyle}
                        disabled={isLoading}
                    /> Buy Base (Quote to Base)
                </label>
                <label style={RadioLabelStyle} onClick={(e) => e.stopPropagation()}>
                    <input 
                        type="radio" 
                        name={`swapDirection-${id}`} 
                        value="base_to_quote" 
                        checked={swapDirection === "base_to_quote"}
                        onChange={() => setSwapDirection("base_to_quote")}
                        style={RadioInputStyle}
                        disabled={isLoading}
                    /> Sell Base (Base to Quote)
                </label>
            </div>
          </div>

          <button 
            style={{ 
                ...buttonStyleBase, 
                backgroundColor: isLoading && !transactionSignature ? '#fbbf24' : '#38bdf8', // amber for loading, sky for default
                marginBottom: '8px',
                width: '100%'
            }}
            onClick={(e) => { e.stopPropagation(); handleGetQuote(); }}
            disabled={isLoading || !connected || !poolData || baseDecimals === null || quoteDecimals === null}
          >
            {isLoading && !quote && !error ? "Getting Quote..." : "Get Quote"}
          </button>

          {quote && baseDecimals !== null && quoteDecimals !== null && (
            <div style={{ fontSize: '0.75rem', marginBottom: '8px', padding: '6px', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: '4px' }}>
              <p><strong>Est. Amount Out:</strong> {formatBnWithDecimals(quote.amountOut, swapDirection === 'quote_to_base' ? baseDecimals : quoteDecimals)}</p>
              {minimumAmountOutToDisplay && <p><strong>Min. Amount Out:</strong> {formatBnWithDecimals(minimumAmountOutToDisplay, swapDirection === 'quote_to_base' ? baseDecimals : quoteDecimals)}</p>}
              {/* Add more quote details if needed, e.g., price impact, fees */}
            </div>
          )}

          <button 
            style={{ 
                ...buttonStyleBase, 
                backgroundColor: isLoading && quote ? '#fbbf24' : (quote ? '#22c55e' : '#6b7280'), // amber for loading, green for ready, gray for disabled
                width: '100%'
            }}
            onClick={(e) => { e.stopPropagation(); handleSwap(); }}
            disabled={isLoading || !quote || !minimumAmountOutToDisplay || !connected}
          >
            {isLoading && quote ? "Swapping..." : (connected ? "Execute Swap" : "Connect Wallet")}
          </button>

          {error && (
            <div style={{ color: '#f87171', fontSize: '0.75rem', marginTop: '8px', textAlign:'center', wordBreak: 'break-word' }}>
              Error: {error}
            </div>
          )}
          {transactionSignature && (
            <div style={{ color: '#4ade80', fontSize: '0.75rem', marginTop: '8px', textAlign:'center', wordBreak: 'break-word' }}>
              Success! <a href={`https://solscan.io/tx/${transactionSignature}?cluster=devnet`} target="_blank" rel="noopener noreferrer" style={{color: '#38bdf8', textDecoration:'underline'}}>View on Solscan</a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
} 