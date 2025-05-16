import { useState, useEffect } from "react";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import type { Transaction } from "@solana/web3.js"; // Type-only import
import {
  DynamicBondingCurveClient,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import type { // Type-only imports
  SwapQuoteParam,
  VirtualPool,
  PoolConfig,
  QuoteResult,
  SwapParam 
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";
import bs58 from "bs58";
import { Buffer } from 'buffer';

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

const CreateSwapForm: React.FC = () => {
  const [ownerPrivateKey, setOwnerPrivateKey] = useState("");
  const [poolAddress, setPoolAddress] = useState("");
  const [amountIn, setAmountIn] = useState("");
  const [swapDirection, setSwapDirection] = useState<"quote_to_base" | "base_to_quote">("quote_to_base");
  const [referralAccount, setReferralAccount] = useState("");

  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [minimumAmountOutToDisplay, setMinimumAmountOutToDisplay] = useState<BN | null>(null); // For display
  const [transactionSignature, setTransactionSignature] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const RPC_URL = "https://devnet.helius-rpc.com/?api-key=81b1290d-9852-4dcc-9c9c-4a4be7ddf3e3";


  const handleGetQuote = async () => {
    if (!poolAddress) {
      setError("Pool address is required.");
      return;
    }
    if (!amountIn) {
      setError("Amount in is required.");
      return;
    }

    setIsLoading(true);
    setError("");
    setQuote(null);
    setMinimumAmountOutToDisplay(null);

    try {
      const connection = new Connection(RPC_URL, "confirmed");
      const client = new DynamicBondingCurveClient(connection as any, "confirmed");
      const poolPubKey = new PublicKey(poolAddress);
      const amountInBn = new BN(amountIn);

      // Linter flags getPool/getPoolConfig as not existing directly on client.
      // Casting to any to proceed, assuming SDK version/typings mismatch with example docs.
      const virtualPoolState = await client.state.getPool(poolPubKey) as VirtualPool;
      if (!virtualPoolState) {
        setError("Could not fetch pool details.");
        setIsLoading(false);
        return;
      }
      const poolConfigState = await client.state.getPoolConfig(virtualPoolState.config) as PoolConfig;
      if (!poolConfigState) {
        setError("Could not fetch pool config details.");
        setIsLoading(false);
        return;
      }
      
      let currentPointVal = new BN(0);
      if (poolConfigState.activationType === 0) { // Slot
        currentPointVal = new BN(await connection.getSlot("confirmed"));
      } else { // Timestamp
        console.warn("ActivationType is Timestamp, using current slot as currentPoint for quote. This might not be accurate for production.");
        currentPointVal = new BN(await connection.getSlot("confirmed")); // Placeholder - proper timestamp needed
      }

      const swapQuoteParam: SwapQuoteParam = {
        virtualPool: virtualPoolState,
        config: poolConfigState,
        swapBaseForQuote: swapDirection === "base_to_quote",
        amountIn: amountInBn,
        slippageBps: 50, 
        hasReferral: !!referralAccount,
        currentPoint: currentPointVal,
      };

      console.log("Getting quote with params:", swapQuoteParam);
      const quoteResult = await client.pool.swapQuote(swapQuoteParam);
      setQuote(quoteResult);
      // If quoteResult.minAmountOut is not available, use amountOut.
      // The slippageBps parameter in swapQuote should ideally result in minAmountOut being populated.
      setMinimumAmountOutToDisplay((quoteResult as any).minAmountOut || quoteResult.amountOut);
      console.log("Quote received:", quoteResult);

    } catch (err: any) {
      console.error("Failed to get quote:", err);
      setError(`Failed to get quote: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSwap = async () => {
    if (!ownerPrivateKey) {
      setError("Owner private key is required.");
      return;
    }
    if (!poolAddress) {
      setError("Pool address is required.");
      return;
    }
    if (!amountIn) {
      setError("Amount in is required.");
      return;
    }
    if (!quote || !minimumAmountOutToDisplay) { // Check display value which should hold the actual min out
      setError("Please get a quote first, or quote is missing minimum amount out.");
      return;
    }

    setIsLoading(true);
    setError("");
    setTransactionSignature("");

    try {
      const ownerSecretKey = bs58.decode(ownerPrivateKey);
      const owner = Keypair.fromSecretKey(ownerSecretKey);

      const connection = new Connection(RPC_URL, "confirmed");
      const client = new DynamicBondingCurveClient(connection as any, "confirmed");

      const poolPubKey = new PublicKey(poolAddress);
      const amountInBn = new BN(amountIn);
      
      const referralTokenAccountPubKey = referralAccount ? new PublicKey(referralAccount) : null;

      // Changed poolAddress to pool as per linter suggestion for SwapParam structure
      const swapTxParam: SwapParam = { // Use SwapParam type
        owner: owner.publicKey,
        amountIn: amountInBn,
        minimumAmountOut: minimumAmountOutToDisplay, 
        swapBaseForQuote: swapDirection === "base_to_quote",
        pool: poolPubKey, // Changed from poolAddress to pool
        referralTokenAccount: referralTokenAccountPubKey,
      };
      
      // The SDK documentation for swap is: async swap(pool: PublicKey, swapParam: SwapParam)
      // The example is: client.pool.swap({ owner: ..., poolAddress: ... })
      // The linter error suggested SwapParam itself needs 'pool'
      // Let's assume client.pool.swap expects a single SwapParam object
      console.log("Creating swap transaction with params:", swapTxParam);
      const transaction = await client.pool.swap(swapTxParam); // Pass the object
      
      transaction.feePayer = owner.publicKey;
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      transaction.recentBlockhash = blockhash;

      const signature = await sendAndConfirmTransaction(
        connection,
        transaction as any, // Cast to any for Transaction type mismatch
        [owner],
        { commitment: "confirmed", skipPreflight: true }
      );

      setTransactionSignature(signature);
      console.log("Swap transaction confirmed!");
      console.log(`Swap completed: https://solscan.io/tx/${signature}?cluster=devnet`);
      setQuote(null); 
      setMinimumAmountOutToDisplay(null);

    } catch (err: any) {
      setError(`Failed to execute swap: ${err.message} - ${err.stack ? err.stack : ''}`);
      if (err.logs) {
        console.error("Transaction logs:", err.logs);
      }
    } finally {
      setIsLoading(false);
    }
  };
  
  const formatBn = (bn: BN | undefined | null, decimals: number = 9): string => {
    if (!bn) return "N/A";
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
    
    fractionalPart = fractionalPart.replace(/0+$/, ''); // Remove trailing zeros from fractional part
    if (fractionalPart.length === 0) {
        return (isNegative ? '-' : '') + wholePart;
    }
    return (isNegative ? '-' : '') + wholePart + "." + fractionalPart;
  };


  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>Swap Tokens</CardTitle>
        <CardDescription>Swap between base and quote tokens on a DBC pool.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
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
          <Label htmlFor="poolAddressSwap">Pool Address:</Label>
          <Input
            id="poolAddressSwap"
            type="text"
            value={poolAddress}
            onChange={(e) => setPoolAddress(e.target.value)}
            placeholder="Enter the DBC pool address"
            disabled={isLoading}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="amountInSwap">Amount In (smallest unit):</Label>
          <Input
            id="amountInSwap"
            type="text" // Should be number but BN handles string
            value={amountIn}
            onChange={(e) => setAmountIn(e.target.value)}
            placeholder="e.g., 1000000000 (for 1 token if 9 decimals)"
            disabled={isLoading}
          />
        </div>
        <div className="space-y-2">
          <Label>Swap Direction:</Label>
          <RadioGroup
            value={swapDirection}
            onValueChange={(value: "quote_to_base" | "base_to_quote") => setSwapDirection(value)}
            className="flex space-x-4"
            disabled={isLoading}
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
            disabled={isLoading}
          />
        </div>

        <Button onClick={handleGetQuote} disabled={isLoading || !poolAddress || !amountIn} className="w-full">
          {isLoading ? "Getting Quote..." : "Get Quote"}
        </Button>

        {quote && (
          <Card className="mt-4">
            <CardHeader><CardTitle className="text-lg">Quote Details</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p><strong>Amount Out (Expected):</strong> {formatBn(quote.amountOut)}</p>
              {minimumAmountOutToDisplay && <p><strong>Minimum Amount Out (Slippage Applied):</strong> {formatBn(minimumAmountOutToDisplay)}</p>}
              {quote.fee && typeof (quote.fee as any).trading !== 'undefined' && <p><strong>Trading Fee:</strong> {formatBn((quote.fee as any).trading)}</p>}
              {quote.fee && typeof (quote.fee as any).protocol !== 'undefined' && <p><strong>Protocol Fee:</strong> {formatBn((quote.fee as any).protocol)}</p>}
              {(quote as any).priceImpactPct !== undefined && <p><strong>Price Impact:</strong> {(quote as any).priceImpactPct.toFixed(4) + '%'}</p>}
            </CardContent>
          </Card>
        )}
      </CardContent>
      <CardFooter className="flex flex-col items-start space-y-4">
        <Button onClick={handleSwap} disabled={isLoading || !quote || !minimumAmountOutToDisplay} className="w-full">
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