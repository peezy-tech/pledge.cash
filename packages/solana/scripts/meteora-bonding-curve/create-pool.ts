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

async function createPool() {
  const PAYER_PRIVATE_KEY = process.env.PAYER_PRIVATE_KEY;
  if (!PAYER_PRIVATE_KEY) {
    throw new Error("PAYER_PRIVATE_KEY is not set");
  }
  const payerSecretKey = bs58.decode(PAYER_PRIVATE_KEY);
  const payer = Keypair.fromSecretKey(payerSecretKey);
  console.log("Payer public key:", payer.publicKey.toBase58());

  const POOL_CREATOR_PRIVATE_KEY = PAYER_PRIVATE_KEY
  const poolCreatorSecretKey = bs58.decode(POOL_CREATOR_PRIVATE_KEY);
  const poolCreator = Keypair.fromSecretKey(poolCreatorSecretKey);
  console.log("Pool creator public key:", poolCreator.publicKey.toBase58());

  const connection = new Connection(
    "https://devnet.helius-rpc.com/?api-key=81b1290d-9852-4dcc-9c9c-4a4be7ddf3e3",
    "confirmed"
  );

  const configAddress = new PublicKey("FsLgztNy7Jb2qdTLwkN8Vs9rk3Zgso9MxuJp8hMsy38o"); // input your config key that you created in create-config.ts
  console.log(`Using config: ${configAddress.toString()}`);

  try {
    const baseMint = Keypair.generate();
    console.log(`Generated base mint: ${baseMint.publicKey.toString()}`);

    const createPoolParam = {
      quoteMint: NATIVE_MINT,
      baseMint: baseMint.publicKey,
      config: configAddress,
      baseTokenType: TokenType.SPL,
      quoteTokenType: TokenType.SPL,
      name: "test",
      symbol: "TEST",
      uri: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQFfUnCIPVTtIm4RpwIrOehAhXxNXeuKY2TZQ&s",
      payer: payer.publicKey,
      poolCreator: poolCreator.publicKey,
    };

    const client = new DynamicBondingCurveClient(connection, "confirmed");

    console.log("Creating pool transaction...");
    const poolTransaction = await client.pool.createPool(createPoolParam);

    const signature = await sendAndConfirmTransaction(
      connection,
      poolTransaction,
      [payer, baseMint, poolCreator],
      {
        commitment: "confirmed",
        skipPreflight: true,
      }
    );
    console.log("Transaction confirmed!");
    console.log(`Pool created: https://solscan.io/tx/${signature}`);
  } catch (error) {
    console.error("Failed to create pool:", error);
    console.log("Error details:", JSON.stringify(error, null, 2));
  }
}

createPool()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
