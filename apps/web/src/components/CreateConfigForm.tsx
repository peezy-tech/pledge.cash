import { useState } from "react";
import {
  Connection,
  Keypair,
  sendAndConfirmTransaction,
  PublicKey,
} from "@solana/web3.js";
import {
  DynamicBondingCurveClient,
  CollectFeeMode,
  TokenType,
  ActivationType,
  MigrationOption,
  FeeSchedulerMode,
  MigrationFeeOption,
  TokenDecimal,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { NATIVE_MINT } from "@solana/spl-token";
import BN from "bn.js";
import bs58 from "bs58";
import { Buffer } from 'buffer';

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";

// Buffer polyfill for browser environment if needed
if (typeof window !== 'undefined') {
  window.Buffer = window.Buffer || Buffer;
}

// Helper to create select options from an enum
const getEnumOptions = (enumObject: any) => {
  return Object.keys(enumObject)
    .filter(key => isNaN(Number(key))) // Filter out numeric keys if enum has them
    .map(key => ({ value: enumObject[key], label: key }));
};

const CreateConfigForm = ({
  onConfigCreated,
}: {
  onConfigCreated: (configAddress: string) => void;
}) => {
  const [payerPrivateKey, setPayerPrivateKey] = useState("");
  const [configAddress, setConfigAddress] = useState("");
  const [transactionSignature, setTransactionSignature] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  // Configurable parameters state
  // poolFees.baseFee
  const [cliffFeeNumerator, setCliffFeeNumerator] = useState("2500000");
  const [baseFeeNumberOfPeriod, setBaseFeeNumberOfPeriod] = useState("0");
  const [reductionFactor, setReductionFactor] = useState("0");
  const [periodFrequency, setPeriodFrequency] = useState("0");
  const [feeSchedulerMode, setFeeSchedulerMode] = useState<FeeSchedulerMode>(FeeSchedulerMode.Linear);

  // activationType
  const [activationType, setActivationType] = useState<ActivationType>(ActivationType.Slot);
  // collectFeeMode
  const [collectFeeMode, setCollectFeeMode] = useState<CollectFeeMode>(CollectFeeMode.OnlyQuote);
  // migrationOption
  const [migrationOption, setMigrationOption] = useState<MigrationOption>(MigrationOption.MET_DAMM_V2);
  // tokenType
  const [tokenType, setTokenType] = useState<TokenType>(TokenType.Token2022);
  // tokenDecimal
  const [tokenDecimal, setTokenDecimal] = useState<TokenDecimal>(TokenDecimal.NINE);
  
  const [migrationQuoteThreshold, setMigrationQuoteThreshold] = useState("3000000000");
  const [partnerLpPercentage, setPartnerLpPercentage] = useState("50");
  const [creatorLpPercentage, setCreatorLpPercentage] = useState("50");
  const [partnerLockedLpPercentage, setPartnerLockedLpPercentage] = useState("0");
  const [creatorLockedLpPercentage, setCreatorLockedLpPercentage] = useState("0");
  const [sqrtStartPrice, setSqrtStartPrice] = useState("58333726687135158");

  // lockedVesting
  const [lvAmountPerPeriod, setLvAmountPerPeriod] = useState("0");
  const [lvCliffDuration, setLvCliffDuration] = useState("0");
  const [lvFrequency, setLvFrequency] = useState("0");
  const [lvNumberOfPeriod, setLvNumberOfPeriod] = useState("0");
  const [lvCliffUnlockAmount, setLvCliffUnlockAmount] = useState("0");
  
  // migrationFeeOption
  const [migrationFeeOption, setMigrationFeeOption] = useState<MigrationFeeOption>(MigrationFeeOption.FixedBps100);

  // tokenSupply
  const [preMigrationTokenSupply, setPreMigrationTokenSupply] = useState("10000000000000000000");
  const [postMigrationTokenSupply, setPostMigrationTokenSupply] = useState("10000000000000000000");

  const [creatorTradingFeePercentage, setCreatorTradingFeePercentage] = useState("0");

  // Curve points (state for 2 points as in the original example)
  const [curve0SqrtPrice, setCurve0SqrtPrice] = useState("233334906748540631");
  const [curve0Liquidity, setCurve0Liquidity] = useState("622226417996106429201027821619672729");
  const [curve1SqrtPrice, setCurve1SqrtPrice] = useState("79226673521066979257578248091");
  const [curve1Liquidity, setCurve1Liquidity] = useState("1");


  const handleCreateConfig = async () => {
    if (!payerPrivateKey) {
      setError("Payer private key is required.");
      return;
    }

    setIsLoading(true);
    setError("");
    setConfigAddress("");
    setTransactionSignature("");

    try {
      const payerSecretKey = bs58.decode(payerPrivateKey);
      const payer = Keypair.fromSecretKey(payerSecretKey);
      const owner = payer; 

      const connection = new Connection(
        "https://devnet.helius-rpc.com/?api-key=81b1290d-9852-4dcc-9c9c-4a4be7ddf3e3",
        "confirmed"
      );

      const configKeypair = Keypair.generate();
      console.log(`New Config account: ${configKeypair.publicKey.toString()}`);

      const feeClaimer = owner.publicKey;

      const createConfigParam = {
        config: configKeypair.publicKey,
        feeClaimer,
        leftoverReceiver: feeClaimer,
        quoteMint: NATIVE_MINT,
        payer: payer.publicKey,
        poolFees: {
          baseFee: {
            cliffFeeNumerator: new BN(cliffFeeNumerator),
            numberOfPeriod: parseInt(baseFeeNumberOfPeriod,10), // The SDK type is number, but original example uses BN(0). Let's assume number. If BN is needed, use new BN(baseFeeNumberOfPeriod)
            reductionFactor: new BN(reductionFactor),
            periodFrequency: new BN(periodFrequency),
            feeSchedulerMode: feeSchedulerMode,
          },
          dynamicFee: null, // Kept as null, can be made configurable if needed
        },
        activationType: activationType,
        collectFeeMode: collectFeeMode,
        migrationOption: migrationOption,
        tokenType: tokenType,
        tokenDecimal: tokenDecimal,
        migrationQuoteThreshold: new BN(migrationQuoteThreshold),
        partnerLpPercentage: parseInt(partnerLpPercentage, 10),
        creatorLpPercentage: parseInt(creatorLpPercentage, 10),
        partnerLockedLpPercentage: parseInt(partnerLockedLpPercentage, 10),
        creatorLockedLpPercentage: parseInt(creatorLockedLpPercentage, 10),
        sqrtStartPrice: new BN(sqrtStartPrice),
        lockedVesting: {
          amountPerPeriod: new BN(lvAmountPerPeriod),
          cliffDurationFromMigrationTime: new BN(lvCliffDuration),
          frequency: new BN(lvFrequency),
          numberOfPeriod: new BN(lvNumberOfPeriod),
          cliffUnlockAmount: new BN(lvCliffUnlockAmount),
        },
        migrationFeeOption: migrationFeeOption,
        tokenSupply: {
          preMigrationTokenSupply: new BN(preMigrationTokenSupply),
          postMigrationTokenSupply: new BN(postMigrationTokenSupply),
        },
        creatorTradingFeePercentage: parseInt(creatorTradingFeePercentage, 10),
        padding0: [], // Kept as empty array
        padding1: [], // Kept as empty array
        curve: [
          {
            sqrtPrice: new BN(curve0SqrtPrice),
            liquidity: new BN(curve0Liquidity),
          },
          {
            sqrtPrice: new BN(curve1SqrtPrice),
            liquidity: new BN(curve1Liquidity),
          },
        ],
      };
      
      // Correcting numberOfPeriod for baseFee if it should be BN
      // The SDK CreateConfigParams expects poolFees.baseFee.numberOfPeriod to be a number.
      // If it must be BN per your setup:
      // createConfigParam.poolFees.baseFee.numberOfPeriod = new BN(baseFeeNumberOfPeriod);
      // For now, sticking to number as per SDK type, original script has BN(0) which is fine for number 0.

      const client = new DynamicBondingCurveClient(connection, "confirmed");
      const transaction = await client.partner.createConfig(createConfigParam);

      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = payer.publicKey;

      transaction.partialSign(configKeypair);

      const signature = await sendAndConfirmTransaction(
        connection,
        transaction,
        [payer, configKeypair],
        { commitment: "confirmed", skipPreflight: true }
      );

      const newConfigAddress = configKeypair.publicKey.toString();
      setConfigAddress(newConfigAddress);
      setTransactionSignature(signature);
      onConfigCreated(newConfigAddress);
      console.log(`Config created successfully! Tx: ${signature}`);
    } catch (err: any) {
      console.error("Failed to create config:", err);
      setError(`Failed to create config: ${err.message} ${err.stack ? '- Stack: ' + err.stack : ''}`);
    } finally {
      setIsLoading(false);
    }
  };
  
  // Options for selects
  const feeSchedulerModeOptions = getEnumOptions(FeeSchedulerMode);
  const activationTypeOptions = getEnumOptions(ActivationType);
  const collectFeeModeOptions = getEnumOptions(CollectFeeMode);
  const migrationOptionOptions = getEnumOptions(MigrationOption);
  const tokenTypeOptions = getEnumOptions(TokenType);
  const tokenDecimalOptions = getEnumOptions(TokenDecimal);
  const migrationFeeOptionOptions = getEnumOptions(MigrationFeeOption);

  return (
    <Card className="w-full max-w-3xl mx-auto">
      <CardHeader>
        <CardTitle>Create DBC Config</CardTitle>
        <CardDescription>Configure and deploy a new Dynamic Bonding Curve configuration.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="payerPrivateKeyConfig">Payer Private Key (Base58):</Label>
          <Input
            id="payerPrivateKeyConfig"
            type="password"
            value={payerPrivateKey}
            onChange={(e) => setPayerPrivateKey(e.target.value)}
            placeholder="Enter your wallet private key"
            disabled={isLoading}
          />
        </div>

        <Separator />
        <h3 className="text-lg font-medium">Pool Fees: Base Fee</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="cliffFeeNumerator">Cliff Fee Numerator (BN):</Label>
              <Input id="cliffFeeNumerator" type="text" value={cliffFeeNumerator} onChange={(e) => setCliffFeeNumerator(e.target.value)} disabled={isLoading} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="baseFeeNumberOfPeriod">Number of Periods (number):</Label>
              <Input id="baseFeeNumberOfPeriod" type="text" value={baseFeeNumberOfPeriod} onChange={(e) => setBaseFeeNumberOfPeriod(e.target.value)} disabled={isLoading} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reductionFactor">Reduction Factor (BN):</Label>
              <Input id="reductionFactor" type="text" value={reductionFactor} onChange={(e) => setReductionFactor(e.target.value)} disabled={isLoading} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="periodFrequency">Period Frequency (BN):</Label>
              <Input id="periodFrequency" type="text" value={periodFrequency} onChange={(e) => setPeriodFrequency(e.target.value)} disabled={isLoading} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="feeSchedulerMode">Fee Scheduler Mode:</Label>
              <Select value={feeSchedulerMode.toString()} onValueChange={(value) => setFeeSchedulerMode(Number(value) as FeeSchedulerMode)} disabled={isLoading}>
                <SelectTrigger id="feeSchedulerMode"><SelectValue placeholder="Select mode" /></SelectTrigger>
                <SelectContent>
                  {feeSchedulerModeOptions.map(opt => <SelectItem key={opt.label} value={opt.value.toString()}>{opt.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
        </div>

        <Separator />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="activationType">Activation Type:</Label>
              <Select value={activationType.toString()} onValueChange={(value) => setActivationType(Number(value) as ActivationType)} disabled={isLoading}>
                <SelectTrigger id="activationType"><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {activationTypeOptions.map(opt => <SelectItem key={opt.label} value={opt.value.toString()}>{opt.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="collectFeeMode">Collect Fee Mode:</Label>
              <Select value={collectFeeMode.toString()} onValueChange={(value) => setCollectFeeMode(Number(value) as CollectFeeMode)} disabled={isLoading}>
                <SelectTrigger id="collectFeeMode"><SelectValue placeholder="Select mode" /></SelectTrigger>
                <SelectContent>
                  {collectFeeModeOptions.map(opt => <SelectItem key={opt.label} value={opt.value.toString()}>{opt.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="migrationOption">Migration Option:</Label>
              <Select value={migrationOption.toString()} onValueChange={(value) => setMigrationOption(Number(value) as MigrationOption)} disabled={isLoading}>
                <SelectTrigger id="migrationOption"><SelectValue placeholder="Select option" /></SelectTrigger>
                <SelectContent>
                  {migrationOptionOptions.map(opt => <SelectItem key={opt.label} value={opt.value.toString()}>{opt.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="tokenType">Token Type:</Label>
              <Select value={tokenType.toString()} onValueChange={(value) => setTokenType(Number(value) as TokenType)} disabled={isLoading}>
                <SelectTrigger id="tokenType"><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {tokenTypeOptions.map(opt => <SelectItem key={opt.label} value={opt.value.toString()}>{opt.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tokenDecimal">Token Decimal:</Label>
              <Select value={tokenDecimal.toString()} onValueChange={(value) => setTokenDecimal(Number(value) as TokenDecimal)} disabled={isLoading}>
                <SelectTrigger id="tokenDecimal"><SelectValue placeholder="Select decimal" /></SelectTrigger>
                <SelectContent>
                  {tokenDecimalOptions.map(opt => <SelectItem key={opt.label} value={opt.value.toString()}>{opt.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
        </div>
        
        <Separator />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="migrationQuoteThreshold">Migration Quote Threshold (BN):</Label>
              <Input id="migrationQuoteThreshold" type="text" value={migrationQuoteThreshold} onChange={(e) => setMigrationQuoteThreshold(e.target.value)} disabled={isLoading} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="partnerLpPercentage">Partner LP Percentage (number):</Label>
              <Input id="partnerLpPercentage" type="text" value={partnerLpPercentage} onChange={(e) => setPartnerLpPercentage(e.target.value)} disabled={isLoading} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="creatorLpPercentage">Creator LP Percentage (number):</Label>
              <Input id="creatorLpPercentage" type="text" value={creatorLpPercentage} onChange={(e) => setCreatorLpPercentage(e.target.value)} disabled={isLoading} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="partnerLockedLpPercentage">Partner Locked LP Percentage (number):</Label>
              <Input id="partnerLockedLpPercentage" type="text" value={partnerLockedLpPercentage} onChange={(e) => setPartnerLockedLpPercentage(e.target.value)} disabled={isLoading} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="creatorLockedLpPercentage">Creator Locked LP Percentage (number):</Label>
              <Input id="creatorLockedLpPercentage" type="text" value={creatorLockedLpPercentage} onChange={(e) => setCreatorLockedLpPercentage(e.target.value)} disabled={isLoading} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sqrtStartPrice">SQRT Start Price (BN):</Label>
              <Input id="sqrtStartPrice" type="text" value={sqrtStartPrice} onChange={(e) => setSqrtStartPrice(e.target.value)} disabled={isLoading} />
            </div>
        </div>

        <Separator />
        <h3 className="text-lg font-medium">Locked Vesting</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="lvAmountPerPeriod">Amount Per Period (BN):</Label>
              <Input id="lvAmountPerPeriod" type="text" value={lvAmountPerPeriod} onChange={(e) => setLvAmountPerPeriod(e.target.value)} disabled={isLoading} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lvCliffDuration">Cliff Duration From Migration Time (BN):</Label>
              <Input id="lvCliffDuration" type="text" value={lvCliffDuration} onChange={(e) => setLvCliffDuration(e.target.value)} disabled={isLoading} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lvFrequency">Frequency (BN):</Label>
              <Input id="lvFrequency" type="text" value={lvFrequency} onChange={(e) => setLvFrequency(e.target.value)} disabled={isLoading} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lvNumberOfPeriod">Number of Periods (BN):</Label>
              <Input id="lvNumberOfPeriod" type="text" value={lvNumberOfPeriod} onChange={(e) => setLvNumberOfPeriod(e.target.value)} disabled={isLoading} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lvCliffUnlockAmount">Cliff Unlock Amount (BN):</Label>
              <Input id="lvCliffUnlockAmount" type="text" value={lvCliffUnlockAmount} onChange={(e) => setLvCliffUnlockAmount(e.target.value)} disabled={isLoading} />
            </div>
        </div>
        
        <Separator />
        <div className="space-y-2">
            <Label htmlFor="migrationFeeOption">Migration Fee Option:</Label>
            <Select value={migrationFeeOption.toString()} onValueChange={(value) => setMigrationFeeOption(Number(value) as MigrationFeeOption)} disabled={isLoading}>
                <SelectTrigger id="migrationFeeOption"><SelectValue placeholder="Select option" /></SelectTrigger>
                <SelectContent>
                  {migrationFeeOptionOptions.map(opt => <SelectItem key={opt.label} value={opt.value.toString()}>{opt.label}</SelectItem>)}
                </SelectContent>
            </Select>
        </div>

        <Separator />
        <h3 className="text-lg font-medium">Token Supply</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="preMigrationTokenSupply">Pre-Migration Token Supply (BN):</Label>
              <Input id="preMigrationTokenSupply" type="text" value={preMigrationTokenSupply} onChange={(e) => setPreMigrationTokenSupply(e.target.value)} disabled={isLoading} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="postMigrationTokenSupply">Post-Migration Token Supply (BN):</Label>
              <Input id="postMigrationTokenSupply" type="text" value={postMigrationTokenSupply} onChange={(e) => setPostMigrationTokenSupply(e.target.value)} disabled={isLoading} />
            </div>
        </div>

        <Separator />
        <div className="space-y-2">
            <Label htmlFor="creatorTradingFeePercentage">Creator Trading Fee Percentage (number):</Label>
            <Input id="creatorTradingFeePercentage" type="text" value={creatorTradingFeePercentage} onChange={(e) => setCreatorTradingFeePercentage(e.target.value)} disabled={isLoading} />
        </div>

        <Separator />
        <h3 className="text-lg font-medium">Curve Data (2 points)</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
                <p className="font-medium mb-2">Point 1:</p>
                <div className="space-y-2 mb-4">
                  <Label htmlFor="curve0SqrtPrice">SQRT Price (BN):</Label>
                  <Input id="curve0SqrtPrice" type="text" value={curve0SqrtPrice} onChange={(e) => setCurve0SqrtPrice(e.target.value)} disabled={isLoading} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="curve0Liquidity">Liquidity (BN):</Label>
                  <Input id="curve0Liquidity" type="text" value={curve0Liquidity} onChange={(e) => setCurve0Liquidity(e.target.value)} disabled={isLoading} />
                </div>
            </div>
            <div>
                <p className="font-medium mb-2">Point 2:</p>
                <div className="space-y-2 mb-4">
                  <Label htmlFor="curve1SqrtPrice">SQRT Price (BN):</Label>
                  <Input id="curve1SqrtPrice" type="text" value={curve1SqrtPrice} onChange={(e) => setCurve1SqrtPrice(e.target.value)} disabled={isLoading} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="curve1Liquidity">Liquidity (BN):</Label>
                  <Input id="curve1Liquidity" type="text" value={curve1Liquidity} onChange={(e) => setCurve1Liquidity(e.target.value)} disabled={isLoading} />
                </div>
            </div>
        </div>
      </CardContent>
      <CardFooter className="flex flex-col items-start space-y-4">
        <Button onClick={handleCreateConfig} disabled={isLoading} className="w-full">
          {isLoading ? "Creating Config..." : "Create Config"}
        </Button>
        {error && (
          <Alert variant="destructive" className="w-full">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {configAddress && (
          <Alert variant="default" className="w-full">
            <AlertTitle>Config Created Successfully!</AlertTitle>
            <AlertDescription>
              Address: <strong>{configAddress}</strong>
              <br />
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

export default CreateConfigForm; 