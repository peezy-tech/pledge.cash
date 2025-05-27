import { Connection, PublicKey } from "@solana/web3.js";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";

async function getConfig() {
  const CONFIG_ADDRESS = process.env.CONFIG_ADDRESS;
  if (!CONFIG_ADDRESS) {
    throw new Error("CONFIG_ADDRESS is not set in environment variables");
  }
  console.log("Fetching config for address:", CONFIG_ADDRESS);

  const connection = new Connection(
    "https://devnet.helius-rpc.com/?api-key=81b1290d-9852-4dcc-9c9c-4a4be7ddf3e3", // Using the same devnet RPC as in create-config.ts
    "confirmed"
  );

  try {
    const client = new DynamicBondingCurveClient(connection, "confirmed");
    const configAddressPublicKey = new PublicKey(CONFIG_ADDRESS);

    console.log(`Fetching pool config for: ${configAddressPublicKey.toBase58()}`);

    const poolConfig = await client.state.getPoolConfig(configAddressPublicKey);

    console.log("Pool Config Details:");
    console.log(JSON.stringify(poolConfig, null, 2)); // Pretty print the JSON object
  } catch (error) {
    console.error("Failed to get pool config:", error);
  }
}

getConfig()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
