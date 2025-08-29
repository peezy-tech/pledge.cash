import * as hl from "@nktkas/hyperliquid";
import { db } from "@repo/db";
import {
  users,
  pledgeWalletAccounts,
  recurringPlans,
  recurringCharges,
  payments,
} from "@repo/db/schema";
import { eq } from "drizzle-orm";
import { privateKeyToAccount } from "viem/accounts";

const IS_TESTNET = true;

function addCadence(from: number, cadence: "daily" | "weekly" | "monthly"): number {
  const d = new Date(from);
  if (cadence === "daily") d.setDate(d.getDate() + 1);
  else if (cadence === "weekly") d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return d.getTime();
}

export function startPaymentsProcessor() {
  const transport = new hl.HttpTransport({ isTestnet: IS_TESTNET });
  const infoClient = new hl.InfoClient({ transport });

  async function processRecurring() {
    const now = Date.now();
    try {
      // Fetch due plans
      const duePlans = await db
        .select()
        .from(recurringPlans)
        // drizzle-lite: no lte helper imported; compare manually
        .all();

      const plans = duePlans.filter(
        (p) => p.status === "active" && p.nextRunAt <= now
      );
      for (const plan of plans) {
        try {
          const creator = await db
            .select()
            .from(users)
            .where(eq(users.id, plan.creatorId))
            .get();
          if (!creator) continue;

          const payer = plan.payerUserId
            ? await db
                .select()
                .from(users)
                .where(eq(users.id, plan.payerUserId))
                .get()
            : null;
          const pw = payer
            ? await db
                .select()
                .from(pledgeWalletAccounts)
                .where(eq(pledgeWalletAccounts.userAddress, payer.evm_address || ""))
                .get()
            : null;

          // Create charge record
          const charge = await db
            .insert(recurringCharges)
            .values({
              planId: plan.id,
              token: plan.token,
              amount: plan.amount,
              dueAt: now,
            })
            .returning()
            .get();

          if (plan.autopayEnabled && pw && payer) {
            try {
              const operatorAccount = privateKeyToAccount(
                pw.operatorPrivateKey as `0x${string}`
              );
              const multi = new hl.MultiSignClient({
                transport,
                multiSignAddress: pw.address as `0x${string}`,
                signatureChainId: `0x${(1337).toString(16)}` as `0x${string}`,
                signers: [
                  {
                    address: operatorAccount.address,
                    signTypedData: async (params: any) =>
                      operatorAccount.signTypedData(params),
                  },
                ],
                isTestnet: IS_TESTNET,
              });
              await multi.spotSend({
                destination: creator.evm_address as `0x${string}`,
                token: plan.token as `${string}:0x${string}`,
                amount: plan.amount,
              });

              await new Promise((r) => setTimeout(r, 2000));
              const details = await infoClient.userDetails({
                user: pw.address as `0x${string}`,
              });
              const tx = details
                .filter(
                  (tx: any) =>
                    tx.action.type === "spotSend" &&
                    tx.action.destination?.toLowerCase() ===
                      creator.evm_address?.toLowerCase() &&
                    tx.action.token === plan.token &&
                    tx.action.amount === plan.amount &&
                    tx.error === null
                )
                .sort((a: any, b: any) => b.time - a.time)[0];

              await db
                .update(recurringCharges)
                .set({ status: "paid", runAt: Date.now(), txHash: tx?.hash })
                .where(eq(recurringCharges.id, charge.id));

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
            } catch (e) {
              console.error("Recurring autopay failed:", e);
              await db
                .update(recurringCharges)
                .set({ status: "failed", runAt: Date.now(), error: String(e) })
                .where(eq(recurringCharges.id, charge.id));
            }
          }

          await db
            .update(recurringPlans)
            .set({ nextRunAt: addCadence(now, plan.cadence) })
            .where(eq(recurringPlans.id, plan.id));
        } catch (err) {
          console.error("Error processing plan:", plan.id, err);
        }
      }
    } catch (error) {
      console.error("Recurring processor error:", error);
    }
  }

  const interval = setInterval(processRecurring, 60_000);
  console.log("Payments processor started (recurring every 60s)");
  return () => clearInterval(interval);
}

