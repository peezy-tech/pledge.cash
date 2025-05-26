import { useState } from "react";
import {
  // Connection, // No longer used directly
  // Keypair, // No longer used directly for payer or config keypair generation client-side
  // sendAndConfirmTransaction, // Replaced by API calls
  Transaction, // For deserializing from API
  PublicKey,
} from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react"; // Added
import { api } from "@/utils/api"; // Added
import {
  // DynamicBondingCurveClient, // SDK usage moved to backend
  CollectFeeMode,
  TokenType,
  ActivationType,
  MigrationOption,
  FeeSchedulerMode,
  MigrationFeeOption,
  TokenDecimal,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { NATIVE_MINT } from "@solana/spl-token";
// import BN from "bn.js"; // BN conversion handled by backend
// import bs58 from "bs58"; // Private key decoding removed
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
  const { publicKey: payerPublicKey, signTransaction, connected } = useWallet(); // Added
  // const [payerPrivateKey, setPayerPrivateKey] = useState(""); // Removed
  const [configAddress, setConfigAddress] = useState(""); // This will be set by API response
  const [transactionSignature, setTransactionSignature] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [isFormLocked, setIsFormLocked] = useState(true);

  // Configurable parameters state
  // poolFees.baseFee
  const [cliffFeeNumerator, setCliffFeeNumerator] = useState("500000000");
  const [baseFeeNumberOfPeriod, setBaseFeeNumberOfPeriod] = useState("37");
  const [reductionFactor, setReductionFactor] = useState("822");
  const [periodFrequency, setPeriodFrequency] = useState("1");
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
  
  const [migrationQuoteThreshold, setMigrationQuoteThreshold] = useState("161417203068");
  const [partnerLpPercentage, setPartnerLpPercentage] = useState("0");
  const [creatorLpPercentage, setCreatorLpPercentage] = useState("0");
  const [partnerLockedLpPercentage, setPartnerLockedLpPercentage] = useState("0");
  const [creatorLockedLpPercentage, setCreatorLockedLpPercentage] = useState("100");
  const [sqrtStartPrice, setSqrtStartPrice] = useState("6948097559493766");

  // lockedVesting
  const [lvAmountPerPeriod, setLvAmountPerPeriod] = useState("0");
  const [lvCliffDuration, setLvCliffDuration] = useState("0");
  const [lvFrequency, setLvFrequency] = useState("0");
  const [lvNumberOfPeriod, setLvNumberOfPeriod] = useState("0");
  const [lvCliffUnlockAmount, setLvCliffUnlockAmount] = useState("0");
  
  // migrationFeeOption
  const [migrationFeeOption, setMigrationFeeOption] = useState<MigrationFeeOption>(3 as MigrationFeeOption);

  // tokenSupply
  const [preMigrationTokenSupply, setPreMigrationTokenSupply] = useState("1000000000000000000");
  const [postMigrationTokenSupply, setPostMigrationTokenSupply] = useState("1000000000000000000");

  const [creatorTradingFeePercentage, setCreatorTradingFeePercentage] = useState("100");

  // Curve points (state for 1 point as per new JSON)
  const [curve0SqrtPrice, setCurve0SqrtPrice] = useState("12352173439212113");
  const [curve0Liquidity, setCurve0Liquidity] = useState("10164074144088359041115261727390087");

  // poolFees.dynamicFee (New states based on JSON)
  const [dynamicFeeBinStep, setDynamicFeeBinStep] = useState("1");
  const [dynamicFeeBinStepU128, setDynamicFeeBinStepU128] = useState("1844674407370955");
  const [dynamicFeeFilterPeriod, setDynamicFeeFilterPeriod] = useState("10");
  const [dynamicFeeDecayPeriod, setDynamicFeeDecayPeriod] = useState("120");
  const [dynamicFeeReductionFactor, setDynamicFeeReductionFactor] = useState("5000");
  const [dynamicFeeMaxVolatilityAccumulator, setDynamicFeeMaxVolatilityAccumulator] = useState("14460000");
  const [dynamicFeeVariableFeeControl, setDynamicFeeVariableFeeControl] = useState("1913");


  const handleToggleLock = () => {
    setIsFormLocked(prev => !prev);
  };

  const handleCreateConfig = async () => {
    if (!connected || !payerPublicKey || !signTransaction) {
      setError("Wallet not connected or signing function not available.");
      return;
    }
    // if (!payerPrivateKey) { // Removed private key check
    //   setError("Payer private key is required.");
    //   return;
    // }

    setIsLoading(true);
    setError("");
    setConfigAddress("");
    setTransactionSignature("");

    // Collect all parameters into an object matching the API schema
    const configParams = {
      feeClaimer: payerPublicKey.toBase58(), // Default to payer
      leftoverReceiver: payerPublicKey.toBase58(), // Default to payer
      quoteMint: NATIVE_MINT.toBase58(),
      poolFees: {
        baseFee: {
          cliffFeeNumerator,
          numberOfPeriod: baseFeeNumberOfPeriod,
          reductionFactor,
          periodFrequency,
          feeSchedulerMode,
        },
        dynamicFee: {
          binStep: dynamicFeeBinStep,
          binStepU128: dynamicFeeBinStepU128,
          filterPeriod: dynamicFeeFilterPeriod,
          decayPeriod: dynamicFeeDecayPeriod,
          reductionFactor: dynamicFeeReductionFactor,
          maxVolatilityAccumulator: dynamicFeeMaxVolatilityAccumulator,
          variableFeeControl: dynamicFeeVariableFeeControl,
        },
      },
      activationType,
      collectFeeMode,
      migrationOption,
      tokenType,
      tokenDecimal,
      migrationQuoteThreshold,
      partnerLpPercentage,
      creatorLpPercentage,
      partnerLockedLpPercentage,
      creatorLockedLpPercentage,
      sqrtStartPrice,
      lockedVesting: {
        amountPerPeriod: lvAmountPerPeriod,
        cliffDurationFromMigrationTime: lvCliffDuration,
        frequency: lvFrequency,
        numberOfPeriod: lvNumberOfPeriod,
        cliffUnlockAmount: lvCliffUnlockAmount,
      },
      migrationFeeOption,
      tokenSupply: {
        preMigrationTokenSupply,
        postMigrationTokenSupply,
      },
      creatorTradingFeePercentage,
      padding0: [], // Default to empty, API handles optional
      padding1: [], // Default to empty, API handles optional
      curve: [
        {
          sqrtPrice: curve0SqrtPrice,
          liquidity: curve0Liquidity,
        },
      ],
    };

    try {
      console.log("Requesting config transaction preparation from API...", configParams);
      const prepareResponse = await api.configs["prepare-create"].post(configParams as any);

      if (prepareResponse.error || !prepareResponse.data || !prepareResponse.data.serializedTransaction || !prepareResponse.data.configAddress) {
        const errorMessage = prepareResponse.error instanceof Error ? prepareResponse.error.message : JSON.stringify(prepareResponse.error);
        throw new Error(`Failed to prepare config transaction: ${errorMessage}`);
      }

      const { serializedTransaction, configAddress: generatedConfigAddress } = prepareResponse.data;
      setConfigAddress(generatedConfigAddress); // Set the generated config address for display
      console.log(`API generated config address: ${generatedConfigAddress}`);

      const transaction = Transaction.from(Buffer.from(serializedTransaction, 'base64'));
      console.log("Requesting user to sign config transaction...");
      const signedTransaction = await signTransaction(transaction as any); // Cast to any to avoid type issues
      const signedSerializedTx = Buffer.from(signedTransaction.serialize()).toString('base64');

      console.log("Submitting signed config transaction to API...");
      const submitResponse = await api.configs["submit-signed"].post({
        signedSerializedTransaction: signedSerializedTx,
        configAddress: generatedConfigAddress,
        configParams: configParams, // Pass original params for DB storage
      } as any ); // Cast to any to match expected body type if there are slight mismatches with generated client

      if (submitResponse.error || !submitResponse.data || !submitResponse.data.transactionSignature) {
        const errorMessage = submitResponse.error instanceof Error ? submitResponse.error.message : JSON.stringify(submitResponse.error);
        throw new Error(`Failed to submit signed config transaction: ${errorMessage}`);
      }

      setTransactionSignature(submitResponse.data.transactionSignature);
      onConfigCreated(generatedConfigAddress);
      console.log(`Config created successfully! Tx: ${submitResponse.data.transactionSignature}`);

    } catch (err: any) {
      console.error("Failed to create config:", err, err.stack);
      setError(`Failed to create config: ${err.message}${err.response?.data?.error ? ` - API: ${err.response.data.error}` : ''}${err.stack ? ` - Stack: ${err.stack}` : ''}`);
      if (err.response && err.response.data) {
        console.error("API Error details:", err.response.data);
      }
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
        <CardTitle>Create DBC Config (Server Signed)</CardTitle>
        <CardDescription>Configure and deploy a new Dynamic Bonding Curve configuration using server-side transaction preparation. {isFormLocked ? "Unlock to customize parameters." : "Parameters unlocked."}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Payer Private Key Input Removed */}
        {/* <div className="space-y-2">
          <Label htmlFor="payerPrivateKeyConfig">Payer Private Key (Base58):</Label>
          <Input
            id="payerPrivateKeyConfig"
            type="password"
            value={payerPrivateKey}
            onChange={(e) => setPayerPrivateKey(e.target.value)}
            placeholder="Enter your wallet private key"
            disabled={isLoading}
          />
        </div> */}

        <Button onClick={handleToggleLock} disabled={isLoading} variant="outline" className="w-full">
          {isFormLocked ? "Unlock to Customize Parameters" : "Lock Parameters"}
        </Button>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Pool Fees: Base Fee</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cliffFeeNumerator">Cliff Fee Numerator (BN):</Label>
                <Input id="cliffFeeNumerator" type="text" value={cliffFeeNumerator} onChange={(e) => setCliffFeeNumerator(e.target.value)} disabled={isLoading || isFormLocked} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="baseFeeNumberOfPeriod">Number of Periods (number):</Label>
                <Input id="baseFeeNumberOfPeriod" type="text" value={baseFeeNumberOfPeriod} onChange={(e) => setBaseFeeNumberOfPeriod(e.target.value)} disabled={isLoading || isFormLocked} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reductionFactor">Reduction Factor (BN):</Label>
                <Input id="reductionFactor" type="text" value={reductionFactor} onChange={(e) => setReductionFactor(e.target.value)} disabled={isLoading || isFormLocked} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="periodFrequency">Period Frequency (BN):</Label>
                <Input id="periodFrequency" type="text" value={periodFrequency} onChange={(e) => setPeriodFrequency(e.target.value)} disabled={isLoading || isFormLocked} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="feeSchedulerMode">Fee Scheduler Mode:</Label>
                <Select value={feeSchedulerMode.toString()} onValueChange={(value) => setFeeSchedulerMode(Number(value) as FeeSchedulerMode)} disabled={isLoading || isFormLocked}>
                  <SelectTrigger id="feeSchedulerMode"><SelectValue placeholder="Select mode" /></SelectTrigger>
                  <SelectContent>
                    {feeSchedulerModeOptions.map(opt => <SelectItem key={opt.label} value={opt.value.toString()}>{opt.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">General Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="activationType">Activation Type:</Label>
                  <Select value={activationType.toString()} onValueChange={(value) => setActivationType(Number(value) as ActivationType)} disabled={isLoading || isFormLocked}>
                    <SelectTrigger id="activationType"><SelectValue placeholder="Select type" /></SelectTrigger>
                    <SelectContent>
                      {activationTypeOptions.map(opt => <SelectItem key={opt.label} value={opt.value.toString()}>{opt.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="collectFeeMode">Collect Fee Mode:</Label>
                  <Select value={collectFeeMode.toString()} onValueChange={(value) => setCollectFeeMode(Number(value) as CollectFeeMode)} disabled={isLoading || isFormLocked}>
                    <SelectTrigger id="collectFeeMode"><SelectValue placeholder="Select mode" /></SelectTrigger>
                    <SelectContent>
                      {collectFeeModeOptions.map(opt => <SelectItem key={opt.label} value={opt.value.toString()}>{opt.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="migrationOption">Migration Option:</Label>
                  <Select value={migrationOption.toString()} onValueChange={(value) => setMigrationOption(Number(value) as MigrationOption)} disabled={isLoading || isFormLocked}>
                    <SelectTrigger id="migrationOption"><SelectValue placeholder="Select option" /></SelectTrigger>
                    <SelectContent>
                      {migrationOptionOptions.map(opt => <SelectItem key={opt.label} value={opt.value.toString()}>{opt.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="tokenType">Token Type:</Label>
                  <Select value={tokenType.toString()} onValueChange={(value) => setTokenType(Number(value) as TokenType)} disabled={isLoading || isFormLocked}>
                    <SelectTrigger id="tokenType"><SelectValue placeholder="Select type" /></SelectTrigger>
                    <SelectContent>
                      {tokenTypeOptions.map(opt => <SelectItem key={opt.label} value={opt.value.toString()}>{opt.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="tokenDecimal">Token Decimal:</Label>
                  <Select value={tokenDecimal.toString()} onValueChange={(value) => setTokenDecimal(Number(value) as TokenDecimal)} disabled={isLoading || isFormLocked}>
                    <SelectTrigger id="tokenDecimal"><SelectValue placeholder="Select decimal" /></SelectTrigger>
                    <SelectContent>
                      {tokenDecimalOptions.map(opt => <SelectItem key={opt.label} value={opt.value.toString()}>{opt.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Migration & LP Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="migrationQuoteThreshold">Migration Quote Threshold (BN):</Label>
                  <Input id="migrationQuoteThreshold" type="text" value={migrationQuoteThreshold} onChange={(e) => setMigrationQuoteThreshold(e.target.value)} disabled={isLoading || isFormLocked} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="partnerLpPercentage">Partner LP Percentage (number):</Label>
                  <Input id="partnerLpPercentage" type="text" value={partnerLpPercentage} onChange={(e) => setPartnerLpPercentage(e.target.value)} disabled={isLoading || isFormLocked} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="creatorLpPercentage">Creator LP Percentage (number):</Label>
                  <Input id="creatorLpPercentage" type="text" value={creatorLpPercentage} onChange={(e) => setCreatorLpPercentage(e.target.value)} disabled={isLoading || isFormLocked} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="partnerLockedLpPercentage">Partner Locked LP Percentage (number):</Label>
                  <Input id="partnerLockedLpPercentage" type="text" value={partnerLockedLpPercentage} onChange={(e) => setPartnerLockedLpPercentage(e.target.value)} disabled={isLoading || isFormLocked} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="creatorLockedLpPercentage">Creator Locked LP Percentage (number):</Label>
                  <Input id="creatorLockedLpPercentage" type="text" value={creatorLockedLpPercentage} onChange={(e) => setCreatorLockedLpPercentage(e.target.value)} disabled={isLoading || isFormLocked} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sqrtStartPrice">SQRT Start Price (BN):</Label>
                  <Input id="sqrtStartPrice" type="text" value={sqrtStartPrice} onChange={(e) => setSqrtStartPrice(e.target.value)} disabled={isLoading || isFormLocked} />
                </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Locked Vesting</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="lvAmountPerPeriod">Amount Per Period (BN):</Label>
                  <Input id="lvAmountPerPeriod" type="text" value={lvAmountPerPeriod} onChange={(e) => setLvAmountPerPeriod(e.target.value)} disabled={isLoading || isFormLocked} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lvCliffDuration">Cliff Duration From Migration Time (BN):</Label>
                  <Input id="lvCliffDuration" type="text" value={lvCliffDuration} onChange={(e) => setLvCliffDuration(e.target.value)} disabled={isLoading || isFormLocked} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lvFrequency">Frequency (BN):</Label>
                  <Input id="lvFrequency" type="text" value={lvFrequency} onChange={(e) => setLvFrequency(e.target.value)} disabled={isLoading || isFormLocked} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lvNumberOfPeriod">Number of Periods (BN):</Label>
                  <Input id="lvNumberOfPeriod" type="text" value={lvNumberOfPeriod} onChange={(e) => setLvNumberOfPeriod(e.target.value)} disabled={isLoading || isFormLocked} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lvCliffUnlockAmount">Cliff Unlock Amount (BN):</Label>
                  <Input id="lvCliffUnlockAmount" type="text" value={lvCliffUnlockAmount} onChange={(e) => setLvCliffUnlockAmount(e.target.value)} disabled={isLoading || isFormLocked} />
                </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Fee Options & Token Supply</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="space-y-2">
                <Label htmlFor="migrationFeeOption">Migration Fee Option:</Label>
                <Select value={migrationFeeOption.toString()} onValueChange={(value) => setMigrationFeeOption(Number(value) as MigrationFeeOption)} disabled={isLoading || isFormLocked}>
                    <SelectTrigger id="migrationFeeOption"><SelectValue placeholder="Select option" /></SelectTrigger>
                    <SelectContent>
                      {migrationFeeOptionOptions.map(opt => <SelectItem key={opt.label} value={opt.value.toString()}>{opt.label}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>

            <Separator />
            <h4 className="text-md font-medium pt-2">Token Supply</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="preMigrationTokenSupply">Pre-Migration Token Supply (BN):</Label>
                  <Input id="preMigrationTokenSupply" type="text" value={preMigrationTokenSupply} onChange={(e) => setPreMigrationTokenSupply(e.target.value)} disabled={isLoading || isFormLocked} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="postMigrationTokenSupply">Post-Migration Token Supply (BN):</Label>
                  <Input id="postMigrationTokenSupply" type="text" value={postMigrationTokenSupply} onChange={(e) => setPostMigrationTokenSupply(e.target.value)} disabled={isLoading || isFormLocked} />
                </div>
            </div>

            <Separator />
            <div className="space-y-2 pt-2">
                <Label htmlFor="creatorTradingFeePercentage">Creator Trading Fee Percentage (number):</Label>
                <Input id="creatorTradingFeePercentage" type="text" value={creatorTradingFeePercentage} onChange={(e) => setCreatorTradingFeePercentage(e.target.value)} disabled={isLoading || isFormLocked} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Curve Data (1 point)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <p className="font-medium mb-2">Point 1:</p>
                    <div className="space-y-2 mb-4">
                      <Label htmlFor="curve0SqrtPrice">SQRT Price (BN):</Label>
                      <Input id="curve0SqrtPrice" type="text" value={curve0SqrtPrice} onChange={(e) => setCurve0SqrtPrice(e.target.value)} disabled={isLoading || isFormLocked} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="curve0Liquidity">Liquidity (BN):</Label>
                      <Input id="curve0Liquidity" type="text" value={curve0Liquidity} onChange={(e) => setCurve0Liquidity(e.target.value)} disabled={isLoading || isFormLocked} />
                    </div>
                </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Pool Fees: Dynamic Fee</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dynamicFeeBinStep">Bin Step (number):</Label>
                <Input id="dynamicFeeBinStep" type="text" value={dynamicFeeBinStep} onChange={(e) => setDynamicFeeBinStep(e.target.value)} disabled={isLoading || isFormLocked} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dynamicFeeBinStepU128">Bin Step U128 (BN):</Label>
                <Input id="dynamicFeeBinStepU128" type="text" value={dynamicFeeBinStepU128} onChange={(e) => setDynamicFeeBinStepU128(e.target.value)} disabled={isLoading || isFormLocked} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dynamicFeeFilterPeriod">Filter Period (number):</Label>
                <Input id="dynamicFeeFilterPeriod" type="text" value={dynamicFeeFilterPeriod} onChange={(e) => setDynamicFeeFilterPeriod(e.target.value)} disabled={isLoading || isFormLocked} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dynamicFeeDecayPeriod">Decay Period (number):</Label>
                <Input id="dynamicFeeDecayPeriod" type="text" value={dynamicFeeDecayPeriod} onChange={(e) => setDynamicFeeDecayPeriod(e.target.value)} disabled={isLoading || isFormLocked} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dynamicFeeReductionFactor">Reduction Factor (number):</Label>
                <Input id="dynamicFeeReductionFactor" type="text" value={dynamicFeeReductionFactor} onChange={(e) => setDynamicFeeReductionFactor(e.target.value)} disabled={isLoading || isFormLocked} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dynamicFeeMaxVolatilityAccumulator">Max Volatility Accumulator (number):</Label>
                <Input id="dynamicFeeMaxVolatilityAccumulator" type="text" value={dynamicFeeMaxVolatilityAccumulator} onChange={(e) => setDynamicFeeMaxVolatilityAccumulator(e.target.value)} disabled={isLoading || isFormLocked} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dynamicFeeVariableFeeControl">Variable Fee Control (number):</Label>
                <Input id="dynamicFeeVariableFeeControl" type="text" value={dynamicFeeVariableFeeControl} onChange={(e) => setDynamicFeeVariableFeeControl(e.target.value)} disabled={isLoading || isFormLocked} />
              </div>
            </div>
          </CardContent>
        </Card>
      </CardContent>
      <CardFooter className="flex flex-col items-start space-y-4">
        <Button 
            onClick={handleCreateConfig} 
            disabled={isLoading || !connected} 
            className="w-full"
        >
          {isLoading ? "Creating Config..." : (connected ? "Create Config (Sign with Wallet)" : "Connect Wallet to Create Config")}
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