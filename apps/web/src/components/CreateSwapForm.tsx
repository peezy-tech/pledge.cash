import { useState, useEffect } from "react";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  DynamicBondingCurveClient,
  TokenType, // Import TokenType
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import type { // Type-only imports
  SwapQuoteParam,
  VirtualPool,
  PoolConfig,
  QuoteResult,
  SwapParam,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";
import bs58 from "bs58";
import { Buffer } from 'buffer';
import { NATIVE_MINT } from "@solana/spl-token"; // For SOL/quote mint details

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"; // Assuming this path is correct
import { Separator } from "@/components/ui/separator";

if (typeof window !== 'undefined') {
  window.Buffer = window.Buffer || Buffer;
}

// Interface for the actual structure returned by getPoolFeeMetrics
interface FetchedFeeMetrics {
    current: {
        partnerBaseFee: BN;
        partnerQuoteFee: BN;
        creatorBaseFee: BN;
        creatorQuoteFee: BN;
    };
    total: {
        totalTradingBaseFee: BN;
        totalTradingQuoteFee: BN;
        // Assuming totalProtocol fees might also be here or part of the main PoolMetrics type if different
    };
}

interface PoolDetails {
  poolData: VirtualPool | null;
  poolConfig: PoolConfig | null;
  feeMetrics: FetchedFeeMetrics | null; // Use the interface for the fetched structure
  baseDecimals: number | null;
  quoteDecimals: number | null;
}

const CreateSwapForm: React.FC = () => {
  console.log("CreateSwapForm: Component rendered or re-rendered");

  const [ownerPrivateKey, setOwnerPrivateKey] = useState("");
  const [poolAddress, setPoolAddress] = useState("");
  const [amountIn, setAmountIn] = useState("");
  const [swapDirection, setSwapDirection] = useState<"quote_to_base" | "base_to_quote">("quote_to_base");
  const [referralAccount, setReferralAccount] = useState("");

  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [minimumAmountOutToDisplay, setMinimumAmountOutToDisplay] = useState<BN | null>(null); // For display
  const [transactionSignature, setTransactionSignature] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingPoolInfo, setIsFetchingPoolInfo] = useState(false);
  const [error, setError] = useState("");

  const [poolDetails, setPoolDetails] = useState<PoolDetails>({ 
    poolData: null, 
    poolConfig: null, 
    feeMetrics: null,
    baseDecimals: null,
    quoteDecimals: null,
  });

  const RPC_URL = "https://devnet.helius-rpc.com/?api-key=81b1290d-9852-4dcc-9c9c-4a4be7ddf3e3";

  useEffect(() => {
    console.log("CreateSwapForm: useEffect for poolAddress triggered. Current poolAddress:", poolAddress);
    const fetchPoolInformation = async () => {
      if (!poolAddress) {
        console.log("CreateSwapForm: No poolAddress, clearing poolDetails.");
        setPoolDetails({ poolData: null, poolConfig: null, feeMetrics: null, baseDecimals: null, quoteDecimals: null });
        return;
      }
      let parsedPoolPubKey;
      try {
        parsedPoolPubKey = new PublicKey(poolAddress);
        console.log("CreateSwapForm: Valid pool address format, attempting to fetch info for:", poolAddress);
      } catch (e) {
        console.error("CreateSwapForm: Invalid pool address format:", poolAddress, e);
        setError("Invalid pool address format.");
        setPoolDetails({ poolData: null, poolConfig: null, feeMetrics: null, baseDecimals: null, quoteDecimals: null });
        return;
      }

      setIsFetchingPoolInfo(true);
      setError("");
      setQuote(null); 
      setMinimumAmountOutToDisplay(null);
      console.log("CreateSwapForm: Starting to fetch pool information...");

      try {
        const connection = new Connection(RPC_URL, "confirmed");
        const client = new DynamicBondingCurveClient(connection as any, "confirmed");
        
        console.log(`CreateSwapForm: Calling client.state.getPool with pubkey: ${parsedPoolPubKey.toBase58()}`);
        const fetchedPoolData = await client.state.getPool(parsedPoolPubKey);
        console.log("CreateSwapForm: Fetched Pool Data (raw object):", fetchedPoolData);
        try {
            console.log("CreateSwapForm: Stringified Fetched Pool Data:", JSON.stringify(fetchedPoolData, null, 2));
        } catch (e) {
            console.warn("CreateSwapForm: Could not stringify fetchedPoolData:", e);
        }

        if (!fetchedPoolData) {
          console.warn("CreateSwapForm: client.state.getPool returned null or undefined.");
          setError("Pool not found or could not be fetched.");
          setPoolDetails({ poolData: null, poolConfig: null, feeMetrics: null, baseDecimals: null, quoteDecimals: null });
          setIsFetchingPoolInfo(false);
          return;
        }

        // Get config first, as it should be the source of truth for mints if VirtualPool is unreliable
        console.log(`CreateSwapForm: Calling client.state.getPoolConfig with configKey: ${fetchedPoolData.config.toBase58()}`);
        const fetchedConfigData = await client.state.getPoolConfig(fetchedPoolData.config);
        console.log("CreateSwapForm: Fetched Config Data:", fetchedConfigData);
        if (!fetchedConfigData) {
          console.warn("CreateSwapForm: client.state.getPoolConfig returned null or undefined.");
          setError("Pool configuration not found or could not be fetched. This is critical for determining mints.");
          setPoolDetails({ ...poolDetails, poolData: fetchedPoolData, poolConfig: null });
          setIsFetchingPoolInfo(false);
          return;
        }
        
        // Extract mints: baseMint from PoolData (usually reliable), quoteMint from PoolConfig (source of truth)
        const baseMint = (fetchedPoolData as any).baseMint as PublicKey | undefined;
        const quoteMint = (fetchedConfigData as any).quoteMint as PublicKey | undefined; // Get quoteMint from config
        
        console.log("CreateSwapForm: Extracted baseMint (from poolData):", baseMint?.toBase58(), "quoteMint (from configData):", quoteMint?.toBase58());

        if (!baseMint || !quoteMint) {
            console.error("CreateSwapForm: Critical error: baseMint or quoteMint is missing after checking poolData and configData.", { baseMint, quoteMint, fetchedPoolData, fetchedConfigData });
            setError("Critical: baseMint or quoteMint missing. Check console.");
            // Store what we have for debugging, but mints are essential
            setPoolDetails({ poolData: fetchedPoolData, poolConfig: fetchedConfigData, feeMetrics: null, baseDecimals: null, quoteDecimals: null }); 
            setIsFetchingPoolInfo(false);
            return;
        }
        
        console.log(`CreateSwapForm: Calling client.state.getPoolFeeMetrics for pool: ${parsedPoolPubKey.toBase58()}`);
        const fetchedFeeMetrics = await client.state.getPoolFeeMetrics(parsedPoolPubKey) as FetchedFeeMetrics;
        console.log("CreateSwapForm: Fetched Fee Metrics:", fetchedFeeMetrics);
        
        let baseMintDecimals = 9; 
        console.log(`CreateSwapForm: Calling client.state.getTokenDecimals for baseMint: ${baseMint.toBase58()}, type: ${fetchedConfigData.tokenType}`);
        try {
            baseMintDecimals = await client.state.getTokenDecimals(baseMint, fetchedConfigData.tokenType);
            console.log("CreateSwapForm: Fetched baseMintDecimals (API):", baseMintDecimals);
        } catch (decError) {
            console.warn(`CreateSwapForm: Could not fetch base mint (${baseMint.toBase58()}) decimals via API:`, decError);
            baseMintDecimals = mapTokenDecimalEnumToNumber(fetchedConfigData.tokenDecimal);
            console.log("CreateSwapForm: Fallback baseMintDecimals (Enum map):", baseMintDecimals);
        }

        let quoteMintDecimals = 9; 
        console.log(`CreateSwapForm: Calling client.state.getTokenDecimals for quoteMint: ${quoteMint.toBase58()}, type: ${TokenType.SPL}`); // Assuming quote is SPL or Native (handled by NATIVE_MINT check later)
        try {
            // For NATIVE_MINT, getTokenDecimals might fail or return specific value, SOL is usually 9 decimals.
            if (quoteMint.equals(NATIVE_MINT)) {
                console.log("CreateSwapForm: quoteMint is NATIVE_MINT, setting decimals to 9.");
                quoteMintDecimals = 9;
            } else {
                quoteMintDecimals = await client.state.getTokenDecimals(quoteMint, TokenType.SPL); // Assuming non-native quote is SPL
                console.log("CreateSwapForm: Fetched quoteMintDecimals (API) for SPL token:", quoteMintDecimals);
            }
        } catch (decError) {
            console.warn(`CreateSwapForm: Could not fetch quote mint (${quoteMint.toBase58()}) decimals via API:`, decError);
            if (quoteMint.equals(NATIVE_MINT)) {
                 quoteMintDecimals = 9; 
                 console.log("CreateSwapForm: Fallback for NATIVE_MINT quote, setting decimals to 9.");
            } else {
                console.log("CreateSwapForm: Using default quoteMintDecimals (9) after API error for non-native token.");
            }
        }

        console.log("CreateSwapForm: Successfully fetched all pool details. Updating state.");
        setPoolDetails({
          poolData: fetchedPoolData,
          poolConfig: fetchedConfigData,
          feeMetrics: fetchedFeeMetrics, 
          baseDecimals: baseMintDecimals,
          quoteDecimals: quoteMintDecimals
        });

      } catch (err: any) {
        console.error("CreateSwapForm: Error during fetchPoolInformation process:", err);
        setError(`Failed to fetch pool info: ${err.message}`);
        setPoolDetails({ poolData: null, poolConfig: null, feeMetrics: null, baseDecimals: null, quoteDecimals: null });
      } finally {
        console.log("CreateSwapForm: fetchPoolInformation finished.");
        setIsFetchingPoolInfo(false);
      }
    };

    fetchPoolInformation();
  }, [poolAddress]);

  // Helper to map TokenDecimal enum to number if direct decimal fetch isn't used for base
  const mapTokenDecimalEnumToNumber = (tokenDecimalEnum: number): number => {
    console.log("CreateSwapForm: mapTokenDecimalEnumToNumber called with:", tokenDecimalEnum);
    if (tokenDecimalEnum === 0) return 9; // Assuming 0 maps to 9 for TokenDecimal.NINE
    if (tokenDecimalEnum === 1) return 6; // Assuming 1 maps to 6 for TokenDecimal.SIX
    if (tokenDecimalEnum === 2) return 3; // Assuming 2 maps to 3 for TokenDecimal.THREE
    if (tokenDecimalEnum === 3) return 0; // Assuming 3 maps to 0 for TokenDecimal.ZERO
    console.warn("CreateSwapForm: Unknown TokenDecimal enum value:", tokenDecimalEnum, "defaulting to 9 decimals.")
    return 9; // Default
  };


  const handleGetQuote = async () => {
    console.log("CreateSwapForm: handleGetQuote triggered.");
    if (!poolAddress || !poolDetails.poolData || !poolDetails.poolConfig) {
      console.warn("CreateSwapForm: handleGetQuote prerequisite missing: poolAddress, poolData, or poolConfig.", { poolAddress, poolDetails });
      setError("Pool address is required and pool details must be loaded.");
      return;
    }
    if (!amountIn) {
      console.warn("CreateSwapForm: handleGetQuote prerequisite missing: amountIn.");
      setError("Amount in is required.");
      return;
    }
    console.log("CreateSwapForm: handleGetQuote prerequisites met. AmountIn:", amountIn, "SwapDirection:", swapDirection);

    setIsLoading(true);
    setError("");
    setQuote(null);
    setMinimumAmountOutToDisplay(null);

    try {
      const connection = new Connection(RPC_URL, "confirmed");
      const client = new DynamicBondingCurveClient(connection as any, "confirmed");
      const amountInBn = new BN(amountIn);

      const virtualPoolState = poolDetails.poolData;
      const poolConfigState = poolDetails.poolConfig;
      
      let currentPointVal = new BN(0);
      if (poolConfigState.activationType === 0) { 
        currentPointVal = new BN(await connection.getSlot("confirmed"));
      } else { 
        console.warn("CreateSwapForm: ActivationType is Timestamp, using current slot as currentPoint for quote. This might not be accurate for production.");
        currentPointVal = new BN(await connection.getSlot("confirmed"));
      }
      console.log("CreateSwapForm: currentPoint for quote:", currentPointVal.toString());

      const swapQuoteParam: SwapQuoteParam = {
        virtualPool: virtualPoolState, 
        config: poolConfigState,       
        swapBaseForQuote: swapDirection === "base_to_quote",
        amountIn: amountInBn,
        slippageBps: 50, 
        hasReferral: !!referralAccount,
        currentPoint: currentPointVal,
      };

      console.log("CreateSwapForm: Calling client.pool.swapQuote with params:", swapQuoteParam);
      const quoteResult = await client.pool.swapQuote(swapQuoteParam);
      console.log("CreateSwapForm: Quote received from client.pool.swapQuote:", quoteResult);
      setQuote(quoteResult);
      setMinimumAmountOutToDisplay((quoteResult as any).minAmountOut || quoteResult.amountOut);
      console.log("CreateSwapForm: Set quote state. Expected amountOut:", quoteResult.amountOut?.toString(), "Min amountOut to display:", ((quoteResult as any).minAmountOut || quoteResult.amountOut)?.toString());

    } catch (err: any) {
      console.error("CreateSwapForm: Error in handleGetQuote:", err);
      setError(`Failed to get quote: ${err.message}`);
    } finally {
      console.log("CreateSwapForm: handleGetQuote finished.");
      setIsLoading(false);
    }
  };

  const handleSwap = async () => {
    console.log("CreateSwapForm: handleSwap triggered.");
    if (!ownerPrivateKey) {
      console.warn("CreateSwapForm: handleSwap prerequisite missing: ownerPrivateKey.");
      setError("Owner private key is required.");
      return;
    }
    if (!poolAddress || !poolDetails.poolData) { 
      console.warn("CreateSwapForm: handleSwap prerequisite missing: poolAddress or poolData.", { poolAddress, poolDetails });
      setError("Pool address is required and pool details must be loaded.");
      return;
    }
    if (!amountIn) {
      console.warn("CreateSwapForm: handleSwap prerequisite missing: amountIn.");
      setError("Amount in is required.");
      return;
    }
    if (!quote || !minimumAmountOutToDisplay) {
      console.warn("CreateSwapForm: handleSwap prerequisite missing: quote or minimumAmountOutToDisplay.", { quote, minimumAmountOutToDisplay });
      setError("Please get a quote first, or quote is missing minimum amount out.");
      return;
    }
    console.log("CreateSwapForm: handleSwap prerequisites met. AmountIn:", amountIn, "MinAmountOut:", minimumAmountOutToDisplay.toString());

    setIsLoading(true);
    setError("");
    setTransactionSignature("");

    try {
      const ownerSecretKey = bs58.decode(ownerPrivateKey);
      const owner = Keypair.fromSecretKey(ownerSecretKey);
      console.log("CreateSwapForm: Owner public key for swap:", owner.publicKey.toBase58());

      const connection = new Connection(RPC_URL, "confirmed");
      const client = new DynamicBondingCurveClient(connection as any, "confirmed");

      const poolPubKey = new PublicKey(poolAddress);
      const amountInBn = new BN(amountIn);
      
      const referralTokenAccountPubKey = referralAccount ? new PublicKey(referralAccount) : null;
      console.log("CreateSwapForm: Referral account for swap:", referralTokenAccountPubKey?.toBase58());

      const swapTxParam: SwapParam = {
        owner: owner.publicKey,
        amountIn: amountInBn,
        minimumAmountOut: minimumAmountOutToDisplay, 
        swapBaseForQuote: swapDirection === "base_to_quote",
        pool: poolPubKey, 
        referralTokenAccount: referralTokenAccountPubKey,
      };
      
      console.log("CreateSwapForm: Calling client.pool.swap with params:", swapTxParam);
      const transaction = await client.pool.swap(swapTxParam);
      console.log("CreateSwapForm: Transaction object received from client.pool.swap:", transaction);
      
      transaction.feePayer = owner.publicKey;
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      transaction.recentBlockhash = blockhash;
      console.log("CreateSwapForm: Transaction feePayer and recentBlockhash set.");

      const signature = await sendAndConfirmTransaction(
        connection,
        transaction as any, 
        [owner],
        { commitment: "confirmed", skipPreflight: true }
      );
      console.log("CreateSwapForm: Swap transaction sent and confirmed. Signature:", signature);

      setTransactionSignature(signature);
      console.log(`Swap completed: https://solscan.io/tx/${signature}?cluster=devnet`);
      setQuote(null); 
      setMinimumAmountOutToDisplay(null);

    } catch (err: any) {
      console.error("CreateSwapForm: Error in handleSwap:", err);
      setError(`Failed to execute swap: ${err.message} - ${err.stack ? err.stack : ''}`);
      if ((err as any).logs) {
        console.error("CreateSwapForm: Transaction logs from error:", (err as any).logs);
      }
    } finally {
      console.log("CreateSwapForm: handleSwap finished.");
      setIsLoading(false);
    }
  };
  
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

  console.log({poolDetails})
  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>Swap Tokens</CardTitle>
        <CardDescription>Swap tokens on a Dynamic Bonding Curve pool.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="poolAddressSwap">Pool Address:</Label>
          <Input
            id="poolAddressSwap"
            type="text"
            value={poolAddress}
            onChange={(e) => { console.log("CreateSwapForm: poolAddress changed to:", e.target.value); setPoolAddress(e.target.value); }}
            placeholder="Enter the DBC pool address"
            disabled={isLoading || isFetchingPoolInfo}
          />
        </div>

        {isFetchingPoolInfo && <p>Loading pool information...</p>}

        {poolDetails.poolData && poolDetails.poolConfig && poolDetails.poolData.baseMint && poolDetails.poolConfig.quoteMint && (
            <Card className="mt-4 bg-slate-50 dark:bg-slate-800">
                <CardHeader>
                    <CardTitle className="text-lg">Pool Information</CardTitle>
                    <CardDescription>
                        {/* Access mints via poolConfig as the source of truth if poolData is unreliable */}
                        Base: {poolDetails.poolData.baseMint.toBase58()} ({poolDetails.baseDecimals !== null ? `${poolDetails.baseDecimals} dec` : 'N/A dec'}) <br/>
                        Quote: {poolDetails.poolConfig.quoteMint.toBase58()} ({poolDetails.quoteDecimals !== null ? `${poolDetails.quoteDecimals} dec` : 'N/A dec'})
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                    <p><strong>Pool Type:</strong> {TokenType[poolDetails.poolConfig.tokenType]} (Base) / {((poolDetails.poolConfig as any).quoteMint as PublicKey).equals(NATIVE_MINT) ? "Native SOL" : "SPL"} (Quote)</p>
                    <p><strong>Config Address:</strong> {poolDetails.poolData.config.toBase58()}</p>
                    {/* Reserves are from poolData, cast if necessary */}
                    <p><strong>Current Base Reserve:</strong> {formatBnWithDecimals((poolDetails.poolData as any).baseReserve, poolDetails.baseDecimals)}</p>
                    <p><strong>Current Quote Reserve:</strong> {formatBnWithDecimals((poolDetails.poolData as any).quoteReserve, poolDetails.quoteDecimals)}</p>
                    <p><strong>Activation Type:</strong> {poolDetails.poolConfig.activationType === 0 ? "Slot" : "Timestamp"}</p>
                   
                    {poolDetails.feeMetrics && (
                        <>
                            <Separator className="my-2"/>
                            <p className="font-medium">Fee Metrics:</p>
                            <p>Creator Base Fee (Current): {formatBnWithDecimals(poolDetails.feeMetrics.current.creatorBaseFee, poolDetails.baseDecimals)}</p>
                            <p>Creator Quote Fee (Current): {formatBnWithDecimals(poolDetails.feeMetrics.current.creatorQuoteFee, poolDetails.quoteDecimals)}</p>
                            <p>Partner Base Fee (Current): {formatBnWithDecimals(poolDetails.feeMetrics.current.partnerBaseFee, poolDetails.baseDecimals)}</p>
                            <p>Partner Quote Fee (Current): {formatBnWithDecimals(poolDetails.feeMetrics.current.partnerQuoteFee, poolDetails.quoteDecimals)}</p>
                            <p>Total Trading Base Fee (Accumulated): {formatBnWithDecimals(poolDetails.feeMetrics.total.totalTradingBaseFee, poolDetails.baseDecimals)}</p>
                            <p>Total Trading Quote Fee (Accumulated): {formatBnWithDecimals(poolDetails.feeMetrics.total.totalTradingQuoteFee, poolDetails.quoteDecimals)}</p>
                        </>
                    )}
                     <p><strong>Migration Option:</strong> {poolDetails.poolConfig.migrationOption}</p> 
                </CardContent>
            </Card>
        )}

        <Separator/>

        <div className="space-y-2">
          <Label htmlFor="ownerPrivateKeySwap">Owner Private Key (Base58):</Label>
          <Input
            id="ownerPrivateKeySwap"
            type="password"
            value={ownerPrivateKey}
            onChange={(e) => setOwnerPrivateKey(e.target.value)}
            placeholder="Enter your wallet private key"
            disabled={isLoading}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="amountInSwap">Amount In (smallest unit):</Label>
          <Input
            id="amountInSwap"
            type="text" 
            value={amountIn}
            onChange={(e) => setAmountIn(e.target.value)}
            placeholder={`e.g., 1000000000 (for 1 ${swapDirection === "quote_to_base" ? "quote" : "base"} token)`}
            disabled={isLoading || !poolDetails.poolData}
          />
        </div>
        <div className="space-y-2">
          <Label>Swap Direction:</Label>
          <RadioGroup
            value={swapDirection}
            onValueChange={(value: "quote_to_base" | "base_to_quote") => {
                 console.log("CreateSwapForm: Swap direction changed to:", value);
                 setSwapDirection(value);
            }}
            className="flex space-x-4"
            disabled={isLoading || !poolDetails.poolData}
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="quote_to_base" id="r_qtb" />
              <Label htmlFor="r_qtb">Quote to Base (Buy Base)</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="base_to_quote" id="r_btq" />
              <Label htmlFor="r_btq">Base to Quote (Sell Base)</Label>
            </div>
          </RadioGroup>
        </div>
         <div className="space-y-2">
          <Label htmlFor="referralAccountSwap">Referral Token Account (Optional):</Label>
          <Input
            id="referralAccountSwap"
            type="text"
            value={referralAccount}
            onChange={(e) => setReferralAccount(e.target.value)}
            placeholder="Enter referral token account public key"
            disabled={isLoading || !poolDetails.poolData}
          />
        </div>

        <Button onClick={handleGetQuote} disabled={isLoading || isFetchingPoolInfo || !poolDetails.poolData || !amountIn} className="w-full">
          {isLoading ? "Getting Quote..." : "Get Quote"}
        </Button>

        {quote && poolDetails.baseDecimals !== null && poolDetails.quoteDecimals !== null && (
          <Card className="mt-4">
            <CardHeader><CardTitle className="text-lg">Quote Details</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p><strong>Amount Out (Expected):</strong> {formatBnWithDecimals(quote.amountOut, swapDirection === 'quote_to_base' ? poolDetails.baseDecimals : poolDetails.quoteDecimals)}</p>
              {minimumAmountOutToDisplay && <p><strong>Minimum Amount Out:</strong> {formatBnWithDecimals(minimumAmountOutToDisplay, swapDirection === 'quote_to_base' ? poolDetails.baseDecimals : poolDetails.quoteDecimals)}</p>}
              {quote.fee && typeof (quote.fee as any).trading !== 'undefined' && <p><strong>Trading Fee:</strong> {formatBnWithDecimals((quote.fee as any).trading, poolDetails.quoteDecimals)}</p>} 
              {quote.fee && typeof (quote.fee as any).protocol !== 'undefined' && <p><strong>Protocol Fee:</strong> {formatBnWithDecimals((quote.fee as any).protocol, poolDetails.quoteDecimals)}</p>} 
              {(quote as any).priceImpactPct !== undefined && <p><strong>Price Impact:</strong> {(quote as any).priceImpactPct.toFixed(4) + '%'}</p>}
            </CardContent>
          </Card>
        )}
      </CardContent>
      <CardFooter className="flex flex-col items-start space-y-4">
        <Button onClick={handleSwap} disabled={isLoading || isFetchingPoolInfo || !quote || !minimumAmountOutToDisplay} className="w-full">
          {isLoading ? "Swapping..." : "Execute Swap"}
        </Button>
        {error && (
          <Alert variant="destructive" className="w-full">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription style={{ whiteSpace: 'pre-wrap'}}>{error}</AlertDescription>
          </Alert>
        )}
        {transactionSignature && (
          <Alert variant="default" className="w-full">
            <AlertTitle>Swap Successful!</AlertTitle>
            <AlertDescription>
              Transaction:{" "}
              <a
                href={`https://solscan.io/tx/${transactionSignature}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary underline"
              >
                {transactionSignature}
              </a>
            </AlertDescription>
          </Alert>
        )}
      </CardFooter>
    </Card>
  );
};

export default CreateSwapForm; 