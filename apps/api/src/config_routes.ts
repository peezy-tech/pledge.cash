import { Elysia, t } from 'elysia';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import {
  DynamicBondingCurveClient,
  CollectFeeMode,
  TokenType,
  ActivationType,
  MigrationOption,
  FeeSchedulerMode,
  MigrationFeeOption,
  TokenDecimal,
  type CreateConfigParam, // Import the type
} from '@meteora-ag/dynamic-bonding-curve-sdk';
import { NATIVE_MINT } from '@solana/spl-token';
import BN from 'bn.js';
import { Buffer } from 'buffer';
import { configs, users } from '@repo/db/schema'; // Added schema imports
import { eq } from 'drizzle-orm'; // Added for querying

if (typeof globalThis.Buffer === 'undefined') {
  (globalThis as any).Buffer = Buffer;
}

const SOLANA_RPC_URL = process.env.RPC_URL || "https://devnet.helius-rpc.com/?api-key=81b1290d-9852-4dcc-9c9c-4a4be7ddf3e3";
const connection = new Connection(SOLANA_RPC_URL, "confirmed");

// Helper function to convert client-side string BNs to actual BN objects
// and parse numbers for the SDK's CreateConfigParam
const mapToCreateConfigParam = (body: any, payerPublicKey: PublicKey, configKeypairPublicKey: PublicKey): CreateConfigParam => {
  return {
    config: configKeypairPublicKey,
    feeClaimer: new PublicKey(body.feeClaimer), // Assuming feeClaimer is passed as string PublicKey
    leftoverReceiver: new PublicKey(body.leftoverReceiver), // Assuming leftoverReceiver is passed as string PublicKey
    quoteMint: new PublicKey(body.quoteMint), // Assuming quoteMint is passed as string PublicKey
    payer: payerPublicKey,
    poolFees: {
      baseFee: {
        cliffFeeNumerator: new BN(body.poolFees.baseFee.cliffFeeNumerator),
        numberOfPeriod: parseInt(body.poolFees.baseFee.numberOfPeriod, 10),
        reductionFactor: new BN(body.poolFees.baseFee.reductionFactor),
        periodFrequency: new BN(body.poolFees.baseFee.periodFrequency),
        feeSchedulerMode: body.poolFees.baseFee.feeSchedulerMode as FeeSchedulerMode,
      },
      dynamicFee: {
        binStep: parseInt(body.poolFees.dynamicFee.binStep, 10),
        binStepU128: new BN(body.poolFees.dynamicFee.binStepU128),
        filterPeriod: parseInt(body.poolFees.dynamicFee.filterPeriod, 10),
        decayPeriod: parseInt(body.poolFees.dynamicFee.decayPeriod, 10),
        reductionFactor: parseInt(body.poolFees.dynamicFee.reductionFactor, 10),
        maxVolatilityAccumulator: parseInt(body.poolFees.dynamicFee.maxVolatilityAccumulator, 10),
        variableFeeControl: parseInt(body.poolFees.dynamicFee.variableFeeControl, 10),
      },
    },
    activationType: body.activationType as ActivationType,
    collectFeeMode: body.collectFeeMode as CollectFeeMode,
    migrationOption: body.migrationOption as MigrationOption,
    tokenType: body.tokenType as TokenType,
    tokenDecimal: body.tokenDecimal as TokenDecimal,
    migrationQuoteThreshold: new BN(body.migrationQuoteThreshold),
    partnerLpPercentage: parseInt(body.partnerLpPercentage, 10),
    creatorLpPercentage: parseInt(body.creatorLpPercentage, 10),
    partnerLockedLpPercentage: parseInt(body.partnerLockedLpPercentage, 10),
    creatorLockedLpPercentage: parseInt(body.creatorLockedLpPercentage, 10),
    sqrtStartPrice: new BN(body.sqrtStartPrice),
    lockedVesting: {
      amountPerPeriod: new BN(body.lockedVesting.amountPerPeriod),
      cliffDurationFromMigrationTime: new BN(body.lockedVesting.cliffDurationFromMigrationTime),
      frequency: new BN(body.lockedVesting.frequency),
      numberOfPeriod: new BN(body.lockedVesting.numberOfPeriod),
      cliffUnlockAmount: new BN(body.lockedVesting.cliffUnlockAmount),
    },
    migrationFeeOption: body.migrationFeeOption as MigrationFeeOption,
    tokenSupply: {
      preMigrationTokenSupply: new BN(body.tokenSupply.preMigrationTokenSupply),
      postMigrationTokenSupply: new BN(body.tokenSupply.postMigrationTokenSupply),
    },
    creatorTradingFeePercentage: parseInt(body.creatorTradingFeePercentage, 10),
    padding0: body.padding0 || [],
    padding1: body.padding1 || [],
    curve: body.curve.map((c: any) => ({ // Ensure curve points are also mapped
      sqrtPrice: new BN(c.sqrtPrice),
      liquidity: new BN(c.liquidity),
    })),
  };
};

