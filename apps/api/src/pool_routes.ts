import { Elysia, t } from 'elysia';
import {
  Connection,
  Keypair,
  PublicKey,
  // sendAndConfirmRawTransaction, // Using sendRawTransaction and confirmTransaction separately
} from '@solana/web3.js';
import {
  DynamicBondingCurveClient,
  TokenType,
  deriveDbcPoolAddress,
} from '@meteora-ag/dynamic-bonding-curve-sdk';
import { NATIVE_MINT } from '@solana/spl-token';
// import bs58 from 'bs58'; // Not directly used in this file for now
import { Buffer } from 'buffer';
import { pools, tokens, users } from '@repo/db/schema'; // Added schema imports
import { eq } from 'drizzle-orm'; // Added for querying
import { serverManager } from './docker_client'; // Corrected import path
import { db } from '@repo/db';

// Ensure Buffer is available if running in an environment where it might not be global
if (typeof globalThis.Buffer === 'undefined') {
  (globalThis as any).Buffer = Buffer;
}

// Use environment variable for RPC URL or fallback to a default devnet RPC
const SOLANA_RPC_URL = process.env.RPC_URL || "https://devnet.helius-rpc.com/?api-key=81b1290d-9852-4dcc-9c9c-4a4be7ddf3e3";
const connection = new Connection(SOLANA_RPC_URL, "confirmed");

