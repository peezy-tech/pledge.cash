import * as hl from "@nktkas/hyperliquid";

async function main() {
  try {
    console.log("Initializing Hyperliquid InfoClient...");
    const transport = new hl.HttpTransport();
    const infoClient = new hl.InfoClient({ transport });
    const txHash = "0x2b007758e38ad209be4e04263900e301ef00c6dacaac3b80578c0cd76d1657d9";
    
    console.log(`Fetching transaction details for hash: ${txHash}`);
    const txDetails = await infoClient.txDetails({ hash: txHash });

    console.log("--- Transaction Details ---");
    console.log(JSON.stringify(txDetails, null, 2));
    console.log("---------------------------");

    if (txDetails && txDetails.action && typeof txDetails.action.amount === 'string') {
        console.log(`\nConfirmation: The 'amount' is a string: "${txDetails.action.amount}". This confirms the backend MUST handle decimal conversion for verification.`);
    } else if (txDetails && txDetails.action && typeof txDetails.action.amount === 'number') {
        console.log(`\nConfirmation: The 'amount' is a number: ${txDetails.action.amount}. This confirms the backend MUST handle decimal conversion for verification.`);
    }


  } catch (error) {
    console.error("An error occurred:", error);
    process.exit(1);
  }
}

main(); 