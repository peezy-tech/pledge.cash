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
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";
import { Buffer } from 'buffer';
// Import React Query and api helper for mutations
import { useMutation } from '@tanstack/react-query';
import { api } from '@/utils/api'; // Assuming api helper path

interface WorldCardProps {
  id: string; 
  title: string;
  imageUrl: string;
  price: number; 
  poolData: VirtualPool;
  poolConfig: PoolConfig;
  baseDecimals: number | null;
  quoteDecimals: number | null;
  gameServerStatus?: "starting" | "running" | "stopping" | "stopped";
  gameServerUrl?: string;
}

interface GameServerDataFromApi {
    id: string;
    port: number;
    url: string;
    status: "starting" | "running" | "stopping" | "stopped";
}

const RPC_URL = "https://devnet.helius-rpc.com/?api-key=81b1290d-9852-4dcc-9c9c-4a4be7ddf3e3";

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

if (typeof window !== 'undefined') {
  window.Buffer = window.Buffer || Buffer;
}

// Define the mutation hook for ensuring/launching a game server
const useEnsureGameServerMutation = () => {
  return useMutation<GameServerDataFromApi, Error, string>({ // Result type, Error type, Variables type (serverId)
    mutationFn: async (serverId: string) => {
      // Assuming path is /api/game-servers/ensure/:serverId and it's a POST request
      // The body for POST might be empty or specific; assuming empty based on original fetch.
      // If api helper requires a body for post even if empty, pass {}.
      const response = await api['game-servers'].ensure[serverId].post({}); 

      if (response.error) {
        const errorValue = response.error.value as { error?: string; message?: string };
        throw new Error(errorValue?.error || errorValue?.message || `API Error ${response.error.status} ensuring server ${serverId}`);
      }

      if (response.data && (response.data as any).success && (response.data as any).data) {
        return (response.data as any).data as GameServerDataFromApi;
      }
      const detailMessage = (response.data as any)?.error || 'Invalid data structure or failed to ensure server.';
      throw new Error(detailMessage);
    },
    // onSuccess, onError, onSettled callbacks can be used here if needed
  });
};

