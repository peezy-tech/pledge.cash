import * as hl from "@nktkas/hyperliquid";
import * as fs from "fs/promises";
import * as path from "path";

async function main() {
  // You can change this address to check different users
  const userAddress = "0xE60f03D22bC1D0BFF96F31578A5744F863b6D5b0"; // Default to the destination address from send_spot.ts
  
  try {
    console.log("Initializing Hyperliquid InfoClient...");
    const transport = new hl.HttpTransport();
    const infoClient = new hl.InfoClient({ transport });
    
    console.log(`Fetching user details for address: ${userAddress}`);
    const userDetails = await infoClient.userDetails({ user: userAddress });

    // Write userDetails to a file
    const outputDir = path.resolve(__dirname, "output");
    await fs.mkdir(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `userDetails_${userAddress}.json`);
    await fs.writeFile(outputPath, JSON.stringify(userDetails, null, 2), "utf-8");
    console.log(`User details written to ${outputPath}`);

    // Also check user fills for comparison
    // console.log("\n--- User Fills (for comparison) ---");
    const userFills = await infoClient.userFills({ user: userAddress });
    // console.log(JSON.stringify(userFills, null, 2));
    // console.log("----------------------------------");

    // Check if there are any recent transactions that might contain our spotSend txHash
    console.log("\n--- Analysis ---");
    console.log(`User details keys: ${Object.keys(userDetails)}`);
    console.log(`User fills count: ${userFills.length}`);

    return;

    // Look for any properties that might contain transaction hashes
    const searchForTxHashes = (obj: any, path = ""): void => {
      if (typeof obj === 'object' && obj !== null) {
        Object.entries(obj).forEach(([key, value]) => {
          const currentPath = path ? `${path}.${key}` : key;
          if (typeof value === 'string' && value.startsWith('0x') && value.length > 10) {
            console.log(`Potential tx hash found at ${currentPath}: ${value}`);
          } else if (typeof value === 'object') {
            searchForTxHashes(value, currentPath);
          }
        });
      }
    };

    searchForTxHashes(userDetails, "userDetails");
    searchForTxHashes(userFills, "userFills");

  } catch (error) {
    console.error("An error occurred:", error);
    process.exit(1);
  }
}

main(); 