import * as hl from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";

const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`;
const DESTINATION_ADDRESS = "0xE60f03D22bC1D0BFF96F31578A5744F863b6D5b0" as const;

async function main() {
  const privateKey = PRIVATE_KEY 
  const destinationAddress = DESTINATION_ADDRESS 

  if (!privateKey.startsWith('0x') || !destinationAddress.startsWith('0x')) {
      console.error("Error: PRIVATE_KEY and DESTINATION_ADDRESS must be valid hexadecimal strings (starting with '0x').");
      process.exit(1);
  }

  const account = privateKeyToAccount(privateKey);

  try {
    const amountToSend = "1.123456";
    const transport = new hl.HttpTransport();
    
    // 1. Initialize InfoClient to find the USDC asset details
    console.log("Initializing InfoClient to find USDC details...");
    const infoClient = new hl.InfoClient({ transport });
    const spotMeta = await infoClient.spotMeta();
    
    const usdcAsset = spotMeta.tokens.find(t => t.name === "USDC");
    if (!usdcAsset) {
        throw new Error("Could not find spot USDC in the metadata.");
    }
    const usdcTokenIdentifier = `${usdcAsset.name}:${usdcAsset.tokenId}`;
    console.log(`Found USDC token identifier: ${usdcTokenIdentifier}`);
    console.log(`USDC szDecimals: ${usdcAsset.szDecimals}`);

    // 2. Initialize ExchangeClient with the private key
    console.log("Initializing ExchangeClient...");
    const exchangeClient = new hl.ExchangeClient({
      wallet: account,
      transport,
    });

    // 3. Execute the spotSend transaction
    console.log(`Attempting to send ${amountToSend} USDC to ${destinationAddress}...`);
    const res = await exchangeClient.spotSend({
      destination: destinationAddress,
      token: usdcTokenIdentifier as `${string}:0x${string}`,
      amount: amountToSend,
    });

    console.log(res);

    console.log("--- Transaction Sent Successfully ---");
    // The transaction hash isn't directly returned by spotSend. We need to find it another way.
    // The most reliable way is to query the user's recent transactions.

    console.log("Waiting a moment to query for the transaction...");
    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3s for the tx to be indexed

    const userFills = await infoClient.userFills({ user: account.address });

    // Find the most recent spot send fill
    const spotSendFill = userFills
      .filter(fill => 
        fill.dir === 'Withdraw' && 
        fill.px === '0' && // Spot sends have a price of 0
        fill.coin === 'USDC' // Look for USDC
      )
      .sort((a, b) => b.time - a.time)[0]; // Get the most recent one

    if (!spotSendFill) {
      console.error("Could not find the spot send transaction in recent user fills. Please check the Hyperliquid UI for the transaction hash.");
    } else {
       console.log(`\nFound matching fill. Transaction Hash: ${spotSendFill.tid}`);
       console.log("You can now use this hash with the `verify_tx.ts` script.");
    }

  } catch (error) {
    console.error("An error occurred during the send process:", error);
    process.exit(1);
  }
}

main(); 