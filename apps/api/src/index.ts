import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { migrate } from "@repo/db";
import { staticPlugin } from "@elysiajs/static";
import { auth_routes, SIWE_COOKIE_NAME } from "./auth";
import { hyperliquidRoutes } from "./hyperliquid_routes";
import { ethers } from "ethers";

migrate();

const app = new Elysia({
  // Cookie config handled by auth_routes or specific JWT setups
})
  .use(
    cors({
      origin: () => true,
      methods: ["GET", "PUT", "POST", "DELETE"],
      allowedHeaders: ["Content-Type", "Authorization", "sec-fetch-site"],
      credentials: true,
    })
  )
  .use(auth_routes)
  .guard((appInstance) =>
    appInstance
      .resolve(async (ctx) => {
        const { cookie } = ctx;
        const jwtInstance = ctx[SIWE_COOKIE_NAME];
        const tokenValue = cookie[SIWE_COOKIE_NAME]?.value;

        if (!tokenValue) {
          return { currentUser: undefined };
        }
        try {
          const payload = await jwtInstance.verify(tokenValue);
          if (!payload || typeof payload.address !== "string") {
            if (cookie[SIWE_COOKIE_NAME]) cookie[SIWE_COOKIE_NAME]?.remove();
            return { currentUser: undefined };
          }
          return { currentUser: { walletAddress: payload.address } };
        } catch (err) {
          console.error("Guard Resolve Error:", err);
          if (cookie[SIWE_COOKIE_NAME]) cookie[SIWE_COOKIE_NAME]?.remove();
          return { currentUser: undefined };
        }
      })
      .onBeforeHandle(async (context) => {
        if (!context.currentUser) {
          context.set.status = 401;
          return { error: "Unauthorized: Access denied. Please log in." };
        }
      })
      .get("/protected/user-profile", (context) => {
        return { user: context.currentUser };
      })
      .use(hyperliquidRoutes)
  )
  .use(
    staticPlugin({
      prefix: "/",
      alwaysStatic: true,
      indexHTML: true,
    })
  )
  .get("/*", () => Bun.file(`public/index.html`))
  .listen(3000);

// // ---- NEW AUCTION VAULT ROUTES ----

// // Environment variables (ensure these are set in your .env or environment)
// const DIRECTOR_PRIVATE_KEY = process.env.DIRECTOR_PRIVATE_KEY;
// const VAULT_CONTRACT_ADDRESS = process.env.VAULT_CONTRACT_ADDRESS;
// const JSON_RPC_PROVIDER_URL = process.env.JSON_RPC_PROVIDER_URL;

// if (!DIRECTOR_PRIVATE_KEY || !VAULT_CONTRACT_ADDRESS || !JSON_RPC_PROVIDER_URL) {
//   console.warn(
//     "[AuctionVault] Missing one or more required environment variables: DIRECTOR_PRIVATE_KEY, VAULT_CONTRACT_ADDRESS, JSON_RPC_PROVIDER_URL. Auction vault routes will not function correctly."
//   );
// }

// // Minimal ABI for the LockedVault contract functions used by the API
// const vaultAbi = [
//   {
//     "inputs": [],
//     "name": "lastAuctionTime",
//     "outputs": [
//       {
//         "internalType": "uint256",
//         "name": "",
//         "type": "uint256"
//       }
//     ],
//     "stateMutability": "view",
//     "type": "function"
//   },
//   {
//     "inputs": [
//       {
//         "internalType": "address",
//         "name": "", // Corresponds to: mapping(address => uint256) public nonces;
//         "type": "address"
//       }
//     ],
//     "name": "nonces",
//     "outputs": [
//       {
//         "internalType": "uint256",
//         "name": "",
//         "type": "uint256"
//       }
//     ],
//     "stateMutability": "view",
//     "type": "function"
//   }
// ];

// let provider: ethers.JsonRpcProvider | undefined;
// let directorWallet: ethers.Wallet | undefined;
// let vaultContract: ethers.Contract | undefined;

// if (DIRECTOR_PRIVATE_KEY && VAULT_CONTRACT_ADDRESS && JSON_RPC_PROVIDER_URL) {
//   try {
//     provider = new ethers.JsonRpcProvider(JSON_RPC_PROVIDER_URL);
//     directorWallet = new ethers.Wallet(DIRECTOR_PRIVATE_KEY, provider);
//     vaultContract = new ethers.Contract(VAULT_CONTRACT_ADDRESS, vaultAbi, provider);
//     console.log("[AuctionVault] Initialized ethers provider, director wallet, and vault contract.");
//   } catch (e) {
//     console.error("[AuctionVault] Failed to initialize ethers components:", e);
//   }
// }