export function WorldCard({ 
  id, 
  title, 
  imageUrl, 
  poolData, 
  poolConfig,
  baseDecimals,
  quoteDecimals,
  gameServerStatus: initialServerStatus, 
  gameServerUrl: initialServerUrl     
}: WorldCardProps) {
  const { publicKey: ownerPublicKey, signTransaction, connected } = useWallet();
  const navigate = useNavigate();
  const ensureGameServerMutation = useEnsureGameServerMutation();

  const [isFlipped, setIsFlipped] = useState(false);
  const [amountIn, setAmountIn] = useState("1");
  const [swapDirection, setSwapDirection] = useState<"quote_to_base" | "base_to_quote">("quote_to_base");
  const [quote, setQuoteResult] = useState<QuoteResult | null>(null);
  const [minimumAmountOutToDisplay, setMinimumAmountOutToDisplay] = useState<BN | null>(null);
  const [transactionSignature, setTransactionSignature] = useState("");
  const [isLoadingSwap, setIsLoadingSwap] = useState(false); // Renamed from isLoading to avoid conflict
  const [swapError, setSwapError] = useState(""); // Renamed from error

  const [currentServerStatus, setCurrentServerStatus] = useState(initialServerStatus);
  const [currentServerUrl, setCurrentServerUrl] = useState(initialServerUrl);
  // isInitializingWorld will be ensureGameServerMutation.isPending
  // connectError will be ensureGameServerMutation.error

  useEffect(() => {
    setCurrentServerStatus(initialServerStatus);
    setCurrentServerUrl(initialServerUrl);
  }, [initialServerStatus, initialServerUrl]);

  // Update local state when mutation is successful
  useEffect(() => {
    if (ensureGameServerMutation.isSuccess && ensureGameServerMutation.data) {
      const serverData = ensureGameServerMutation.data;
      setCurrentServerStatus(serverData.status);
      setCurrentServerUrl(serverData.url);
      if (serverData.status === 'running' && serverData.url) {
        navigate({ to: '/play-game', search: { url: serverData.url } });
      }
    }
  }, [ensureGameServerMutation.isSuccess, ensureGameServerMutation.data, navigate]);

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
    if (isFlipped) {
        setQuoteResult(null);
        setMinimumAmountOutToDisplay(null);
        setSwapError("");
        setTransactionSignature("");
    }
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAmountIn(e.target.value);
  };

  const handleGetQuote = async () => {
    if (!connected || !ownerPublicKey) {
      setSwapError("Wallet not connected.");
      return;
    }
    if (!poolData || !poolConfig || baseDecimals === null || quoteDecimals === null) {
      setSwapError("Pool details or token decimals are missing for this card.");
      return;
    }
    if (!amountIn) {
      setSwapError("Amount in is required.");
      return;
    }
    
    setIsLoadingSwap(true);
    setSwapError("");
    setQuoteResult(null);
    setMinimumAmountOutToDisplay(null);
    setTransactionSignature("");

    try {
      const connection = new Connection(RPC_URL, "confirmed");
      const client = new DynamicBondingCurveClient(connection as any, "confirmed");
      
      const currentDecimals = swapDirection === "quote_to_base" ? quoteDecimals : baseDecimals;
      const parsedAmountIn = parseFloat(amountIn);
      if (isNaN(parsedAmountIn) || parsedAmountIn <= 0) {
        setSwapError("Invalid amount. Please enter a positive number.");
        setIsLoadingSwap(false);
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
      setSwapError(`Failed to get quote: ${err.message}`);
    } finally {
      setIsLoadingSwap(false);
    }
  };

  const handleSwap = async () => {
    if (!connected || !ownerPublicKey || !signTransaction) {
      setSwapError("Wallet not connected or signing function unavailable.");
      return;
    }
    if (!poolData || baseDecimals === null || quoteDecimals === null) { 
      setSwapError("Pool details or token decimals are missing.");
      return;
    }
    if (!amountIn) {
      setSwapError("Amount in is required.");
      return;
    }
    if (!quote || !minimumAmountOutToDisplay) {
      setSwapError("Please get a quote first, or quote is missing minimum amount out.");
      return;
    }
    
    const currentDecimals = swapDirection === "quote_to_base" ? quoteDecimals : baseDecimals;
    const parsedAmountIn = parseFloat(amountIn);
    if (isNaN(parsedAmountIn) || parsedAmountIn <= 0) {
      setSwapError("Invalid amount for swapping.");
      return;
    }
    const amountInBn = new BN(parsedAmountIn * Math.pow(10, currentDecimals));

    setIsLoadingSwap(true);
    setSwapError("");
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
        setSwapError("Wallet owner public key not found. Cannot set fee payer.");
        setIsLoadingSwap(false);
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
      setSwapError(`Failed to execute swap: ${err.message} - ${err.stack ? err.stack : ''}`);
    } finally {
      setIsLoadingSwap(false);
    }
  };

  const handleConnectOrLaunchWorld = async () => {
    ensureGameServerMutation.reset(); // Clear previous error states from the mutation
    const baseMintForServerId = poolData.baseMint.toBase58();

    if (currentServerStatus === 'running' && currentServerUrl) {
      navigate({ to: '/play-game', search: { url: currentServerUrl } });
      return;
    }

    try {
      console.log(`Attempting to ensure/launch server for baseMint: ${baseMintForServerId}`);
      // The actual call and state updates are handled by the mutation hook and its useEffect
      await ensureGameServerMutation.mutateAsync(baseMintForServerId);
      // Success and navigation are handled in the useEffect listening to ensureGameServerMutation.isSuccess
    } catch (err) {
      // Error is already captured by ensureGameServerMutation.error
      // The useEffect for isError could update a local error state if needed for display,
      // or the error can be directly accessed from ensureGameServerMutation.error for rendering.
      console.error("Error caught by handleConnectOrLaunchWorld after mutateAsync:", err);
      // No need to set local error here if it's derived from mutation.error
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
    backgroundColor: '#10b981', 
    marginTop: '10px',
    width: 'calc(100% - 32px)', 
    margin: '10px auto 0 auto',
    display: 'block'
  };

  const disabledConnectButtonStyle: React.CSSProperties = {
    ...connectButtonStyle,
    backgroundColor: '#6b7280', 
    cursor: 'not-allowed',
  };
  
  const isInitializingWorld = ensureGameServerMutation.isPending;
  const connectError = ensureGameServerMutation.error?.message || null;

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
              style={isInitializingWorld ? disabledConnectButtonStyle : connectButtonStyle} 
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
              min="0.000001" 
              step="any"
              value={amountIn}
              onChange={handleAmountChange}
              style={inputStyle}
              placeholder={`Amount of ${swapDirection === "quote_to_base" ? "Quote" : "Base"}`}
              onClick={(e) => e.stopPropagation()} 
              disabled={isLoadingSwap || ensureGameServerMutation.isPending} // Disable if initializing world too
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
                        disabled={isLoadingSwap || ensureGameServerMutation.isPending}
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
                        disabled={isLoadingSwap || ensureGameServerMutation.isPending}
                    /> Sell Base (Base to Quote)
                </label>
            </div>
          </div>

          <button 
            style={{ 
                ...buttonStyleBase, 
                backgroundColor: isLoadingSwap && !transactionSignature ? '#fbbf24' : '#38bdf8', // amber for loading, sky for default
                marginBottom: '8px',
                width: '100%'
            }}
            onClick={(e) => { e.stopPropagation(); handleGetQuote(); }}
            disabled={isLoadingSwap || !connected || !poolData || baseDecimals === null || quoteDecimals === null || ensureGameServerMutation.isPending}
          >
            {isLoadingSwap && !quote && !swapError ? "Getting Quote..." : "Get Quote"}
          </button>

          {quote && baseDecimals !== null && quoteDecimals !== null && (
            <div style={{ fontSize: '0.75rem', marginBottom: '8px', padding: '6px', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: '4px' }}>
              <p><strong>Est. Amount Out:</strong> {formatBnWithDecimals(quote.amountOut, swapDirection === 'quote_to_base' ? baseDecimals : quoteDecimals)}</p>
              {minimumAmountOutToDisplay && <p><strong>Min. Amount Out:</strong> {formatBnWithDecimals(minimumAmountOutToDisplay, swapDirection === 'quote_to_base' ? baseDecimals : quoteDecimals)}</p>}
            </div>
          )}

          <button 
            style={{ 
                ...buttonStyleBase, 
                backgroundColor: isLoadingSwap && quote ? '#fbbf24' : (quote ? '#22c55e' : '#6b7280'), 
                width: '100%'
            }}
            onClick={(e) => { e.stopPropagation(); handleSwap(); }}
            disabled={isLoadingSwap || !quote || !minimumAmountOutToDisplay || !connected || ensureGameServerMutation.isPending}
          >
            {isLoadingSwap && quote ? "Swapping..." : (connected ? "Execute Swap" : "Connect Wallet")}
          </button>

          {swapError && (
            <div style={{ color: '#f87171', fontSize: '0.75rem', marginTop: '8px', textAlign:'center', wordBreak: 'break-word' }}>
              Error: {swapError}
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