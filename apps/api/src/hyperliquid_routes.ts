import { Elysia, t } from "elysia";
import { db } from "@repo/db";
import {
  hyperliquidInvoices,
  multisigAccounts,
  operatorWallets,
  users,
} from "@repo/db/schema";
import { eq } from "drizzle-orm";
import * as hl from "@nktkas/hyperliquid";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { auth_routes } from "./auth";

const operator = privateKeyToAccount(
  process.env.OPERATOR_PRIVATE_KEY as `0x${string}`
);

const IS_TESTNET = true;

const transport = new hl.HttpTransport({ isTestnet: IS_TESTNET });
const infoClient = new hl.InfoClient({ transport });
const exchangeClient = new hl.ExchangeClient({
  transport,
  wallet: operator,
  isTestnet: IS_TESTNET,
});

const spotTokens = (await infoClient.spotMeta()).tokens.reduce(
  (acc, t) => {
    acc[t.name] = t;
    return acc;
  },
  {} as Record<string, hl.SpotToken>
);

console.log(spotTokens.USDC);

export const hyperliquidRoutes = new Elysia({ prefix: "/hyperliquid" })
  .use(auth_routes)
  .guard((app) =>
    app
      .onBeforeHandle(({ currentUser, status }) => {
        if (!currentUser) {
          return status(401);
        }
      })
      .get("/protected/user-profile", ({ currentUser }) => {
        return { user: currentUser };
      })

      .post(
        "/invoices",
        async ({ body, currentUser, set }) => {
          try {
            // Get the creator's user record
            const creator = await db
              .select()
              .from(users)
              .where(eq(users.evm_address, currentUser.walletAddress))
              .get();
            if (!creator) {
              set.status = 404;
              return { error: "User not found" };
            }

            // Validate token format (should be like "USDC:0x...")
            if (!body.token.includes(":0x")) {
              set.status = 400;
              return {
                error: "Invalid token format. Expected format: 'TOKEN:0x...'",
              };
            }

            // Validate amount is a valid number string
            if (
              isNaN(parseFloat(body.amount)) ||
              parseFloat(body.amount) <= 0
            ) {
              set.status = 400;
              return { error: "Amount must be a valid positive number" };
            }

            // Create the invoice
            const invoice = await db
              .insert(hyperliquidInvoices)
              .values({
                creatorId: creator.id,
                payerAddress: body.payerAddress.toLowerCase(),
                token: body.token,
                amount: body.amount,
                description: body.description,
              })
              .returning()
              .get();

            return invoice;
          } catch (error) {
            console.error("Error creating invoice:", error);
            set.status = 500;
            return { error: "Failed to create invoice" };
          }
        },
        {
          body: t.Object({
            payerAddress: t.String({ error: "Payer address is required" }),
            token: t.String({ error: "Token is required" }),
            amount: t.String({ error: "Amount is required" }),
            description: t.Optional(t.String()),
          }),
        }
      )

      // Get invoices for the authenticated user
      .get("/invoices", async ({ currentUser, set }) => {
        try {
          // Get the user record
          const user = await db
            .select()
            .from(users)
            .where(eq(users.evm_address, currentUser.walletAddress))
            .get();
          if (!user) {
            set.status = 404;
            return { error: "User not found" };
          }

          // Get invoices where user is either creator or payer
          const invoicesAsCreator = await db
            .select()
            .from(hyperliquidInvoices)
            .where(eq(hyperliquidInvoices.creatorId, user.id));

          // For received invoices, we need to join with users to get creator's address
          const invoicesAsPayer = await db
            .select({
              id: hyperliquidInvoices.id,
              creatorId: hyperliquidInvoices.creatorId,
              payerAddress: hyperliquidInvoices.payerAddress,
              token: hyperliquidInvoices.token,
              amount: hyperliquidInvoices.amount,
              description: hyperliquidInvoices.description,
              status: hyperliquidInvoices.status,
              txHash: hyperliquidInvoices.txHash,
              createdAt: hyperliquidInvoices.createdAt,
              paidAt: hyperliquidInvoices.paidAt,
              expiresAt: hyperliquidInvoices.expiresAt,
              creatorAddress: users.evm_address,
            })
            .from(hyperliquidInvoices)
            .innerJoin(users, eq(hyperliquidInvoices.creatorId, users.id))
            .where(
              eq(
                hyperliquidInvoices.payerAddress,
                currentUser.walletAddress.toLowerCase()
              )
            );

          return {
            created: invoicesAsCreator,
            received: invoicesAsPayer,
          };
        } catch (error) {
          console.error("Error fetching invoices:", error);
          set.status = 500;
          return { error: "Failed to fetch invoices" };
        }
      })

      // Confirm that an invoice has been paid
      .put(
        "/invoices/:id/confirm",
        async ({ params, body, currentUser, set }) => {
          try {
            // Get the invoice
            const invoice = await db
              .select()
              .from(hyperliquidInvoices)
              .where(eq(hyperliquidInvoices.id, params.id))
              .get();
            if (!invoice) {
              set.status = 404;
              return { error: "Invoice not found" };
            }

            // Check if the current user is the payer
            if (
              invoice.payerAddress !== currentUser.walletAddress.toLowerCase()
            ) {
              set.status = 403;
              return { error: "Only the payer can confirm payment" };
            }

            // Check if already paid
            if (invoice.status === "paid") {
              set.status = 400;
              return { error: "Invoice is already paid" };
            }

            // Verify the transaction on-chain
            console.log(`Verifying transaction: ${body.txHash}`);
            const txDetails = await infoClient.txDetails({
              hash: body.txHash as `0x${string}`,
            });

            if (!txDetails || txDetails.error) {
              set.status = 400;
              return { error: "Transaction not found or invalid" };
            }

            // Verify transaction details
            if (
              txDetails.user.toLowerCase() !==
              invoice.payerAddress.toLowerCase()
            ) {
              set.status = 400;
              return {
                error: "Transaction sender does not match payer address",
              };
            }

            if (txDetails.action.type !== "spotSend") {
              set.status = 400;
              return { error: "Transaction is not a spot send" };
            }

            // Get creator's address for verification
            const creator = await db
              .select()
              .from(users)
              .where(eq(users.id, invoice.creatorId))
              .get();
            if (!creator || !creator.evm_address) {
              set.status = 500;
              return { error: "Creator not found or missing EVM address" };
            }

            // Type assertion for action properties since they're unknown
            const action = txDetails.action as any;

            if (
              action.destination?.toLowerCase() !==
              creator.evm_address.toLowerCase()
            ) {
              set.status = 400;
              return {
                error: "Transaction destination does not match creator address",
              };
            }

            if (action.token !== invoice.token) {
              set.status = 400;
              return {
                error: "Transaction token does not match invoice token",
              };
            }

            // Verify amount - this is a simplified version, real implementation would need to handle decimals properly
            if (parseFloat(action.amount) !== parseFloat(invoice.amount)) {
              set.status = 400;
              return {
                error: `Transaction amount (${action.amount}) does not match invoice amount (${invoice.amount})`,
              };
            }

            // Update the invoice
            const updatedInvoice = await db
              .update(hyperliquidInvoices)
              .set({
                status: "paid",
                txHash: body.txHash,
                paidAt: Date.now(),
              })
              .where(eq(hyperliquidInvoices.id, params.id))
              .returning()
              .get();

            return updatedInvoice;
          } catch (error) {
            console.error("Error confirming payment:", error);
            set.status = 500;
            return { error: "Failed to confirm payment" };
          }
        },
        {
          body: t.Object({
            txHash: t.String({ error: "Transaction hash is required" }),
          }),
        }
      )

      .get("/operator", async () => ({ operator: operator.address }))

      .post(
        "/multisig",
        async ({ body, set, currentUser }) => {
          try {
            console.log(
              "Starting multisig creation for user:",
              currentUser?.walletAddress
            );
            const { tx } = body;
            console.log("Transaction hash:", tx);

            const txDetails = await infoClient.txDetails({ hash: tx });
            console.log("Transaction details:", txDetails);

            if (!txDetails || txDetails.error) {
              console.log("Transaction not found or invalid");
              set.status = 400;
              return { error: "Transaction not found or invalid" };
            }

            console.log("Transaction action type:", txDetails.action.type);
            if (txDetails.action.type !== "spotSend") {
              console.log("Transaction is not a spot send");
              set.status = 400;
              return { error: "Transaction is not a spot send" };
            }

            console.log(
              "Transaction destination:",
              txDetails.action.destination
            );
            console.log("Expected operator address:", operator.address);
            if (
              txDetails.action.destination?.toLowerCase() !==
              operator.address.toLowerCase()
            ) {
              console.log(
                "Transaction destination does not match operator address"
              );
              set.status = 400;
              return {
                error: "Transaction destination is not a multisig account",
              };
            }

            const expectedToken = `${spotTokens.USDC.name}:${spotTokens.USDC.tokenId}`;
            console.log("Transaction token:", txDetails.action.token);
            console.log("Expected token:", expectedToken);
            if (
              txDetails.action.token !==
              `${spotTokens.USDC.name}:${spotTokens.USDC.tokenId}`
            ) {
              console.log("Transaction token is not USDC");
              set.status = 400;
              return { error: "Transaction token is not USDC" };
            }

            console.log("Transaction amount:", txDetails.action.amount);
            if (txDetails.action.amount !== "5") {
              console.log("Transaction amount is not 5");
              set.status = 400;
              return { error: "Transaction amount is not 5" };
            }

            console.log("Transaction user:", txDetails.user);
            console.log(
              "Current user wallet address:",
              currentUser?.walletAddress
            );
            if (
              txDetails.user?.toLowerCase() !==
              currentUser?.walletAddress.toLowerCase()
            ) {
              console.log("Transaction user does not match current user");
              set.status = 400;
              return { error: "Transaction user does not match current user" };
            }

            console.log(
              "Checking for existing operator wallet for user:",
              currentUser?.walletAddress
            );
            // Check if user already has operator wallet or multisig account
            const existingOperatorWallet = await db
              .select()
              .from(operatorWallets)
              .where(
                eq(operatorWallets.userAddress, currentUser?.walletAddress)
              )
              .get();

            console.log("Existing operator wallet:", existingOperatorWallet);

            console.log(
              "Checking for existing multisig account for user:",
              currentUser?.walletAddress
            );
            const existingMultisigAccount = await db
              .select()
              .from(multisigAccounts)
              .where(
                eq(multisigAccounts.userAddress, currentUser?.walletAddress)
              )
              .get();

            console.log("Existing multisig account:", existingMultisigAccount);

            if (existingOperatorWallet || existingMultisigAccount) {
              console.log(
                "User already has a multisig account or operator wallet"
              );
              set.status = 400;
              return {
                error: "User already has a multisig account or operator wallet",
              };
            }

            console.log("Generating new operator wallet private key");
            const userOperatorWalletPrivateKey = generatePrivateKey();
            const userOperatorWallet = privateKeyToAccount(
              userOperatorWalletPrivateKey
            );
            console.log(
              "Generated operator wallet address:",
              userOperatorWallet.address
            );

            console.log("Inserting operator wallet record into database");
            console.log({
              userAddress: currentUser?.walletAddress,
              address: userOperatorWallet.address,
              privateKey: userOperatorWalletPrivateKey,
            });
            const userOperatorWalletRecord = await db
              .insert(operatorWallets)
              .values({
                userAddress: currentUser?.walletAddress,
                address: userOperatorWallet.address,
                privateKey: userOperatorWalletPrivateKey,
              })
              .returning()
              .get();
            console.log(
              "Operator wallet record created:",
              userOperatorWalletRecord
            );

            console.log("Generating new multisig account private key");
            const multisigAccountPrivateKey = generatePrivateKey();
            const multisigAccount = privateKeyToAccount(
              multisigAccountPrivateKey
            );
            console.log(
              "Generated multisig account address:",
              multisigAccount.address
            );

            console.log("Inserting multisig account record into database");
            const multisigAccountRecord = await db
              .insert(multisigAccounts)
              .values({
                userAddress: currentUser?.walletAddress,
                operatorAddress: userOperatorWallet.address,
                address: multisigAccount.address,
              })
              .returning()
              .get();
            console.log(
              "Multisig account record created:",
              multisigAccountRecord
            );

            // send 1 usdc to operator and 1 usdc to multisig account
            const token =
              `${spotTokens.USDC.name}:${spotTokens.USDC.tokenId}` as const;
            console.log(
              "Sending 1 USDC to operator wallet:",
              userOperatorWallet.address
            );
            console.log("Using token:", token);
            const operatorTx = await exchangeClient.spotSend({
              destination: userOperatorWallet.address,
              token,
              amount: "1",
            });
            console.log("Operator tx result:", operatorTx);

            console.log(
              "Sending 1 USDC to multisig account:",
              multisigAccount.address
            );
            const multisigTx = await exchangeClient.spotSend({
              destination: multisigAccount.address,
              token,
              amount: "1",
            });
            console.log("Multisig tx result:", multisigTx);

            console.log(
              "Creating multisig exchange client for account:",
              multisigAccount.address
            );
            const multisigExchangeClient = new hl.ExchangeClient({
              transport,
              wallet: multisigAccount,
              isTestnet: IS_TESTNET,
            });

            const authorizedUsers = [
              currentUser?.walletAddress,
              userOperatorWallet.address,
            ];
            console.log(
              "Converting to multi-sig user with authorized users:",
              authorizedUsers
            );
            console.log("Threshold: 1");
            const convertTx =
              await multisigExchangeClient.convertToMultiSigUser({
                authorizedUsers: authorizedUsers,
                threshold: 1,
              });
            console.log("Convert to multisig tx result:", convertTx);

            const result = {
              success: true,
              multisig: multisigAccount.address,
              operator: userOperatorWallet.address,
            };
            console.log("Multisig creation completed successfully:", result);

            return result;
          } catch (error) {
            console.error("Error initializing multisig:", error);
            console.error(
              "Error stack:",
              error instanceof Error ? error.stack : "No stack trace"
            );
            set.status = 500;
            return { error: "Failed to initialize multisig" };
          }
        },
        {
          body: t.Object({
            tx: t.TemplateLiteral("0x${string}"),
          }),
        }
      )

      .get("/multisig", async ({ currentUser, set }) => {
        const multisigAccount = await db
          .select()
          .from(multisigAccounts)
          .where(eq(multisigAccounts.userAddress, currentUser!.walletAddress))
          .get();
        return multisigAccount;
      })
  );
