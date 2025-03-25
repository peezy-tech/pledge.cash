const { Connection, PublicKey, clusterApiUrl } = require("@solana/web3.js");
const { TOKEN_PROGRAM_ID } = require("@solana/spl-token");

async function watchTokenTransactions(mintAddress) {
  const connection = new Connection(clusterApiUrl("devnet"));

  // Create a PublicKey object from the mint address
  const mintPublicKey = new PublicKey(mintAddress);

  console.log(`Starting to monitor transactions for token: ${mintAddress}`);

  // Method 1: Subscribe to program account changes
  // This will notify you when any SPL token account changes
  const subscriptionId = connection.onProgramAccountChange(
    TOKEN_PROGRAM_ID,
    (accountInfo, context) => {
      // Filter for accounts related to our specific mint
      try {
        // Deserialize the account data
        const accountData = accountInfo.accountInfo.data;
        const mintKey = new PublicKey(accountData.slice(0, 32));

        // Check if this account is associated with our target mint
        if (mintKey.equals(mintPublicKey)) {
          console.log("Token transaction detected!");
          console.log("Slot:", context.slot);
          console.log("Account:", accountInfo.accountId.toBase58());

          // Fetch transaction details with better error handling
          fetchTransactionDetails(connection, context.slot, accountInfo.accountId.toBase58());
        }
      } catch (err) {
        console.error("Error processing account change:", err);
      }
    },
    "confirmed"
  );

  // Method 2: Get token accounts by mint
  console.log("Fetching all accounts for this token...");
  try {
    // Correctly query token accounts by mint (not by owner)
    const accounts = await connection.getProgramAccounts(TOKEN_PROGRAM_ID, {
      filters: [
        {
          dataSize: 165, // Size of token account data
        },
        {
          memcmp: {
            offset: 0, // Mint address is at offset 0 in the account data
            bytes: mintPublicKey.toBase58(),
          },
        },
      ],
    });

    console.log(`Found ${accounts.length} accounts for this token`);

    // For each token account, you can set up a separate subscription
    // This is useful if you want more targeted monitoring
    accounts.forEach((account) => {
      const accountPublicKey = account.pubkey;
      connection.onAccountChange(
        accountPublicKey,
        (accountInfo, context) => {
          console.log(`Account ${accountPublicKey.toBase58()} modified`);
          console.log("New balance or state change detected");
        },
        "confirmed"
      );
    });
  } catch (err) {
    console.error("Error fetching token accounts:", err);
  }

  // Return the subscription ID so you can unsubscribe later if needed
  return subscriptionId;
}

async function fetchTransactionDetails(connection, slot, accountPubkey) {
  try {
    // Get the block for the given slot
    const block = await connection.getBlock(slot, {
      maxSupportedTransactionVersion: 0,
    });

    if (block && block.transactions) {
      // Process each transaction in the block
      block.transactions.forEach((tx, index) => {
        console.log(`Transaction ${index}: ${tx.transaction.signatures[0]}`);
        // Further parse transaction details as needed
      });
    }
  } catch (err) {
    // Handle the case where the block is not available
    if (err.message.includes("Block not available")) {
      console.log(`Block for slot ${slot} not available (already pruned from node)`);
      
      // Alternative: fetch recent transaction signatures for the account
      if (accountPubkey) {
        try {
          console.log(`Fetching recent transactions for account ${accountPubkey}...`);
          
          // Get recent signatures for this account
          const signatures = await connection.getSignaturesForAddress(
            new PublicKey(accountPubkey),
            { limit: 10 }
          );
          
          if (signatures.length > 0) {
            console.log(`Found ${signatures.length} recent transactions`);
            
            // Get the most recent transaction details
            const recentTx = await connection.getParsedTransaction(
              signatures[0].signature,
              { maxSupportedTransactionVersion: 0 }
            );
            
            if (recentTx) {
              console.log(`Recent transaction: ${signatures[0].signature}`);
              console.log(`Status: ${signatures[0].confirmationStatus}`);
              // Further parse transaction details as needed
            }
          } else {
            console.log(`No recent transactions found for account ${accountPubkey}`);
          }
        } catch (fetchErr) {
          console.error("Error fetching transaction history:", fetchErr);
        }
      } else {
        console.log("No account public key provided for alternative transaction fetching");
      }
    } else {
      console.error("Error fetching transaction details:", err);
    }
  }
}

// Example usage
async function main() {
  // Replace with your token's mint address
  const tokenMintAddress = "EkxY8gCiyxTfLnZpUvQs6UMSHYykfrUXQj4iQE1X2e41"; // USDC as an example

  try {
    const subscriptionId = await watchTokenTransactions(tokenMintAddress);
    console.log(`Monitoring started with subscription ID: ${subscriptionId}`);

    // Keep the script running
    console.log("Press Ctrl+C to stop monitoring");
  } catch (err) {
    console.error("Error setting up monitoring:", err);
  }
}

main();
