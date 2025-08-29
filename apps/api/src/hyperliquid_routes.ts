import { Elysia, t } from "elysia";
import * as hl from "@nktkas/hyperliquid";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { db } from "@repo/db";
import {
  hyperliquidInvoices,
  users,
  pledgeWalletAccounts,
  agentWallets,
  invoiceHooks,
  txHashes,
  payments,
} from "@repo/db/schema";
import { eq, or } from "drizzle-orm";
import { executeHooks } from "./execute_hooks";
import { auth_routes } from "./auth";
import { getUserAddresses, resolvePaymentWithEdgeCases } from "./address_resolver";
import { getWebSocketClient } from "./websocket_client";
import { getAddress } from "viem";
import {
  recurringPlans,
  recurringCharges,
  pledgeCampaigns,
  pledges,
  pledgeContributions,
  donations,
} from "@repo/db/schema";
import { privateKeyToAccount as viemPrivateKeyToAccount } from "viem/accounts";

function addCadence(from: number, cadence: "daily" | "weekly" | "monthly"): number {
  const d = new Date(from);
  if (cadence === "daily") d.setDate(d.getDate() + 1);
  else if (cadence === "weekly") d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return d.getTime();
}

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
            // NEW: Address abstraction fields
            payerUserId: hyperliquidInvoices.payerUserId,
            paymentType: hyperliquidInvoices.paymentType,
            actualPayerAddress: hyperliquidInvoices.actualPayerAddress,
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
  // Public discover endpoint for active pledge campaigns
  .get("/pledge-campaigns/discover", async ({ set }) => {
    try {
      const active = await db
        .select()
        .from(pledgeCampaigns)
        .where(eq(pledgeCampaigns.status, "active"));
      return { active };
    } catch (error) {
      console.error("Error discovering campaigns:", error);
      set.status = 500;
      return { error: "Failed to discover campaigns" };
    }
  })
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

        // --- TRANSACTION VALIDATION WITH ADDRESS ABSTRACTION ---
        // Resolve the on-chain payer address with edge case handling
        const paymentAnalysis = await resolvePaymentWithEdgeCases(
          onChainPayerAddress,
          invoice.payerAddress
        );
        
        // Check if the payment is valid based on edge case analysis
        if (!paymentAnalysis.edgeCases.isValidPayment) {
          set.status = 400;
          return {
            error: paymentAnalysis.edgeCases.warningMessage || "Payment not authorized",
            details: {
              isOperatorPayment: paymentAnalysis.edgeCases.isOperatorPayment,
              isUnauthorizedPayment: paymentAnalysis.edgeCases.isUnauthorizedPayment,
              actualPayerAddress: onChainPayerAddress,
              designatedPayerAddress: invoice.payerAddress,
            },
          };
        }
        
        // Log edge case warnings for monitoring
        if (paymentAnalysis.edgeCases.warningMessage) {
          console.warn(
            `Payment warning for invoice ${invoice.id}: ${paymentAnalysis.edgeCases.warningMessage}`
          );
        }
        
        const payerResolution = paymentAnalysis.resolution;

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
        let payerUserId: string;
        
        if (payerResolution) {
          // Address is already associated with a user
          payerUserId = payerResolution.userId;
        } else {
          // Address is not associated with any user - register via payment
          // This only happens if the payment comes from a new personal address
          // (pledge wallet addresses are always tied to existing users)
          console.log(
            `No user found for address ${onChainPayerAddress}, creating a new user.`
          );
          const newUser = await db.insert(users).values({
            evm_address: onChainPayerAddress,
          }).returning().get();
          payerUserId = newUser.id;
        }
        // --- END REGISTRATION ---

        // Update the invoice with address abstraction metadata
        const updatedInvoice = await db
          .update(hyperliquidInvoices)
          .set({
            status: "paid",
            txHash: body.txHash,
            paidAt: Date.now(),
            // Set the payer address to the on-chain payer if not already set
            payerAddress: invoice.payerAddress || onChainPayerAddress,
            // NEW: Add address abstraction metadata
            payerUserId: payerUserId,
            paymentType: payerResolution?.paymentType || "personal",
            actualPayerAddress: onChainPayerAddress,
          })
          .where(eq(hyperliquidInvoices.id, params.id))
          .returning()
          .get();

        // Upsert normalized payment record
        try {
          const existingPayment = await db
            .select()
            .from(payments)
            .where(eq(payments.sourceId, updatedInvoice.id))
            .get();

          if (existingPayment) {
            await db
              .update(payments)
              .set({
                status: "paid",
                txHash: body.txHash,
                paidAt: Date.now(),
                payerUserId: payerUserId,
                payerAddress: updatedInvoice.actualPayerAddress || updatedInvoice.payerAddress,
              })
              .where(eq(payments.id, existingPayment.id));
          } else {
            await db.insert(payments).values({
              type: "invoice",
              sourceId: updatedInvoice.id,
              creatorId: updatedInvoice.creatorId,
              payerUserId: payerUserId,
              payerAddress: updatedInvoice.actualPayerAddress || updatedInvoice.payerAddress,
              token: updatedInvoice.token,
              amount: updatedInvoice.amount,
              status: "paid",
              txHash: body.txHash,
              paidAt: Date.now(),
            });
          }
        } catch (e) {
          console.error("Failed to upsert normalized payment for invoice:", e);
        }

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

            // Create normalized payment record (pending)
            await db.insert(payments).values({
              type: "invoice",
              sourceId: invoice.id,
              creatorId: invoice.creatorId,
              payerUserId: null,
              payerAddress: invoice.payerAddress,
              token: invoice.token,
              amount: invoice.amount,
              status: "pending",
            });

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

            // --- WEBHOOK ---
            await executeHooks("invoice.created", invoice.id);
            // --- END WEBHOOK ---

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

          // Get invoices where user is either creator or payer (including via pledge wallet)
          const invoicesAsCreator = await db
            .select({
              id: hyperliquidInvoices.id,
              creatorId: hyperliquidInvoices.creatorId,
              payerAddress: hyperliquidInvoices.payerAddress,
              // Address abstraction fields
              payerUserId: hyperliquidInvoices.payerUserId,
              paymentType: hyperliquidInvoices.paymentType,
              actualPayerAddress: hyperliquidInvoices.actualPayerAddress,
              token: hyperliquidInvoices.token,
              amount: hyperliquidInvoices.amount,
              description: hyperliquidInvoices.description,
              status: hyperliquidInvoices.status,
              txHash: hyperliquidInvoices.txHash,
              createdAt: hyperliquidInvoices.createdAt,
              paidAt: hyperliquidInvoices.paidAt,
              expiresAt: hyperliquidInvoices.expiresAt,
              // For created invoices, the creator address is the current user's address
              creatorAddress: users.evm_address,
            })
            .from(hyperliquidInvoices)
            .innerJoin(users, eq(hyperliquidInvoices.creatorId, users.id))
            .where(eq(hyperliquidInvoices.creatorId, user.id));

          // For received invoices, we need to check both designated payer and actual payer
          const invoicesAsPayer = await db
            .select({
              id: hyperliquidInvoices.id,
              creatorId: hyperliquidInvoices.creatorId,
              payerAddress: hyperliquidInvoices.payerAddress,
              // Address abstraction fields
              payerUserId: hyperliquidInvoices.payerUserId,
              paymentType: hyperliquidInvoices.paymentType,
              actualPayerAddress: hyperliquidInvoices.actualPayerAddress,
              token: hyperliquidInvoices.token,
              amount: hyperliquidInvoices.amount,
              description: hyperliquidInvoices.description,
              status: hyperliquidInvoices.status,
              txHash: hyperliquidInvoices.txHash,
              createdAt: hyperliquidInvoices.createdAt,
              paidAt: hyperliquidInvoices.paidAt,
              expiresAt: hyperliquidInvoices.expiresAt,
              // For received invoices, get the actual creator's personal address
              creatorAddress: users.evm_address,
            })
            .from(hyperliquidInvoices)
            .innerJoin(users, eq(hyperliquidInvoices.creatorId, users.id))
            .where(
              or(
                eq(hyperliquidInvoices.payerAddress, currentUser!.walletAddress.toLowerCase()),
                eq(hyperliquidInvoices.payerUserId, user.id)
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
        "/pledge-wallet",
        async ({ body, set, currentUser }) => {
          try {
            console.log(
              "Starting pledge wallet creation for user:",
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
                error: "Transaction destination is not a pledge wallet account",
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
              "Checking for existing pledge wallet account for user:",
              currentUser?.walletAddress
            );
            const existingPledgeWalletAccount = await db
              .select()
              .from(pledgeWalletAccounts)
              .where(
                eq(pledgeWalletAccounts.userAddress, currentUser!.walletAddress)
              )
              .get();

            console.log("Existing pledge wallet account:", existingPledgeWalletAccount);

            if (existingPledgeWalletAccount) {
              console.log("User already has a pledge wallet account");
              set.status = 400;
              return {
                error: "User already has a pledge wallet account",
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

            console.log("Generating new pledge wallet account private key");
            const pledgeWalletAccountPrivateKey = generatePrivateKey();
            const pledgeWalletAccount = privateKeyToAccount(
              pledgeWalletAccountPrivateKey
            );
            console.log(
              "Generated pledge wallet account address:",
              pledgeWalletAccount.address
            );

            console.log("Inserting pledge wallet account record into database");
            const pledgeWalletAccountRecord = await db
              .insert(pledgeWalletAccounts)
              .values({
                userAddress: currentUser!.walletAddress,
                operatorAddress: userOperatorWallet.address,
                operatorPrivateKey: userOperatorWalletPrivateKey,
                address: pledgeWalletAccount.address,
              })
              .returning()
              .get();
            console.log(
              "Multisig account record created:",
              pledgeWalletAccountRecord
            );

            // send 1 usdc to operator and 1 usdc to pledge wallet account
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
              "Sending 1 USDC to pledge wallet account:",
              pledgeWalletAccount.address
            );
            const pledgeWalletTx = await exchangeClient.spotSend({
              destination: pledgeWalletAccount.address,
              token,
              amount: "0",
            });
            console.log("Pledge wallet tx result:", pledgeWalletTx);

            console.log(
              "Creating pledge wallet exchange client for account:",
              pledgeWalletAccount.address
            );
            const pledgeWalletExchangeClient = new hl.ExchangeClient({
              transport,
              wallet: pledgeWalletAccount,
              isTestnet: IS_TESTNET,
            });

            const approveAgentWalletTx =
              await pledgeWalletExchangeClient.approveAgent({
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
                pledgeWalletId: pledgeWalletAccountRecord.id,
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
              await pledgeWalletExchangeClient.convertToMultiSigUser({
                authorizedUsers: authorizedUsers,
                threshold: 1,
              });
            console.log("Convert to pledge wallet tx result:", convertTx);

            const result = {
              success: true,
              pledgeWallet: pledgeWalletAccount.address,
              operator: userOperatorWallet.address,
            };
            console.log("Multisig creation completed successfully:", result);

            return result;
          } catch (error) {
            console.error("Error initializing pledge wallet:", error);
            console.error(
              "Error stack:",
              error instanceof Error ? error.stack : "No stack trace"
            );
            set.status = 500;
            return { error: "Failed to initialize pledge wallet" };
          }
        },
        {
          body: t.Object({
            tx: t.TemplateLiteral("0x${string}"),
            agentWalletAddress: t.TemplateLiteral("0x${string}"),
          }),
        }
      )

      .get("/pledge-wallet", async ({ currentUser }) => {
        const pledgeWalletAccount = await db
          .select()
          .from(pledgeWalletAccounts)
          .where(eq(pledgeWalletAccounts.userAddress, currentUser!.walletAddress))
          .get();
        return pledgeWalletAccount;
      })
      
      // ================================
      // Recurring Plans
      // ================================
      .post(
        "/recurring",
        async ({ body, currentUser, set }) => {
          try {
            const creator = await db
              .select()
              .from(users)
              .where(eq(users.evm_address, currentUser!.walletAddress))
              .get();
            if (!creator) {
              set.status = 404;
              return { error: "User not found" };
            }

            const nextRunAt = body.startAt ?? Date.now();
            const plan = await db
              .insert(recurringPlans)
              .values({
                creatorId: creator.id,
                payerUserId: body.payerUserId ?? null,
                payerAddress: body.payerAddress?.toLowerCase() ?? null,
                token: body.token,
                amount: body.amount,
                cadence: body.cadence,
                startAt: nextRunAt,
                endAt: body.endAt ?? null,
                autopayEnabled: body.autopayEnabled ?? true,
                nextRunAt,
              })
              .returning()
              .get();

            return plan;
          } catch (error) {
            console.error("Error creating recurring plan:", error);
            set.status = 500;
            return { error: "Failed to create recurring plan" };
          }
        },
        {
          body: t.Object({
            payerUserId: t.Optional(t.String()),
            payerAddress: t.Optional(t.String()),
            token: t.String(),
            amount: t.String(),
            cadence: t.Enum({ daily: "daily", weekly: "weekly", monthly: "monthly" }),
            startAt: t.Optional(t.Number()),
            endAt: t.Optional(t.Number()),
            autopayEnabled: t.Optional(t.Boolean()),
          }),
        }
      )
      .get("/recurring", async ({ currentUser, set }) => {
        try {
          const me = await db
            .select()
            .from(users)
            .where(eq(users.evm_address, currentUser!.walletAddress))
            .get();
          if (!me) {
            set.status = 404;
            return { error: "User not found" };
          }

          const created = await db
            .select()
            .from(recurringPlans)
            .where(eq(recurringPlans.creatorId, me.id));

          const asPayer = await db
            .select()
            .from(recurringPlans)
            .where(
              or(
                eq(recurringPlans.payerUserId, me.id),
                eq(recurringPlans.payerAddress, currentUser!.walletAddress.toLowerCase())
              )
            );

          return { created, asPayer };
        } catch (error) {
          console.error("Error listing recurring plans:", error);
          set.status = 500;
          return { error: "Failed to list recurring plans" };
        }
      })
      .patch(
        "/recurring/:id",
        async ({ params, body, currentUser, set }) => {
          try {
            const me = await db
              .select()
              .from(users)
              .where(eq(users.evm_address, currentUser!.walletAddress))
              .get();
            if (!me) {
              set.status = 404;
              return { error: "User not found" };
            }

            const plan = await db
              .select()
              .from(recurringPlans)
              .where(eq(recurringPlans.id, params.id))
              .get();
            if (!plan || plan.creatorId !== me.id) {
              set.status = 404;
              return { error: "Plan not found" };
            }

            const updated = await db
              .update(recurringPlans)
              .set({
                status: body.status ?? plan.status,
                autopayEnabled:
                  typeof body.autopayEnabled === "boolean"
                    ? body.autopayEnabled
                    : plan.autopayEnabled,
                endAt: body.endAt ?? plan.endAt,
              })
              .where(eq(recurringPlans.id, plan.id))
              .returning()
              .get();

            return updated;
          } catch (error) {
            console.error("Error updating recurring plan:", error);
            set.status = 500;
            return { error: "Failed to update plan" };
          }
        },
        {
          params: t.Object({ id: t.String() }),
          body: t.Object({
            status: t.Optional(
              t.Enum({ active: "active", paused: "paused", cancelled: "cancelled" })
            ),
            autopayEnabled: t.Optional(t.Boolean()),
            endAt: t.Optional(t.Number()),
          }),
        }
      )
      .get(
        "/recurring/:id/charges",
        async ({ params, currentUser, set }) => {
          try {
            const plan = await db
              .select()
              .from(recurringPlans)
              .where(eq(recurringPlans.id, params.id))
              .get();
            if (!plan) {
              set.status = 404;
              return { error: "Plan not found" };
            }
            const charges = await db
              .select()
              .from(recurringCharges)
              .where(eq(recurringCharges.planId, plan.id));
            return charges;
          } catch (error) {
            console.error("Error listing charges:", error);
            set.status = 500;
            return { error: "Failed to list charges" };
          }
        },
        { params: t.Object({ id: t.String() }) }
      )
      .post(
        "/recurring/:id/run",
        async ({ params, currentUser, set }) => {
          try {
            const plan = await db
              .select()
              .from(recurringPlans)
              .where(eq(recurringPlans.id, params.id))
              .get();
            if (!plan) {
              set.status = 404;
              return { error: "Plan not found" };
            }

            // Create a charge record
            const charge = await db
              .insert(recurringCharges)
              .values({
                planId: plan.id,
                token: plan.token,
                amount: plan.amount,
                dueAt: Date.now(),
              })
              .returning()
              .get();

            // Attempt autopay using pledge wallet
            let autopayExecuted = false;
            try {
              if (plan.autopayEnabled && plan.payerUserId) {
                const payer = await db
                  .select()
                  .from(users)
                  .where(eq(users.id, plan.payerUserId))
                  .get();
                const creator = await db
                  .select()
                  .from(users)
                  .where(eq(users.id, plan.creatorId))
                  .get();
                const pw = await db
                  .select()
                  .from(pledgeWalletAccounts)
                  .where(eq(pledgeWalletAccounts.userAddress, payer?.evm_address || ""))
                  .get();

                if (payer && creator && pw) {
                  // Build signer from operator private key
                  const operatorAccount = viemPrivateKeyToAccount(
                    pw.operatorPrivateKey as `0x${string}`
                  );

                  const multi = new hl.MultiSignClient({
                    transport: new hl.HttpTransport({ isTestnet: IS_TESTNET }),
                    multiSignAddress: pw.address as `0x${string}`,
                    signatureChainId: `0x${(1337).toString(16)}` as `0x${string}`,
                    signers: [
                      {
                        address: operatorAccount.address,
                        signTypedData: async (params: any) => {
                          return operatorAccount.signTypedData(params);
                        },
                      },
                    ],
                    isTestnet: IS_TESTNET,
                  });

                  await multi.spotSend({
                    destination: creator.evm_address as `0x${string}`,
                    token: plan.token as `${string}:0x${string}`,
                    amount: plan.amount,
                  });

                  // poll for tx hash briefly
                  await new Promise((r) => setTimeout(r, 2000));
                  const details = await infoClient.userDetails({
                    user: pw.address as `0x${string}`,
                  });
                  const tx = details
                    .filter((tx: any) =>
                      tx.action.type === "spotSend" &&
                      tx.action.destination?.toLowerCase() ===
                        creator.evm_address?.toLowerCase() &&
                      tx.action.token === plan.token &&
                      tx.action.amount === plan.amount &&
                      tx.error === null
                    )
                    .sort((a: any, b: any) => b.time - a.time)[0];

                  // Ensure tx hash is stored for FK relations
                  if (tx?.hash) {
                    const existingTx = await db
                      .select()
                      .from(txHashes)
                      .where(eq(txHashes.hash, tx.hash))
                      .get();
                    if (!existingTx) {
                      await db.insert(txHashes).values({ hash: tx.hash, metadata: tx });
                    }
                  }

                  await db
                    .update(recurringCharges)
                    .set({
                      status: "paid",
                      runAt: Date.now(),
                      txHash: tx?.hash,
                    })
                    .where(eq(recurringCharges.id, charge.id));

                  // Record normalized payment (recurring)
                  await db.insert(payments).values({
                    type: "recurring",
                    sourceId: charge.id,
                    creatorId: plan.creatorId,
                    payerUserId: plan.payerUserId ?? null,
                    payerAddress: pw.address,
                    token: plan.token,
                    amount: plan.amount,
                    status: "paid",
                    txHash: tx?.hash,
                    paidAt: Date.now(),
                  });

                  // Advance schedule
                  await db
                    .update(recurringPlans)
                    .set({ nextRunAt: addCadence(Date.now(), plan.cadence) })
                    .where(eq(recurringPlans.id, plan.id));

                  autopayExecuted = true;
                }
              }
            } catch (e) {
              console.error("Autopay failed:", e);
              await db
                .update(recurringCharges)
                .set({ status: "failed", runAt: Date.now(), error: String(e) })
                .where(eq(recurringCharges.id, charge.id));
            }

            if (!autopayExecuted) {
              // Create an invoice for manual payment
              const creator = await db
                .select()
                .from(users)
                .where(eq(users.id, plan.creatorId))
                .get();
              const payerAddress = plan.payerAddress || (await db
                .select()
                .from(users)
                .where(eq(users.id, plan.payerUserId || ""))
                .get())?.evm_address || null;

              const invoice = await db
                .insert(hyperliquidInvoices)
                .values({
                  creatorId: creator!.id,
                  payerAddress: payerAddress,
                  token: plan.token,
                  amount: plan.amount,
                  description: `Recurring charge for plan ${plan.id}`,
                })
                .returning()
                .get();

              // payments insert is handled elsewhere for invoices; return invoice id for UI
              return { charge, invoiceId: invoice.id };
            }

            return { charge, autopay: true };
          } catch (error) {
            console.error("Error running recurring plan:", error);
            set.status = 500;
            return { error: "Failed to run plan" };
          }
        },
        { params: t.Object({ id: t.String() }) }
      )

      // ================================
      // Pledge Campaigns & Pledges
      // ================================
      .post(
        "/pledge-campaigns",
        async ({ body, currentUser, set }) => {
          try {
            const me = await db
              .select()
              .from(users)
              .where(eq(users.evm_address, currentUser!.walletAddress))
              .get();
            if (!me) {
              set.status = 404;
              return { error: "User not found" };
            }
            const campaign = await db
              .insert(pledgeCampaigns)
              .values({
                creatorId: me.id,
                name: body.name,
                description: body.description ?? null,
                goalToken: body.goalToken,
                goalAmount: body.goalAmount,
              })
              .returning()
              .get();
            return campaign;
          } catch (error) {
            console.error("Error creating campaign:", error);
            set.status = 500;
            return { error: "Failed to create campaign" };
          }
        },
        {
          body: t.Object({
            name: t.String(),
            description: t.Optional(t.String()),
            goalToken: t.String(),
            goalAmount: t.String(),
          }),
        }
      )
      .get("/pledge-campaigns", async ({ currentUser, set }) => {
        try {
          const me = await db
            .select()
            .from(users)
            .where(eq(users.evm_address, currentUser!.walletAddress))
            .get();
          if (!me) {
            set.status = 404;
            return { error: "User not found" };
          }
          const created = await db
            .select()
            .from(pledgeCampaigns)
            .where(eq(pledgeCampaigns.creatorId, me.id));
          return { created };
        } catch (error) {
          console.error("Error listing campaigns:", error);
          set.status = 500;
          return { error: "Failed to list campaigns" };
        }
      })
      .post(
        "/pledges",
        async ({ body, set }) => {
          try {
            const now = Date.now();
            const nextRunAt = body.startAt ?? now;
            const pledge = await db
              .insert(pledges)
              .values({
                campaignId: body.campaignId,
                pledgerUserId: body.pledgerUserId ?? null,
                pledgerAddress: body.pledgerAddress?.toLowerCase() ?? null,
                token: body.token,
                amountPerCadence: body.amountPerCadence,
                cadence: body.cadence,
                autopayEnabled: body.autopayEnabled ?? true,
                nextRunAt,
              })
              .returning()
              .get();
            return pledge;
          } catch (error) {
            console.error("Error creating pledge:", error);
            set.status = 500;
            return { error: "Failed to create pledge" };
          }
        },
        {
          body: t.Object({
            campaignId: t.String(),
            pledgerUserId: t.Optional(t.String()),
            pledgerAddress: t.Optional(t.String()),
            token: t.String(),
            amountPerCadence: t.String(),
            cadence: t.Enum({ daily: "daily", weekly: "weekly", monthly: "monthly" }),
            startAt: t.Optional(t.Number()),
            autopayEnabled: t.Optional(t.Boolean()),
          }),
        }
      )
      // List pledges where current user is pledger (by userId or address)
      .get("/pledges", async ({ currentUser, set }) => {
        try {
          const me = await db
            .select()
            .from(users)
            .where(eq(users.evm_address, currentUser!.walletAddress))
            .get();
          if (!me) {
            set.status = 404;
            return { error: "User not found" };
          }

          const myPledges = await db
            .select()
            .from(pledges)
            .where(
              or(
                eq(pledges.pledgerUserId, me.id),
                eq(pledges.pledgerAddress, currentUser!.walletAddress.toLowerCase())
              )
            );

          return { pledges: myPledges };
        } catch (error) {
          console.error("Error listing pledges:", error);
          set.status = 500;
          return { error: "Failed to list pledges" };
        }
      })
      .put(
        "/pledge-contributions/:id/confirm",
        async ({ params, body, set }) => {
          try {
            const contrib = await db
              .select()
              .from(pledgeContributions)
              .where(eq(pledgeContributions.id, params.id))
              .get();
            if (!contrib) {
              set.status = 404;
              return { error: "Contribution not found" };
            }

            const campaign = await db
              .select()
              .from(pledgeCampaigns)
              .where(eq(pledgeCampaigns.id, contrib.campaignId))
              .get();
            if (!campaign) {
              set.status = 404;
              return { error: "Campaign not found" };
            }
            const creator = await db
              .select()
              .from(users)
              .where(eq(users.id, campaign.creatorId))
              .get();
            if (!creator?.evm_address) {
              set.status = 500;
              return { error: "Campaign creator missing address" };
            }

            // Validate tx
            const tx = await infoClient.txDetails({ hash: body.txHash });
            if (!tx || tx.error || tx.action.type !== "spotSend") {
              set.status = 400;
              return { error: "Invalid transaction" };
            }
            const action = tx.action as any;
            if (action.destination?.toLowerCase() !== creator.evm_address.toLowerCase()) {
              set.status = 400;
              return { error: "Destination mismatch" };
            }
            if (action.token !== contrib.token) {
              set.status = 400;
              return { error: "Token mismatch" };
            }
            if (parseFloat(action.amount) !== parseFloat(contrib.amount)) {
              set.status = 400;
              return { error: "Amount mismatch" };
            }

            // store tx hash
            const existing = await db
              .select()
              .from(txHashes)
              .where(eq(txHashes.hash, body.txHash))
              .get();
            if (!existing) {
              await db.insert(txHashes).values({ hash: body.txHash, metadata: tx });
            }

            await db
              .update(pledgeContributions)
              .set({ txHash: body.txHash })
              .where(eq(pledgeContributions.id, contrib.id));

            // normalized payment
            await db.insert(payments).values({
              type: "pledge",
              sourceId: contrib.id,
              creatorId: campaign.creatorId,
              payerUserId: contrib.payerUserId ?? null,
              payerAddress: tx.user?.toLowerCase() || contrib.fromAddress || null,
              token: contrib.token,
              amount: contrib.amount,
              status: "paid",
              txHash: body.txHash,
              paidAt: Date.now(),
            });

            // Update campaign raised amount cache (best-effort)
            const newRaised = (parseFloat(campaign.raisedAmount || "0") + parseFloat(contrib.amount)).toString();
            await db
              .update(pledgeCampaigns)
              .set({ raisedAmount: newRaised })
              .where(eq(pledgeCampaigns.id, campaign.id));

            return { success: true };
          } catch (error) {
            console.error("Error confirming pledge contribution:", error);
            set.status = 500;
            return { error: "Failed to confirm contribution" };
          }
        },
        {
          params: t.Object({ id: t.String() }),
          body: t.Object({ txHash: t.TemplateLiteral("0x${string}") }),
        }
      )
      .post(
        "/pledges/:id/pay",
        async ({ params, set }) => {
          try {
            const pl = await db
              .select()
              .from(pledges)
              .where(eq(pledges.id, params.id))
              .get();
            if (!pl) {
              set.status = 404;
              return { error: "Pledge not found" };
            }
            // Create a contribution record for manual payment (to be confirmed via txHash later)
            const contribution = await db
              .insert(pledgeContributions)
              .values({
                pledgeId: pl.id,
                campaignId: pl.campaignId,
                token: pl.token,
                amount: pl.amountPerCadence,
              })
              .returning()
              .get();
            return contribution;
          } catch (error) {
            console.error("Error preparing pledge payment:", error);
            set.status = 500;
            return { error: "Failed to prepare pledge payment" };
          }
        },
        { params: t.Object({ id: t.String() }) }
      )

      // ================================
      // Donations
      // ================================
      .post(
        "/donations/record",
        async ({ body, set }) => {
          try {
            // This endpoint records a known donation by txHash; attribution/validation can be expanded
            const creatorAddressNormalized = getAddress(body.creatorAddress as `0x${string}`);
            const creator = await db
              .select()
              .from(users)
              .where(eq(users.evm_address, creatorAddressNormalized as `0x${string}`))
              .get();
            if (!creator) {
              set.status = 404;
              return { error: "Creator not found" };
            }

            // Prevent duplicate tx
            const tx = await db.select().from(txHashes).where(eq(txHashes.hash, body.txHash)).get();
            if (!tx) {
              await db.insert(txHashes).values({ hash: body.txHash });
            }

            const donation = await db
              .insert(donations)
              .values({
                creatorId: creator.id,
                payerUserId: body.payerUserId ?? null,
                fromAddress: body.fromAddress?.toLowerCase() ?? null,
                token: body.token,
                amount: body.amount,
                txHash: body.txHash,
                linkedInvoiceId: body.linkedInvoiceId ?? null,
              })
              .returning()
              .get();

            // normalized payment
            await db.insert(payments).values({
              type: "donation",
              sourceId: donation.id,
              creatorId: creator.id,
              payerUserId: donation.payerUserId ?? null,
              payerAddress: donation.fromAddress ?? null,
              token: donation.token,
              amount: donation.amount,
              status: "paid",
              txHash: donation.txHash ?? undefined,
              paidAt: Date.now(),
            });

            return donation;
          } catch (error) {
            console.error("Error recording donation:", error);
            set.status = 500;
            return { error: "Failed to record donation" };
          }
        },
        {
          body: t.Object({
            creatorAddress: t.TemplateLiteral("0x${string}"),
            payerUserId: t.Optional(t.String()),
            fromAddress: t.Optional(t.TemplateLiteral("0x${string}")),
            token: t.String(),
            amount: t.String(),
            txHash: t.TemplateLiteral("0x${string}"),
            linkedInvoiceId: t.Optional(t.String()),
          }),
        }
      )
      .get("/donations", async ({ currentUser, set }) => {
        try {
          const me = await db
            .select()
            .from(users)
            .where(eq(users.evm_address, currentUser!.walletAddress))
            .get();
          if (!me) {
            set.status = 404;
            return { error: "User not found" };
          }
          const list = await db
            .select()
            .from(donations)
            .where(eq(donations.creatorId, me.id));
          return list;
        } catch (error) {
          console.error("Error listing donations:", error);
          set.status = 500;
          return { error: "Failed to list donations" };
        }
      })

      // Payments listing (normalized)
      .get("/payments", async ({ currentUser, set }) => {
        try {
          const me = await db
            .select()
            .from(users)
            .where(eq(users.evm_address, currentUser!.walletAddress))
            .get();
          if (!me) {
            set.status = 404;
            return { error: "User not found" };
          }
          const asCreator = await db
            .select()
            .from(payments)
            .where(eq(payments.creatorId, me.id));
          const asPayer = await db
            .select()
            .from(payments)
            .where(eq(payments.payerUserId, me.id));
          return { asCreator, asPayer };
        } catch (error) {
          console.error("Error listing payments:", error);
          set.status = 500;
          return { error: "Failed to list payments" };
        }
      })
      
      // NEW: Get all addresses associated with the authenticated user
      .get("/user/addresses", async ({ currentUser, set }) => {
        try {
          const user = await db
            .select()
            .from(users)
            .where(eq(users.evm_address, currentUser!.walletAddress))
            .get();
          
          if (!user) {
            set.status = 404;
            return { error: "User not found" };
          }
          
          const addresses = await getUserAddresses(user.id);
          
          return {
            userId: user.id,
            personalAddress: addresses.personalAddress,
            pledgeWalletAddresses: addresses.pledgeWalletAddresses,
            totalAddresses: 1 + addresses.pledgeWalletAddresses.length, // personal + pledge wallet count
          };
        } catch (error) {
          console.error("Error fetching user addresses:", error);
          set.status = 500;
          return { error: "Failed to fetch user addresses" };
        }
      })

      // New endpoint for cached spot tokens data
      .get("/spot-tokens", async ({ set }) => {
        try {
          const wsClient = getWebSocketClient(IS_TESTNET);
          const spotTokensData = wsClient.getSpotTokensData();
          
          if (!spotTokensData) {
            set.status = 503;
            return { 
              error: "Spot tokens data not available", 
              message: "WebSocket client may not be connected or data not yet loaded" 
            };
          }
          
          return {
            success: true,
            data: {
              tokens: spotTokensData.tokens,
              mids: spotTokensData.mids,
              lastUpdated: spotTokensData.lastUpdated,
              source: spotTokensData.source,
              count: Object.keys(spotTokensData.tokens).length
            }
          };
        } catch (error) {
          console.error("Error fetching cached spot tokens:", error);
          set.status = 500;
          return { 
            error: "Failed to fetch cached spot tokens", 
            message: error instanceof Error ? error.message : "Unknown error" 
          };
        }
      })

      // WebSocket client status endpoint
      .get("/ws-status", async ({ set }) => {
        try {
          const wsClient = getWebSocketClient(IS_TESTNET);
          const status = wsClient.getStatus();
          
          return {
            success: true,
            data: status
          };
        } catch (error) {
          console.error("Error fetching WebSocket status:", error);
          set.status = 500;
          return { 
            error: "Failed to fetch WebSocket status", 
            message: error instanceof Error ? error.message : "Unknown error" 
          };
        }
      })
  );