export const pool_routes = new Elysia({ prefix: '/pools' })
  .post(
    '/prepare-create',
    async ({ body, currentUser, set }: { body: any, currentUser: { walletAddress?: string } | undefined, set: any }) => {
      if (!currentUser || !currentUser.walletAddress) {
        set.status = 401;
        return { error: 'Unauthorized' };
      }

      const { configAddress, poolName, poolSymbol, poolUri } = body;
      if (!configAddress || !poolName || !poolSymbol || !poolUri) {
        set.status = 400;
        return { error: 'Missing required fields: configAddress, poolName, poolSymbol, poolUri' };
      }

      try {
        const payerPublicKey = new PublicKey(currentUser.walletAddress);
        const poolCreatorPublicKey = payerPublicKey; // User's wallet is also the pool creator

        const configPubKey = new PublicKey(configAddress);
        const baseMintKeypair = Keypair.generate();
        
        // console.log(`API: Generated base mint for pool: ${baseMintKeypair.publicKey.toString()}`);

        const createPoolParam = {
          quoteMint: NATIVE_MINT,
          baseMint: baseMintKeypair.publicKey,
          config: configPubKey,
          baseTokenType: TokenType.SPL,
          quoteTokenType: TokenType.SPL, // NATIVE_MINT is SPL
          name: poolName,
          symbol: poolSymbol,
          uri: poolUri,
          payer: payerPublicKey,
          poolCreator: poolCreatorPublicKey,
        };

        const client = new DynamicBondingCurveClient(connection as any, "confirmed");
        const poolTransaction = await client.pool.createPool(createPoolParam);
        
        poolTransaction.feePayer = payerPublicKey;
        const { blockhash } = await connection.getLatestBlockhash("confirmed");
        poolTransaction.recentBlockhash = blockhash;

        // Server signs with the newly generated baseMintKeypair
        poolTransaction.partialSign(baseMintKeypair);

        const serializedTransaction = poolTransaction.serialize({
          requireAllSignatures: false, // Payer (client) still needs to sign
          verifySignatures: true,    // Verify baseMintKeypair's signature we just added
        });

        // Derive the pool address
        const poolAddress = deriveDbcPoolAddress(
          NATIVE_MINT,
          baseMintKeypair.publicKey,
          configPubKey
        );

        return {
          serializedTransaction: Buffer.from(serializedTransaction).toString('base64'),
          baseMintAddress: baseMintKeypair.publicKey.toString(),
          poolAddress: poolAddress.toString(),
        };

      } catch (err: any) {
        console.error("API /pools/prepare-create error:", err);
        set.status = 500;
        return { error: `Failed to prepare pool creation: ${err.message}` };
      }
    },
    {
      body: t.Object({
        configAddress: t.String({ error: "Config address is required" }),
        poolName: t.String({ error: "Pool name is required" }),
        poolSymbol: t.String({ error: "Pool symbol is required" }),
        poolUri: t.String({ error: "Pool URI is required" }),
      }),
    }
  )
  .post(
    '/submit-signed',
    async ({ body, currentUser, set }: { body: any, currentUser: { walletAddress?: string } | undefined, set: any }) => {
      if (!currentUser || !currentUser.walletAddress) {
        set.status = 401;
        return { error: 'Unauthorized' };
      }
      
      const { 
        signedSerializedTransaction, 
        baseMintAddress, 
        // We need these from the client, or passed through from prepare step if not already in body
        configAddress, 
        poolName, 
        poolSymbol, 
        poolUri,
        poolAddress, // Added poolAddress
      } = body;

       if (!signedSerializedTransaction || !baseMintAddress || !configAddress || !poolName || !poolSymbol || !poolUri || !poolAddress) { // Added poolAddress check
        set.status = 400;
        return { error: 'Missing one or more required fields in request body for submission (signedSerializedTransaction, baseMintAddress, configAddress, poolName, poolSymbol, poolUri, poolAddress)' }; // Added poolAddress to error message
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

        // Transaction confirmed, now save to DB
        const userWalletAddress = currentUser.walletAddress;
        const userRecord = await db.select().from(users).where(eq(users.solana_account, userWalletAddress)).limit(1);
        const userId = userRecord.length > 0 ? userRecord[0].id : null;

        if (!userId) {
          // This case should ideally not happen if user is authenticated via a wallet address that is in the users table
          // Or, we need a flow to create a user if one doesn't exist for this walletAddress
          console.warn(`User record not found for wallet ${userWalletAddress}, pool creator will not be linked to a user ID.`);
        }

        const newPool = await db.insert(pools).values({
          name: poolName,
          symbol: poolSymbol,
          uri: poolUri,
          configAddress: configAddress,
          baseMintAddress: baseMintAddress,
          quoteMintAddress: NATIVE_MINT.toBase58(), // Assuming quote is always NATIVE_MINT for now
          poolAddress: poolAddress, // Added poolAddress to be saved // TODO: Add poolAddress to packages/db/src/schema/pools.ts
          creatorWalletAddress: userWalletAddress,
          userId: userId, // Can be null if userRecord not found
          transactionSignature: signature,
          createdAt: Date.now(), 
        }).returning();

        if (!newPool || newPool.length === 0) {
          throw new Error("Failed to save new pool to database after transaction confirmation.");
        }

        const poolId = newPool[0].id;

        await db.insert(tokens).values({
          id: baseMintAddress, // Using base mint address as token ID
          poolId: poolId,
          name: poolName, // Or a more specific token name if desired
          symbol: poolSymbol, // Or a more specific token symbol
          uri: poolUri, // Or a more specific token URI
          type: "SPL", // Assuming base is SPL, consistent with createPoolParam
          createdAt: Date.now(),
        }).execute();

        // Spawn game server
        let gameServerDetails = null;
        try {
          console.log(`Attempting to spawn game server with ID: ${baseMintAddress}`);
          const gameServer = await serverManager.createGameServer(baseMintAddress);
          gameServerDetails = {
            id: gameServer.id,
            status: gameServer.status,
            port: gameServer.port,
            url: gameServer.url,
          };
          console.log(`Game server ${baseMintAddress} spawned successfully:`, gameServerDetails);

          // Update the pool record with the gameServerUrl
          if (gameServer.url) {
            await db.update(pools)
              .set({ gameServerUrl: gameServer.url })
              .where(eq(pools.id, poolId))
              .execute();
            console.log(`Updated pool ${poolId} with gameServerUrl: ${gameServer.url}`);
          }

        } catch (gameServerError: any) {
          console.error(`Failed to spawn game server ${baseMintAddress}:`, gameServerError);
          // Decide if this should be a critical error or just a warning
          // For now, we'll log it and continue, but not include it in the success response if it fails
        }

        return { 
          transactionSignature: signature, 
          poolId: poolId,
          baseMintAddress: baseMintAddress, 
          poolAddress: poolAddress, // Added poolAddress to response
          gameServer: gameServerDetails, // Add game server details to response
        };

      } catch (err: any) {
        console.error("API /pools/submit-signed error:", err);
        set.status = 500;
        let errorMessage = err.message;
        if (err.logs) {
            console.error("Transaction logs:", err.logs);
            errorMessage += ` | Logs: ${err.logs.join(', ')}`;
        }
        // Include stack for better debugging if available
        if (err.stack) {
            errorMessage += ` | Stack: ${err.stack}`;
        }
        return { error: `Failed to submit transaction: ${errorMessage}` };
      }
    },
    {
      body: t.Object({
        signedSerializedTransaction: t.String({ error: "Signed serialized transaction is required" }),
        baseMintAddress: t.String({ error: "Base mint address is required" }), 
        configAddress: t.String({ error: "Config address is required" }),
        poolName: t.String({ error: "Pool name is required" }),
        poolSymbol: t.String({ error: "Pool symbol is required" }),
        poolUri: t.String({ error: "Pool URI is required" }),
        poolAddress: t.String({ error: "Pool address is required" }), // Added poolAddress validation
      }),
    }
  ); 