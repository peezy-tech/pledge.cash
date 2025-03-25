const { Connection, clusterApiUrl, PublicKey } = require("@solana/web3.js");

// Connect to Solana network (mainnet-beta, testnet, or devnet)
const connection = new Connection(clusterApiUrl("devnet"));

// Function to watch all transactions in the network
async function watchAllTransactions() {
  console.log("Watching for all transactions...");

  // Subscribe to all transactions
  const subscription = connection.onLogs(
    "all", // Subscribe to all addresses
    (logs, context) => {
      console.log("Transaction signature:", context.signature);
      console.log("Transaction logs:", logs);
    },
    "confirmed" // Commitment level (can be 'finalized', 'confirmed', or 'processed')
  );

  return subscription;
}

// Function to watch transactions for a specific wallet
async function watchWalletTransactions(walletAddress) {
  console.log(`Watching for transactions involving wallet: ${walletAddress}`);

  // According to a StackOverflow answer, we can directly pass the PublicKey to onLogs
  const pubKey = new PublicKey(walletAddress);

  const subscription = connection.onLogs(
    pubKey, // Directly pass the PublicKey object
    (logs, context) => {
      console.log("Transaction signature:", context.signature);
      console.log("Transaction logs:", logs);
      console.log("Transaction involves wallet:", walletAddress);
    },
    "confirmed" // Simply pass the commitment as a string
  );

  return subscription;
}

// Example usage
(async () => {
  try {
    // Watch all transactions
    // const allTxSub = await watchAllTransactions();

    // Watch a specific wallet (replace with an actual wallet address)
    const walletAddress = "G45bxVrpHvSkiwfcfSsvsBeYLKCJrGmZUPCx7vEtFmh2";
    const walletTxSub = await watchWalletTransactions(walletAddress);

    // Keep the script running
    console.log("Subscriptions active. Press Ctrl+C to stop.");

    // If you want to unsubscribe later:
    // connection.removeOnLogsListener(allTxSub);
    // connection.removeOnLogsListener(walletTxSub);
  } catch (error) {
    console.error("Error:", error);
  }
})();
