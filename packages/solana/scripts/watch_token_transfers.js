const { Connection, PublicKey, clusterApiUrl } = require("@solana/web3.js");
const { TOKEN_PROGRAM_ID } = require("@solana/spl-token");
const http = require("http");
const url = require("url");

// Store account balances and listeners
const accountBalances = new Map();
const accountListeners = new Map();
const watchedWallets = new Set();

// Connection to Solana
let connection;
let mintPublicKey;

// Initialize the monitoring system
async function initializeMonitoring(mintAddress) {
  connection = new Connection(clusterApiUrl("devnet"));

  // Create a PublicKey object from the mint address
  mintPublicKey = new PublicKey(mintAddress);

  console.log(`Initialized monitoring for token: ${mintAddress}`);
  
  // Set up program listener to catch new accounts that might be created
  connection.onProgramAccountChange(
    TOKEN_PROGRAM_ID,
    async (accountInfo, context) => {
      try {
        // Check if this is for our target mint
        const accountData = accountInfo.accountInfo.data;
        const mintKey = new PublicKey(accountData.slice(0, 32));

        if (mintKey.equals(mintPublicKey)) {
          const accountPubkey = accountInfo.accountId.toBase58();
          
          // If this account belongs to a wallet we're watching
          const ownerOffset = 32; // Owner is at offset 32 in token account data
          const ownerPubkey = new PublicKey(accountData.slice(ownerOffset, ownerOffset + 32)).toBase58();
          
          if (watchedWallets.has(ownerPubkey) && !accountBalances.has(accountPubkey)) {
            await addTokenAccountToWatch(accountInfo.accountId);
            console.log(`New token account detected for watched wallet: ${ownerPubkey}`);
          }
        }
      } catch (err) {
        console.error("Error processing program account change:", err);
      }
    },
    "confirmed"
  );
  
  // Create and start the HTTP server
  const PORT = process.env.PORT || 3000;
  const server = http.createServer(handleRequest);
  
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

// Handle HTTP requests
async function handleRequest(req, res) {
  // Set headers for all responses
  res.setHeader("Content-Type", "application/json");
  
  // Parse the URL
  const parsedUrl = url.parse(req.url, true);
  const path = parsedUrl.pathname;
  const query = parsedUrl.query;
  
  // Handle different API endpoints
  try {
    if (path === "/api/status") {
      // Status endpoint
      const statusData = {
        status: 'running',
        watchingAccounts: accountBalances.size,
        watchingWallets: watchedWallets.size,
        token: mintPublicKey.toBase58()
      };
      
      res.writeHead(200);
      res.end(JSON.stringify(statusData));
    } 
    else if (path === "/api/watch") {
      // Watch endpoint
      if (!query.address) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Address parameter is required' }));
        return;
      }
      
      const address = query.address;
      
      try {
        // Validate if the address is a valid Solana public key
        let pubkey;
        try {
          pubkey = new PublicKey(address);
        } catch (e) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Invalid Solana address' }));
          return;
        }
        
        // First, check if it's a token account for our mint
        try {
          const accountInfo = await connection.getAccountInfo(pubkey);
          
          if (accountInfo && accountInfo.owner.equals(TOKEN_PROGRAM_ID)) {
            // This is likely a token account, check if it's for our mint
            const mintKey = new PublicKey(accountInfo.data.slice(0, 32));
            
            if (mintKey.equals(mintPublicKey)) {
              // This is a token account for our mint
              const result = await addTokenAccountToWatch(pubkey);
              res.writeHead(200);
              res.end(JSON.stringify({ 
                success: true, 
                type: 'tokenAccount',
                added: [result]
              }));
              return;
            }
          }
        } catch (e) {
          // Not a token account or error checking, assume it's a wallet
          console.log(`Not a token account or error: ${e.message}`);
        }
        
        // If we got here, try treating it as a wallet
        const results = await findTokenAccountsForWallet(address);
        
        res.writeHead(200);
        res.end(JSON.stringify({
          success: true,
          type: 'wallet',
          wallet: address,
          added: results
        }));
      } catch (err) {
        console.error(`Error in /watch endpoint: ${err.message}`);
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
    }
    else if (path === "/api/unwatch") {
      // Unwatch endpoint
      if (!query.address) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Address parameter is required' }));
        return;
      }
      
      try {
        const result = await removeFromWatchlist(query.address);
        res.writeHead(200);
        res.end(JSON.stringify(result));
      } catch (err) {
        console.error(`Error in /unwatch endpoint: ${err.message}`);
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
    }
    else if (path === "/api/list") {
      // List endpoint
      const watchlist = [];
      
      // List all token accounts we're watching
      for (const [account, balance] of accountBalances.entries()) {
        watchlist.push({
          account,
          balance
        });
      }
      
      // Add the wallets we're watching
      const wallets = Array.from(watchedWallets);
      
      res.writeHead(200);
      res.end(JSON.stringify({
        tokenAccounts: watchlist,
        wallets
      }));
    }
    else {
      // Not found
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  } catch (error) {
    console.error("Server error:", error);
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}

// Helper function to extract token balance from account data
function extractTokenBalance(data) {
  // Token balance is at offset 64, 8 bytes as a little-endian 64-bit number
  const balance = data.readBigUInt64LE(64);
  return Number(balance);
}

// Extract owner address from token account data
function extractOwnerAddress(data) {
  // Owner address is at offset 32, 32 bytes
  return new PublicKey(data.slice(32, 64)).toBase58();
}

// Add a token account to watch
async function addTokenAccountToWatch(accountPubkey) {
  try {
    // If already watching, do nothing
    if (accountListeners.has(accountPubkey.toBase58())) {
      return;
    }
    
    // Get account info
    const accountInfo = await connection.getAccountInfo(accountPubkey);
    if (!accountInfo) {
      throw new Error(`Account ${accountPubkey.toBase58()} not found`);
    }
    
    const accountPubkeyStr = accountPubkey.toBase58();
    const accountData = accountInfo.data;
    
    // Verify this is a token account for our mint
    try {
      const mintKey = new PublicKey(accountData.slice(0, 32));
      if (!mintKey.equals(mintPublicKey)) {
        throw new Error(`Account ${accountPubkeyStr} is not a token account for this mint`);
      }
    } catch (e) {
      throw new Error(`Account ${accountPubkeyStr} is not a valid token account`);
    }
    
    // Extract initial balance
    const balance = extractTokenBalance(accountData);
    
    // Store in our map
    accountBalances.set(accountPubkeyStr, balance);
    
    console.log(`Now watching token account: ${accountPubkeyStr}`);
    console.log(`Initial balance: ${balance}`);
    
    // Set up listener for this account
    const listener = connection.onAccountChange(
      accountPubkey,
      (updatedAccountInfo, context) => {
        const newBalance = extractTokenBalance(updatedAccountInfo.data);
        const oldBalance = accountBalances.get(accountPubkeyStr);
        
        // Update stored balance
        accountBalances.set(accountPubkeyStr, newBalance);
        
        // Log the change
        console.log(`Balance change detected for account: ${accountPubkeyStr}`);
        console.log(`Old balance: ${oldBalance}`);
        console.log(`New balance: ${newBalance}`);
        console.log(`Change: ${newBalance - oldBalance}`);
        
        // Fetch transaction details
        fetchRecentTransactionForAccount(connection, accountPubkeyStr);
      },
      "confirmed"
    );
    
    // Store the listener ID so we can remove it later
    accountListeners.set(accountPubkeyStr, listener);
    
    return {
      account: accountPubkeyStr,
      balance: balance,
      owner: extractOwnerAddress(accountData)
    };
  } catch (err) {
    console.error(`Error adding token account to watch: ${err.message}`);
    throw err;
  }
}

// Find token accounts owned by a wallet
async function findTokenAccountsForWallet(walletAddress) {
  try {
    const walletPubkey = new PublicKey(walletAddress);
    
    // Add to watched wallets set
    watchedWallets.add(walletAddress);
    
    // Find all token accounts owned by this wallet for our mint
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      walletPubkey,
      { mint: mintPublicKey }
    );
    
    console.log(`Found ${tokenAccounts.value.length} token accounts for wallet ${walletAddress}`);
    
    // Add each account to our watchlist
    const results = [];
    for (const account of tokenAccounts.value) {
      const accountPubkey = account.pubkey;
      const result = await addTokenAccountToWatch(accountPubkey);
      if (result) {
        results.push(result);
      }
    }
    
    return results;
  } catch (err) {
    console.error(`Error finding token accounts for wallet: ${err.message}`);
    throw err;
  }
}

// Remove an account or wallet from watching
async function removeFromWatchlist(address) {
  try {
    // Check if it's a wallet address
    if (watchedWallets.has(address)) {
      // Remove wallet from watched set
      watchedWallets.delete(address);
      
      // Find all token accounts for this wallet that we're watching
      const accountsToRemove = [];
      for (const [accountStr, _] of accountBalances) {
        try {
          const accountInfo = await connection.getAccountInfo(new PublicKey(accountStr));
          if (!accountInfo) continue;
          
          const owner = extractOwnerAddress(accountInfo.data);
          if (owner === address) {
            accountsToRemove.push(accountStr);
          }
        } catch (e) {
          console.error(`Error checking account ${accountStr}: ${e.message}`);
        }
      }
      
      // Remove each account
      for (const accountStr of accountsToRemove) {
        // Remove the listener
        if (accountListeners.has(accountStr)) {
          connection.removeAccountChangeListener(accountListeners.get(accountStr));
          accountListeners.delete(accountStr);
        }
        
        // Remove from balances map
        accountBalances.delete(accountStr);
        
        console.log(`Removed token account from watchlist: ${accountStr}`);
      }
      
      console.log(`Removed wallet from watchlist: ${address}`);
      return { removed: true, wallet: address, accounts: accountsToRemove };
    }
    
    // Check if it's a token account we're watching
    if (accountListeners.has(address)) {
      // Remove the listener
      connection.removeAccountChangeListener(accountListeners.get(address));
      accountListeners.delete(address);
      
      // Remove from balances map
      accountBalances.delete(address);
      
      console.log(`Removed token account from watchlist: ${address}`);
      return { removed: true, account: address };
    }
    
    return { removed: false, error: "Address not found in watchlist" };
  } catch (err) {
    console.error(`Error removing from watchlist: ${err.message}`);
    throw err;
  }
}

async function fetchRecentTransactionForAccount(connection, accountPubkey) {
  try {
    console.log(`Fetching recent transaction for account ${accountPubkey}...`);
    
    // Get recent signatures for this account
    const signatures = await connection.getSignaturesForAddress(
      new PublicKey(accountPubkey),
      { limit: 1 }  // Just get the most recent one
    );
    
    if (signatures.length > 0) {
      // Get the most recent transaction details
      const recentTx = await connection.getParsedTransaction(
        signatures[0].signature,
        { maxSupportedTransactionVersion: 0 }
      );
      
      if (recentTx) {
        console.log(`Transaction: ${signatures[0].signature}`);
        console.log(`Status: ${signatures[0].confirmationStatus}`);
        
        // Print transaction details if available
        if (recentTx.meta) {
          console.log(`Fee: ${recentTx.meta.fee}`);
          if (recentTx.meta.postTokenBalances && recentTx.meta.preTokenBalances) {
            console.log("Token balance changes in this transaction:");
            
            // Match pre and post balances to show the changes
            recentTx.meta.postTokenBalances.forEach(postBalance => {
              const preBalance = recentTx.meta.preTokenBalances.find(
                pre => pre.accountIndex === postBalance.accountIndex
              );
              
              if (preBalance) {
                console.log(`Account index: ${postBalance.accountIndex}`);
                console.log(`Pre-balance: ${preBalance.uiTokenAmount.uiAmount}`);
                console.log(`Post-balance: ${postBalance.uiTokenAmount.uiAmount}`);
                console.log(`Change: ${postBalance.uiTokenAmount.uiAmount - preBalance.uiTokenAmount.uiAmount}`);
              }
            });
          }
        }
      }
    } else {
      console.log(`No recent transactions found for account ${accountPubkey}`);
    }
  } catch (err) {
    console.error("Error fetching recent transaction:", err);
  }
}

// Example usage
async function main() {
  // Replace with your token's mint address
  const tokenMintAddress = "EkxY8gCiyxTfLnZpUvQs6UMSHYykfrUXQj4iQE1X2e41"; // USDC as an example

  try {
    await initializeMonitoring(tokenMintAddress);
    console.log(`Balance monitoring started for token: ${tokenMintAddress}`);
    console.log(`HTTP server is running. Use the following endpoints:`);
    console.log(`- GET http://localhost:3000/api/status: Check the monitoring status`);
    console.log(`- GET http://localhost:3000/api/watch?address=<address>: Add a wallet or token account to watch`);
    console.log(`- GET http://localhost:3000/api/unwatch?address=<address>: Remove a wallet or token account from watch`);
    console.log(`- GET http://localhost:3000/api/list: List all watched addresses and their balances`);
  } catch (err) {
    console.error("Error setting up monitoring:", err);
  }
}

main();
