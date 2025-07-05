import { db } from "@repo/db";
import { hyperliquidInvoices, invoiceHooks, users } from "@repo/db/schema";
import { eq, and } from "drizzle-orm";

type InvoiceWithRelations = Awaited<ReturnType<typeof getInvoice>>;

async function getInvoice(invoiceId: string) {
  const res = await db
    .select()
    .from(hyperliquidInvoices)
    .leftJoin(users, eq(hyperliquidInvoices.creatorId, users.id))
    .where(eq(hyperliquidInvoices.id, invoiceId))
    .get();

  return {
    ...res?.hyperliquid_invoices,
    creator: res?.users,
  };
}

export async function executeHooks(event: "invoice.paid", invoiceId: string) {
  const invoice = await getInvoice(invoiceId);
  if (!invoice) {
    console.error(`executeHooks: Invoice ${invoiceId} not found.`);
    return;
  }

  const hooks = await db
    .select()
    .from(invoiceHooks)
    .where(
      and(eq(invoiceHooks.invoiceId, invoiceId), eq(invoiceHooks.event, event))
    );

  if (hooks.length === 0) {
    return;
  }

  console.log(
    `Executing ${hooks.length} hook(s) for event '${event}' on invoice ${invoiceId}`
  );

  for (const hook of hooks) {
    try {
      switch (hook.type) {
        case "discord":
          await executeDiscordWebhook(hook, invoice);
          break;
        case "webhook":
          await executeGenericWebhook(hook, invoice);
          break;
        default:
          console.warn(`Unknown hook type: ${hook.type}`);
      }
    } catch (error) {
      console.error(`Failed to execute hook ${hook.id}:`, error);
    }
  }
}

async function executeGenericWebhook(
  hook: typeof invoiceHooks.$inferSelect,
  invoice: InvoiceWithRelations
) {
  console.log(`Executing generic webhook for hook ${hook.id} to ${hook.url}`);

  const payload = {
    eventId: `evt_${Date.now()}`,
    eventType: hook.event,
    invoice,
  };

  const response = await fetch(hook.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Webhook failed with status ${response.status}: ${errorBody}`
    );
  }

  console.log(`Generic webhook for hook ${hook.id} sent successfully.`);
}

async function executeDiscordWebhook(
  hook: typeof invoiceHooks.$inferSelect,
  invoice: InvoiceWithRelations
) {
  console.log(`Executing Discord webhook for hook ${hook.id} to ${hook.url}`);

  if (!invoice.paidAt || !invoice.payerAddress || !invoice.txHash) {
    console.error(
      `Cannot send Discord webhook for unpaid invoice ${invoice.id}.`
    );
    return;
  }

  const tokenName = invoice.token.split(":")[0];
  const IS_TESTNET = process.env.NODE_ENV !== "production"; // A simple way to check
  const explorerUrl = `${IS_TESTNET ? "https://testnet.hyperliquid.xyz" : "https://app.hyperliquid.xyz"}/tx/${invoice.txHash}`;

  const discordPayload = {
    embeds: [
      {
        title: "Invoice Paid",
        description: `Invoice \`${invoice.id}\` has been successfully paid.`,
        color: 5763719, // Green
        fields: [
          {
            name: "Amount",
            value: `\`${invoice.amount} ${tokenName}\``,
            inline: true,
          },
          {
            name: "Description",
            value: invoice.description || "N/A",
            inline: true,
          },
          {
            name: "Payer",
            value: `\`${invoice.payerAddress}\``,
            inline: false,
          },
          {
            name: "Transaction",
            value: `[View on Hyperliquid](${explorerUrl})`,
            inline: false,
          },
        ],
        timestamp: new Date(invoice.paidAt).toISOString(),
        footer: { text: "pledge.cash Invoicing" },
      },
    ],
  };

  const response = await fetch(hook.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(discordPayload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Discord webhook failed with status ${response.status}: ${errorBody}`
    );
  }

  console.log(`Discord webhook for hook ${hook.id} sent successfully.`);
}