// Define the detailed schema for the request body, mirroring CreateConfigParam structure but with strings for BN/numbers
const configParamSchema = t.Object({
    feeClaimer: t.String(),
    leftoverReceiver: t.String(),
    quoteMint: t.String(), // Expecting NATIVE_MINT.toBase58() or other mint address
    poolFees: t.Object({
        baseFee: t.Object({
            cliffFeeNumerator: t.String(),
            numberOfPeriod: t.String(),
            reductionFactor: t.String(),
            periodFrequency: t.String(),
            feeSchedulerMode: t.Numeric(), // Use Numeric for enum values
        }),
        dynamicFee: t.Object({
            binStep: t.String(),
            binStepU128: t.String(),
            filterPeriod: t.String(),
            decayPeriod: t.String(),
            reductionFactor: t.String(),
            maxVolatilityAccumulator: t.String(),
            variableFeeControl: t.String(),
        }),
    }),
    activationType: t.Numeric(),
    collectFeeMode: t.Numeric(),
    migrationOption: t.Numeric(),
    tokenType: t.Numeric(),
    tokenDecimal: t.Numeric(),
    migrationQuoteThreshold: t.String(),
    partnerLpPercentage: t.String(),
    creatorLpPercentage: t.String(),
    partnerLockedLpPercentage: t.String(),
    creatorLockedLpPercentage: t.String(),
    sqrtStartPrice: t.String(),
    lockedVesting: t.Object({
        amountPerPeriod: t.String(),
        cliffDurationFromMigrationTime: t.String(),
        frequency: t.String(),
        numberOfPeriod: t.String(),
        cliffUnlockAmount: t.String(),
    }),
    migrationFeeOption: t.Numeric(),
    tokenSupply: t.Object({
        preMigrationTokenSupply: t.String(),
        postMigrationTokenSupply: t.String(),
    }),
    creatorTradingFeePercentage: t.String(),
    padding0: t.Optional(t.Array(t.Any())),
    padding1: t.Optional(t.Array(t.Any())),
    curve: t.Array(t.Object({ // Expecting an array of curve points
        sqrtPrice: t.String(),
        liquidity: t.String(),
    })),
});

