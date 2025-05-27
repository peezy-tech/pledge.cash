import { useState, useEffect } from "react";
import {
  // Connection, // No longer directly used for sending tx
  // Keypair, // No longer generating keypairs client-side for payer or base mint
  Transaction,
  // sendAndConfirmTransaction, // Replaced by API calls
} from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react"; // Added
import { api } from "@/utils/api"; // Added for API calls
// import {
//   DynamicBondingCurveClient, // SDK usage moved to backend
//   TokenType,
// } from "@meteora-ag/dynamic-bonding-curve-sdk";
// import { NATIVE_MINT } from "@solana/spl-token"; // Moved to backend
// import bs58 from "bs58"; // No longer decoding private keys
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

if (typeof window !== 'undefined') {
  window.Buffer = window.Buffer || Buffer;
}

interface CreatePoolFormProps {
  initialConfigAddress?: string;
}

const CreatePoolForm: React.FC<CreatePoolFormProps> = ({ initialConfigAddress }) => {
  // const [payerPrivateKey, setPayerPrivateKey] = useState(""); // Removed
  const { publicKey, signTransaction, connected } = useWallet(); // Added

  const [configAddress, setConfigAddress] = useState(initialConfigAddress || "");
  const [poolName, setPoolName] = useState("Test Pool");
  const [poolSymbol, setPoolSymbol] = useState("TESTP");
  const [poolUri, setPoolUri] = useState("https://example.com/pool-metadata.json");
  const [transactionSignature, setTransactionSignature] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [baseMintAddress, setBaseMintAddress] = useState("");
  const [poolAddress, setPoolAddress] = useState("");

  useEffect(() => {
    if (initialConfigAddress) {
      setConfigAddress(initialConfigAddress);
    }
  }, [initialConfigAddress]);

  const handleCreatePool = async () => {
    if (!connected || !publicKey || !signTransaction) {
      setError("Wallet not connected or signTransaction not available.");
      return;
    }
    // if (!payerPrivateKey) { // Removed private key check
    //   setError("Payer private key is required.");
    //   return;
    // }
    if (!configAddress) {
      setError("Config address is required.");
      return;
    }

    setIsLoading(true);
    setError("");
    setTransactionSignature("");
    setBaseMintAddress("");
    setPoolAddress("");

    try {
      // Step 1: Call API to prepare the transaction
      console.log("Requesting pool transaction from API...");
      const prepareResponse = await api.pools["prepare-create"].post({
        configAddress,
        poolName,
        poolSymbol,
        poolUri,
      });

      if (prepareResponse.error || !prepareResponse.data || !prepareResponse.data.serializedTransaction) {
         const errorMessage = prepareResponse.error instanceof Error ? prepareResponse.error.message : JSON.stringify(prepareResponse.error);
         throw new Error(`Failed to prepare pool transaction: ${errorMessage}`);
      }

      const { serializedTransaction, baseMintAddress: generatedBaseMintAddress, poolAddress: generatedPoolAddress } = prepareResponse.data;
      setBaseMintAddress(generatedBaseMintAddress || "N/A");
      setPoolAddress(generatedPoolAddress || "N/A");
      console.log(`API generated base mint: ${generatedBaseMintAddress}`);
      console.log(`API derived pool address: ${generatedPoolAddress}`);

      // Step 2: Deserialize, sign with user's wallet, and re-serialize
      const transaction = Transaction.from(Buffer.from(serializedTransaction, 'base64'));
      
      console.log("Requesting user to sign transaction...");
      const signedTransaction = await signTransaction(transaction as any);
      const signedSerializedTx = Buffer.from(signedTransaction.serialize()).toString('base64');

      // Step 3: Send the signed transaction to the API to submit
      console.log("Submitting signed transaction to API...");
      const submitResponse = await api.pools["submit-signed"].post({
        signedSerializedTransaction: signedSerializedTx,
        baseMintAddress: generatedBaseMintAddress,
        configAddress: configAddress,
        poolName: poolName,
        poolSymbol: poolSymbol,
        poolUri: poolUri,
        poolAddress: generatedPoolAddress,
      });

      if (submitResponse.error || !submitResponse.data || !submitResponse.data.transactionSignature) {
        const errorMessage = submitResponse.error instanceof Error ? submitResponse.error.message : JSON.stringify(submitResponse.error);
        throw new Error(`Failed to submit signed pool transaction: ${errorMessage}`);
      }

      setTransactionSignature(submitResponse.data.transactionSignature);
      console.log("Transaction confirmed by API!");
      console.log(`Pool created: https://solscan.io/tx/${submitResponse.data.transactionSignature}?cluster=devnet`);

    } catch (err: any) {
      console.error("Failed to create pool:", err);
      setError(`Failed to create pool: ${err.message}${err.stack ? ` - Stack: ${err.stack}` : ''}`);
      // Log more details if possible from the error object, e.g., if it has a `response` field from an API error
      if (err.response && err.response.data) {
        console.error("API Error details:", err.response.data);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>Create DBC Pool (Server Signed)</CardTitle>
        <CardDescription>
          Configure and create a new Dynamic Bonding Curve pool using server-side transaction preparation.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Payer Private Key Input Removed */}
        {/* <div className="space-y-2">
          <Label htmlFor="payerPrivateKeyPool">Payer Private Key (Base58):</Label>
          <Input
            id="payerPrivateKeyPool"
            type="password"
            value={payerPrivateKey}
            onChange={(e) => setPayerPrivateKey(e.target.value)}
            placeholder="Enter your wallet private key"
            disabled={isLoading}
          />
        </div> */}
        <div className="space-y-2">
          <Label htmlFor="configAddress">Config Address:</Label>
          <Input
            id="configAddress"
            type="text"
            value={configAddress}
            onChange={(e) => setConfigAddress(e.target.value)}
            placeholder="Enter config address (e.g., from step 1)"
            disabled={isLoading}
          />
        </div>
         <div className="space-y-2">
          <Label htmlFor="poolName">Pool Name:</Label>
          <Input
            id="poolName"
            type="text"
            value={poolName}
            onChange={(e) => setPoolName(e.target.value)}
            placeholder="My Awesome Pool"
            disabled={isLoading}
          />
        </div>
         <div className="space-y-2">
          <Label htmlFor="poolSymbol">Pool Symbol:</Label>
          <Input
            id="poolSymbol"
            type="text"
            value={poolSymbol}
            onChange={(e) => setPoolSymbol(e.target.value)}
            placeholder="MAP"
            disabled={isLoading}
          />
        </div>
         <div className="space-y-2">
          <Label htmlFor="poolUri">Pool URI (Metadata):</Label>
          <Input
            id="poolUri"
            type="text"
            value={poolUri}
            onChange={(e) => setPoolUri(e.target.value)}
            placeholder="https://your-metadata-url.json"
            disabled={isLoading}
          />
        </div>
      </CardContent>
      <CardFooter className="flex flex-col items-start space-y-4">
        <Button 
          onClick={handleCreatePool} 
          disabled={isLoading || !connected} 
          className="w-full"
        >
          {isLoading ? "Creating Pool..." : (connected ? "Create Pool (Sign with Wallet)" : "Connect Wallet to Create Pool")}
        </Button>
        {error && (
          <Alert variant="destructive" className="w-full">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {baseMintAddress && (
            <Alert variant="default" className="w-full">
                <AlertTitle>Base Mint Generated by Server</AlertTitle>
                <AlertDescription>
                    <strong>{baseMintAddress}</strong>
                </AlertDescription>
            </Alert>
        )}
        {poolAddress && (
            <Alert variant="default" className="w-full">
                <AlertTitle>Pool Address Derived by Server</AlertTitle>
                <AlertDescription>
                    <strong>{poolAddress}</strong>
                </AlertDescription>
            </Alert>
        )}
        {transactionSignature && (
          <Alert variant="default" className="w-full">
            <AlertTitle>Pool Created Successfully!</AlertTitle>
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

export default CreatePoolForm; 