// const auctionVaultRoutes = new Elysia({ prefix: "/auction-vault" })
//   // IMPORTANT: Secure this endpoint properly (e.g., via dedicated auth, IP whitelist, or an API key known only to the director)
//   .post("/director/sign-withdraw-permit",
//     async ({ body, set }) => {
//       if (!directorWallet || !vaultContract || !provider) {
//         console.error("[AuctionVault] Sign permit endpoint called but ethers components not initialized. Check environment variables and RPC connection.");
//         set.status = 503; // Service Unavailable
//         return { success: false, error: "Auction vault service not properly configured or initialized." };
//       }

//       const { owner, token, amount: amountStr } = body;

//       if (!ethers.isAddress(owner) || !ethers.isAddress(token)) {
//         set.status = 400;
//         return { success: false, error: "Invalid owner or token address provided." };
//       }

//       let amount: bigint;
//       try {
//         amount = BigInt(amountStr);
//         if (amount <= 0n) {
//             set.status = 400;
//             return { success: false, error: "Amount must be greater than zero." };
//         }
//       } catch (e) {
//         set.status = 400;
//         return { success: false, error: "Invalid amount format. Must be a string representing a valid integer." };
//       }

//       try {
//         const network = await provider.getNetwork();
//         const chainId = network.chainId;

//         // These are based on the EIP712 constructor: EIP712("LockedVault", "1")
//         const domainName = "LockedVault";
//         const domainVersion = "1";

//         const domain = {
//           name: domainName,
//           version: domainVersion,
//           chainId: chainId,
//           verifyingContract: VAULT_CONTRACT_ADDRESS!,
//         };

//         const types = {
//           Withdraw: [
//             { name: "owner",      type: "address" },
//             { name: "token",      type: "address" },
//             { name: "amount",     type: "uint256" },
//             { name: "nonce",      type: "uint256" },
//             { name: "validAfter", type: "uint256" },
//           ],
//         };
        
//         const lastAuctionTime = await vaultContract.lastAuctionTime();
//         const currentNonce = await vaultContract.nonces(owner);
        
//         const validAfter = lastAuctionTime + 1n; // block.timestamp is in seconds, ensure it's after last settlement

//         const permitData = {
//           owner,
//           token,
//           amount,       // Use BigInt directly here
//           nonce: currentNonce, // Use BigInt directly here
//           validAfter,   // Use BigInt directly here
//         };
        
//         console.log(`[AuctionVault] Preparing to sign permit for owner ${owner}, token ${token}, amount ${amountStr}`);
//         console.log("[AuctionVault] EIP712 Domain:", domain);
//         console.log("[AuctionVault] EIP712 Types:", types);
//         console.log("[AuctionVault] EIP712 Value (Permit Data):", {
//             ...permitData,
//             amount: permitData.amount.toString(), // for logging
//             nonce: permitData.nonce.toString(), // for logging
//             validAfter: permitData.validAfter.toString() // for logging
//         });

//         const signature = await directorWallet.signTypedData(domain, types, permitData);
        
//         console.log(`[AuctionVault] Permit signed successfully for owner ${owner}. Signature: ${signature}`);

//         return {
//           success: true,
//           data: {
//             owner,
//             token,
//             amount: amount.toString(),
//             nonce: currentNonce.toString(),
//             validAfter: validAfter.toString(),
//             signature,
//           },
//         };
//       } catch (error: any) {
//         console.error("[AuctionVault] Error signing withdrawal permit:", error.message, error.stack);
//         set.status = 500;
//         return {
//           success: false,
//           error: error.message || "An unexpected error occurred while signing the withdrawal permit.",
//         };
//       }
//     },
//     {
//       body: t.Object({
//         owner: t.String({ error: "Owner address is required and must be a string." }),
//         token: t.String({ error: "Token address is required and must be a string." }),
//         amount: t.String({ error: "Amount is required and must be a string representing a number." }), 
//       }),
//     }
//   );

// app.use(auctionVaultRoutes);

export type App = typeof app;

// console.log("[API Index] Server running on port 3000. Auction Vault routes initialized if ENV VARS are set.");