export const config_routes = new Elysia({ prefix: '/configs' })
  .post(
    '/prepare-create',
    async ({ body, currentUser, set }: { body: any, currentUser: { walletAddress?: string } | undefined, set: any }) => {
      if (!currentUser || !currentUser.walletAddress) {
        set.status = 401;
        return { error: 'Unauthorized' };
      }

      try {
        const payerPublicKey = new PublicKey(currentUser.walletAddress);
        const configKeypair = Keypair.generate();
        
        const createConfigParamForSDK = mapToCreateConfigParam(body, payerPublicKey, configKeypair.publicKey);

        const client = new DynamicBondingCurveClient(connection as any, "confirmed");
        const configTransaction = await client.partner.createConfig(createConfigParamForSDK);
        
        configTransaction.feePayer = payerPublicKey;
        const { blockhash } = await connection.getLatestBlockhash("confirmed");
        configTransaction.recentBlockhash = blockhash;

        configTransaction.partialSign(configKeypair);

        const serializedTransaction = configTransaction.serialize({
          requireAllSignatures: false,
          verifySignatures: true,
        });

        return {
          serializedTransaction: Buffer.from(serializedTransaction).toString('base64'),
          configAddress: configKeypair.publicKey.toString(),
        };

      } catch (err: any) {
        console.error("API /configs/prepare-create error:", err, err.stack);
        set.status = 500;
        return { error: `Failed to prepare config creation: ${err.message}` };
      }
    },
    {
      body: configParamSchema, // Use the detailed schema
    }
  )
  .post(
    '/submit-signed',
    async ({ body, currentUser, set, db }: { body: any, currentUser: { walletAddress?: string } | undefined, set: any, db: any }) => {
      if (!currentUser || !currentUser.walletAddress) {
        set.status = 401;
        return { error: 'Unauthorized' };
      }
      
      const { signedSerializedTransaction, configAddress, configParams } = body; 

       if (!signedSerializedTransaction || !configAddress || !configParams) {
        set.status = 400;
        return { error: 'Missing required fields: signedSerializedTransaction, configAddress, configParams' };
      }

      try {
        const rawTransaction = Buffer.from(signedSerializedTransaction, 'base64');
        const signature = await connection.sendRawTransaction(rawTransaction, {
          skipPreflight: true,
        });
        
        const confirmation = await connection.confirmTransaction(signature, "confirmed");
        if (confirmation.value.err) {
            throw new Error(`Solana transaction confirmation error: ${JSON.stringify(confirmation.value.err)}`);
        }

        const userWalletAddress = currentUser.walletAddress;
        const userRecord = await db.select().from(users).where(eq(users.solana_account, userWalletAddress)).limit(1);
        const userId = userRecord.length > 0 ? userRecord[0].id : null;

        // Prepare data for DB insertion, converting BN-like strings back if necessary, or storing as is
        // For JSON fields, we'll stringify the objects from configParams
        const newConfigDbRecord = {
          id: configAddress, // Config Public Key is the ID
          feeClaimer: configParams.feeClaimer,
          leftoverReceiver: configParams.leftoverReceiver,
          quoteMint: configParams.quoteMint,
          poolFees: JSON.stringify(configParams.poolFees),
          activationType: configParams.activationType.toString(), // Enums to string
          collectFeeMode: configParams.collectFeeMode.toString(),
          migrationOption: configParams.migrationOption.toString(),
          tokenType: configParams.tokenType.toString(),
          tokenDecimal: configParams.tokenDecimal.toString(),
          migrationQuoteThreshold: configParams.migrationQuoteThreshold, // Already string
          partnerLpPercentage: parseInt(configParams.partnerLpPercentage, 10),
          creatorLpPercentage: parseInt(configParams.creatorLpPercentage, 10),
          partnerLockedLpPercentage: parseInt(configParams.partnerLockedLpPercentage, 10),
          creatorLockedLpPercentage: parseInt(configParams.creatorLockedLpPercentage, 10),
          sqrtStartPrice: configParams.sqrtStartPrice, // Already string
          lockedVesting: JSON.stringify(configParams.lockedVesting),
          migrationFeeOption: configParams.migrationFeeOption.toString(),
          tokenSupply: JSON.stringify(configParams.tokenSupply),
          creatorTradingFeePercentage: parseInt(configParams.creatorTradingFeePercentage, 10),
          curve: JSON.stringify(configParams.curve),
          creatorWalletAddress: userWalletAddress,
          userId: userId,
          transactionSignature: signature,
          createdAt: Date.now(),
        };

        await db.insert(configs).values(newConfigDbRecord).execute();

        return { transactionSignature: signature, configAddress: configAddress };

      } catch (err: any) {
        console.error("API /configs/submit-signed error:", err, err.stack);
        let errorMessage = err.message;
        if (err.logs) errorMessage += ` | Logs: ${err.logs.join(', ')}`;
        set.status = 500;
        return { error: `Failed to submit config transaction: ${errorMessage}` };
      }
    },
    {
      body: t.Object({
        signedSerializedTransaction: t.String(),
        configAddress: t.String(),
        configParams: configParamSchema, // The full config object as submitted to prepare-create
      }),
    }
  ); 