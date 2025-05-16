import { useState, useEffect } from "react";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  DynamicBondingCurveClient,
  TokenType,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { NATIVE_MINT } from "@solana/spl-token";
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

if (typeof window !== 'undefined') {
  window.Buffer = window.Buffer || Buffer;
}

interface CreatePoolFormProps {
  initialConfigAddress?: string;
}

const CreatePoolForm: React.FC<CreatePoolFormProps> = ({ initialConfigAddress }) => {
  const [payerPrivateKey, setPayerPrivateKey] = useState("");
  const [configAddress, setConfigAddress] = useState(initialConfigAddress || "");
  const [poolName, setPoolName] = useState("Test Pool");
  const [poolSymbol, setPoolSymbol] = useState("TESTP");
  const [poolUri, setPoolUri] = useState("https://example.com/pool-metadata.json");
  const [transactionSignature, setTransactionSignature] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [baseMintAddress, setBaseMintAddress] = useState("");

  useEffect(() => {
    if (initialConfigAddress) {
      setConfigAddress(initialConfigAddress);
    }
  }, [initialConfigAddress]);

  const handleCreatePool = async () => {
    if (!payerPrivateKey) {
      setError("Payer private key is required.");
      return;
    }
    if (!configAddress) {
      setError("Config address is required.");
      return;
    }

    setIsLoading(true);
    setError("");
    setTransactionSignature("");
    setBaseMintAddress("");

    try {
      const payerSecretKey = bs58.decode(payerPrivateKey);
      const payer = Keypair.fromSecretKey(payerSecretKey);
      const poolCreator = payer; // Using payer as poolCreator as in the script

      const connection = new Connection(
        "https://devnet.helius-rpc.com/?api-key=81b1290d-9852-4dcc-9c9c-4a4be7ddf3e3",
        "confirmed"
      );

      const configPubKey = new PublicKey(configAddress);
      const baseMintKeypair = Keypair.generate();
      setBaseMintAddress(baseMintKeypair.publicKey.toString());
      console.log(`Generated base mint for pool: ${baseMintKeypair.publicKey.toString()}`);

      const createPoolParam = {
        quoteMint: NATIVE_MINT,
        baseMint: baseMintKeypair.publicKey,
        config: configPubKey,
        baseTokenType: TokenType.SPL, // Assuming SPL, adjust if Token2022 is needed for base
        quoteTokenType: TokenType.SPL, // NATIVE_MINT is SPL
        name: poolName,
        symbol: poolSymbol,
        uri: poolUri,
        payer: payer.publicKey,
        poolCreator: poolCreator.publicKey,
      };

      const client = new DynamicBondingCurveClient(connection as any, "confirmed");

      console.log("Creating pool transaction...");
      const poolTransaction = await client.pool.createPool(createPoolParam);
      poolTransaction.feePayer = payer.publicKey; // Ensure fee payer is set
      // The SDK should handle recentBlockhash, but if not, uncomment below
      // const { blockhash } = await connection.getLatestBlockhash("confirmed");
      // poolTransaction.recentBlockhash = blockhash;

      const signature = await sendAndConfirmTransaction(
        connection,
        poolTransaction as any,
        [payer, baseMintKeypair, poolCreator], // poolCreator might not need to sign if it's the same as payer & payer is signer
        {
          commitment: "confirmed",
          skipPreflight: true,
        }
      );

      setTransactionSignature(signature);
      console.log("Transaction confirmed!");
      console.log(`Pool created: https://solscan.io/tx/${signature}`);
    } catch (err: any) {
      console.error("Failed to create pool:", err);
      setError(`Failed to create pool: ${err.message} - ${err.stack}`);
      // Log more details if possible
      if (err.logs) {
        console.error("Transaction logs:", err.logs);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>Create DBC Pool</CardTitle>
        <CardDescription>Configure and create a new Dynamic Bonding Curve pool.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="payerPrivateKeyPool">Payer Private Key (Base58):</Label>
          <Input
            id="payerPrivateKeyPool"
            type="password"
            value={payerPrivateKey}
            onChange={(e) => setPayerPrivateKey(e.target.value)}
            placeholder="Enter your wallet private key"
            disabled={isLoading}
          />
        </div>
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
        <Button onClick={handleCreatePool} disabled={isLoading} className="w-full">
          {isLoading ? "Creating Pool..." : "Create Pool"}
        </Button>
        {error && (
          <Alert variant="destructive" className="w-full">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {baseMintAddress && (
            <Alert variant="default" className="w-full">
                <AlertTitle>Base Mint Generated</AlertTitle>
                <AlertDescription>
                    <strong>{baseMintAddress}</strong>
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