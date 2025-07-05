import { Elysia, t } from "elysia";
import { db } from "@repo/db";
import {
  agentWallets,
  hyperliquidInvoices,
  invoiceHooks,
  multisigAccounts,
  txHashes,
  users,
} from "@repo/db/schema";
import { eq } from "drizzle-orm";
import * as hl from "@nktkas/hyperliquid";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { auth_routes } from "./auth";
import { executeHooks } from "./execute_hooks";

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
  .get(
    "/invoices/:id",
    async ({ params, set }) => {
      try {
        const invoiceDetails = await db
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
          .where(eq(hyperliquidInvoices.id, params.id))
          .get();

        if (!invoiceDetails) {
          set.status = 404;
          return { error: "Invoice not found" };
        }

        return invoiceDetails;
      } catch (error) {
        console.error(`Error fetching invoice ${params.id}:`, error);
        set.status = 500;
        return { error: "Failed to fetch invoice" };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )
  // Confirm that an invoice has been paid
  .put(
    "/invoices/:id/confirm",
    async ({ params, body, set }) => {
      try {
        // --- GATHER DATA ---
        const invoice = await db
          .select()
          .from(hyperliquidInvoices)
          .where(eq(hyperliquidInvoices.id, params.id))
          .get();

        if (!invoice) {
          set.status = 404;
          return { error: "Invoice not found" };
        }

        if (invoice.status === "paid") {
          set.status = 400;
          return { error: "Invoice is already paid" };
        }

        // Check if txHash is already in the db
        const txHash = await db
          .select()
          .from(txHashes)
          .where(eq(txHashes.hash, body.txHash))
          .get();
        if (txHash) {
          set.status = 400; // Bad request, txHash already exists
          return { error: "Transaction hash already exists" };
        }

        const txDetails = await infoClient.txDetails({
          hash: body.txHash as `0x${string}`,
        });

        if (!txDetails || txDetails.error) {
          set.status = 400;
          return { error: "Transaction not found or invalid" };
        }

        // Insert txHash into the db
        await db.insert(txHashes).values({
          hash: body.txHash,
          metadata: txDetails,
        });

        const creator = await db
          .select()
          .from(users)
          .where(eq(users.id, invoice.creatorId))
          .get();

        if (!creator || !creator.evm_address) {
          set.status = 500;
          return { error: "Invoice creator could not be found" };
        }

        const onChainPayerAddress = txDetails.user.toLowerCase();
        const creatorAddress = creator.evm_address.toLowerCase();
        // --- END GATHER DATA ---

        // --- TRANSACTION VALIDATION ---
        // If invoice was for a specific payer, ensure the on-chain tx was from them.
        if (
          invoice.payerAddress &&
          invoice.payerAddress.toLowerCase() !== onChainPayerAddress
        ) {
          set.status = 400; // Bad request, wrong payer
          return {
            error:
              "Transaction sender does not match the designated payer for this invoice.",
          };
        }

        if (txDetails.action.type !== "spotSend") {
          set.status = 400;
          return { error: "Transaction is not a spot send" };
        }

        const action = txDetails.action as any;

        if (action.destination?.toLowerCase() !== creatorAddress) {
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

        if (parseFloat(action.amount) !== parseFloat(invoice.amount)) {
          set.status = 400;
          return {
            error: `Transaction amount (${action.amount}) does not match invoice amount (${invoice.amount})`,
          };
        }
        // --- END TRANSACTION VALIDATION ---

        // --- REGISTRATION VIA PAYMENT ---
        const existingUser = await db
          .select()
          .from(users)
          .where(eq(users.evm_address, onChainPayerAddress))
          .get();

        if (!existingUser) {
          console.log(
            `No user found for address ${onChainPayerAddress}, creating a new user.`
          );
          await db.insert(users).values({
            evm_address: onChainPayerAddress,
          });
        }
        // --- END REGISTRATION ---

        // Update the invoice
        const updatedInvoice = await db
          .update(hyperliquidInvoices)
          .set({
            status: "paid",
            txHash: body.txHash,
            paidAt: Date.now(),
            // Set the payer address to the on-chain payer
            payerAddress: onChainPayerAddress,
          })
          .where(eq(hyperliquidInvoices.id, params.id))
          .returning()
          .get();

        // --- WEBHOOK ---
        await executeHooks("invoice.paid", updatedInvoice.id);
        // --- END WEBHOOK ---

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
              .where(eq(users.evm_address, currentUser!.walletAddress))
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
                payerAddress: body.payerAddress
                  ? body.payerAddress.toLowerCase()
                  : null,
                token: body.token,
                amount: body.amount,
                description: body.description,
              })
              .returning()
              .get();

            // Create hooks if any are provided
            if (body.hooks && body.hooks.length > 0) {
              await db.insert(invoiceHooks).values(
                body.hooks.map(
                  (hook) =>
                    ({
                      invoiceId: invoice.id,
                      event: hook.event,
                      type: hook.type,
                      url: hook.url,
                    } as typeof invoiceHooks.$inferInsert)
                )
              );
            }

            return invoice;
          } catch (error) {
            console.error("Error creating invoice:", error);
            set.status = 500;
            return { error: "Failed to create invoice" };
          }
        },
        {
          body: t.Object({
            payerAddress: t.Optional(t.String()),
            token: t.String({ error: "Token is required" }),
            amount: t.String({ error: "Amount is required" }),
            description: t.Optional(t.String()),
            hooks: t.Optional(
              t.Array(
                t.Object({
                  event: t.Enum(
                    {
                      "invoice.paid": "invoice.paid",
                      "invoice.created": "invoice.created",
                    },
                    { error: "Invalid hook event" }
                  ),
                  type: t.Enum(
                    {
                      discord: "discord",
                      webhook: "webhook",
                    },
                    {
                      error: "Invalid hook type",
                    }
                  ),
                  url: t.String({
                    error: "Hook URL is required",
                    minLength: 1,
                  }),
                })
              )
            ),
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
            .where(eq(users.evm_address, currentUser!.walletAddress))
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
                currentUser!.walletAddress.toLowerCase()
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
              (txDetails.action as any).destination?.toLowerCase() !==
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
              "Checking for existing multisig account for user:",
              currentUser?.walletAddress
            );
            const existingMultisigAccount = await db
              .select()
              .from(multisigAccounts)
              .where(
                eq(multisigAccounts.userAddress, currentUser!.walletAddress)
              )
              .get();

            console.log("Existing multisig account:", existingMultisigAccount);

            if (existingMultisigAccount) {
              console.log("User already has a multisig account");
              set.status = 400;
              return {
                error: "User already has a multisig account",
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
                userAddress: currentUser!.walletAddress,
                operatorAddress: userOperatorWallet.address,
                operatorPrivateKey: userOperatorWalletPrivateKey,
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
              amount: "0",
            });
            console.log("Operator tx result:", operatorTx);

            console.log(
              "Sending 1 USDC to multisig account:",
              multisigAccount.address
            );
            const multisigTx = await exchangeClient.spotSend({
              destination: multisigAccount.address,
              token,
              amount: "0",
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

            const approveAgentWalletTx =
              await multisigExchangeClient.approveAgent({
                agentAddress: body.agentWalletAddress,
                agentName: "Frontend",
              });

            console.log(
              "Approve agent wallet tx result:",
              approveAgentWalletTx
            );

            const agentWalletRecord = await db
              .insert(agentWallets)
              .values({
                multisigId: multisigAccountRecord.id,
                userId: currentUser!.id,
                address: body.agentWalletAddress,
              })
              .returning()
              .get();

            console.log("Agent wallet record:", agentWalletRecord);

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
            agentWalletAddress: t.TemplateLiteral("0x${string}"),
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
