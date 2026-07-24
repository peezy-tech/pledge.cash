import { ArrowRight, RefreshCw } from "lucide-react";
import { formatUnits } from "viem";
import { StatusNotice, TechnicalDetails } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { shortAddress } from "../../lib/forms";
import { formatDecimalString } from "../../lib/token-amounts";
import type {
  HyperliquidMarketplaceOrder,
  HyperliquidMarketplaceQuote,
} from "../../lib/x402-router";

export type HyperliquidOutputMetadata = {
  decimals?: number | undefined;
  symbol?: string | undefined;
};

export function HyperliquidPaymentReview({
  error,
  open,
  order,
  output,
  paymentAttempted,
  pending,
  quote,
  onOpenChange,
  onPay,
}: {
  error: string | undefined;
  open: boolean;
  order: HyperliquidMarketplaceOrder | undefined;
  output: HyperliquidOutputMetadata;
  paymentAttempted: boolean;
  pending: boolean;
  quote: HyperliquidMarketplaceQuote;
  onOpenChange: (open: boolean) => void;
  onPay: () => void;
}): React.JSX.Element {
  const expired = Date.parse(quote.expiresAt) <= Date.now();
  const status = order?.status;
  const canPay = !expired && !paymentAttempted && !status;
  const sourceTotal = formatAtomic(
    quote.payment.amount,
    quote.payment.decimals,
    quote.payment.symbol,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] max-w-xl overflow-y-auto p-0">
        <div className="border-b border-zinc-800 px-5 py-4 pr-14">
          <DialogHeader className="text-left">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="default">HyperCore</Badge>
              <ArrowRight className="h-3.5 w-3.5 text-zinc-600" />
              <Badge variant="muted">HyperEVM testnet</Badge>
            </div>
            <DialogTitle className="pt-1">Review Hyperliquid payment</DialogTitle>
            <DialogDescription>
              Confirm the source transfer and the exact marketplace execution it authorizes.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-5">
          <dl className="m-0 divide-y divide-zinc-800">
            <ReviewRow
              label="Pay from HyperCore"
              value={sourceTotal}
              detail={`${formatAtomic(quote.payment.principal, quote.payment.decimals, "USDC")} principal`}
            />
            <ReviewRow
              label="Service fee"
              value={formatAtomic(
                quote.payment.serviceFee,
                quote.payment.decimals,
                "USDC",
              )}
              detail="Included in total payment"
            />
            <ReviewRow
              label="Expected receive"
              value={formatOutput(quote.execution.expectedOutput, output)}
              detail={`Minimum ${formatOutput(quote.execution.minimumOutput, output)}`}
            />
            <ReviewRow
              label="Recipient and refund"
              value={shortAddress(quote.recipient)}
              detail="The same connected wallet in v1"
            />
          </dl>

          <StatusNotice className="my-4" title="Payment settles before execution" tone="warning">
            Pledge’s router will execute this reviewed HyperEVM call after the
            HyperCore payment settles. If execution cannot complete, the order
            enters the refund path; keep the order ID until it reaches a terminal state.
          </StatusNotice>

          {error ? (
            <StatusNotice className="mb-4" title="Order needs attention" tone="danger">
              {error}
            </StatusNotice>
          ) : null}
          {order ? <OrderNotice order={order} /> : null}
          {!order && expired ? (
            <StatusNotice className="mb-4" title="Quote expired" tone="warning">
              Close this review and request a fresh Hyperliquid quote.
            </StatusNotice>
          ) : null}

          <TechnicalDetails summary="Execution commitment">
            <dl className="m-0 grid gap-3 text-xs">
              <TechnicalRow label="Order ID" value={quote.orderId} />
              <TechnicalRow label="Target" value={quote.execution.target} />
              <TechnicalRow label="Calldata hash" value={quote.execution.callDataHash} />
              <TechnicalRow
                label="Expires"
                value={formatExpiry(quote.expiresAt)}
              />
              <TechnicalRow label="Payment recipient" value={quote.payment.payTo} />
            </dl>
          </TechnicalDetails>
        </div>

        <DialogFooter className="border-t border-zinc-800 px-5 py-4">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            aria-busy={pending || undefined}
            disabled={!canPay || pending}
            type="button"
            onClick={onPay}
          >
            {pending ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
            {pending
              ? "Authorizing payment…"
              : paymentAttempted || status
                ? orderActionLabel(status)
                : `Approve ${sourceTotal}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewRow({
  detail,
  label,
  value,
}: {
  detail: string;
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-xs font-medium text-zinc-500">{label}</dt>
      <dd className="m-0 min-w-0 text-sm font-semibold text-zinc-100 sm:text-right">
        <span className="block break-words">{value}</span>
        <span className="mt-0.5 block text-xs font-normal text-zinc-500">{detail}</span>
      </dd>
    </div>
  );
}

function TechnicalRow({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div className="grid gap-1 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="m-0 break-all font-mono text-zinc-300">{value}</dd>
    </div>
  );
}

function OrderNotice({
  order,
}: {
  order: HyperliquidMarketplaceOrder;
}): React.JSX.Element {
  const tone = order.status === "executed"
    ? "success"
    : order.status === "manual_intervention"
      ? "danger"
      : order.status === "refunded" || order.status === "payment_failed"
        ? "warning"
        : "info";
  return (
    <StatusNotice
      className="mb-4"
      title={orderStatusTitle(order.status)}
      tone={tone}
    >
      {order.message ?? orderStatusDescription(order.status)}
      {order.executionTransaction ? (
        <span className="mt-1 block break-all font-mono text-xs">
          HyperEVM tx: {order.executionTransaction}
        </span>
      ) : null}
      {order.refundTransaction ? (
        <span className="mt-1 block break-all font-mono text-xs">
          Refund tx: {order.refundTransaction}
        </span>
      ) : null}
    </StatusNotice>
  );
}

function formatAtomic(
  value: string,
  decimals: number,
  symbol: string,
): string {
  return `${formatDecimalString(formatUnits(BigInt(value), decimals), {
    compact: false,
    maximumFractionDigits: decimals,
  })} ${symbol}`;
}

function formatOutput(
  value: string,
  metadata: HyperliquidOutputMetadata,
): string {
  if (metadata.decimals === undefined) {
    return `${value}${metadata.symbol ? ` ${metadata.symbol}` : " atomic units"}`;
  }
  return formatAtomic(value, metadata.decimals, metadata.symbol ?? "tokens");
}

function formatExpiry(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

function orderStatusTitle(status: HyperliquidMarketplaceOrder["status"]): string {
  if (status === "quoted") return "Payment not observed yet";
  if (status === "paid") return "Payment settled";
  if (status === "executing") return "HyperEVM execution in progress";
  if (status === "executed") return "Marketplace execution confirmed";
  if (status === "recovery_pending") return "Payment recovery in progress";
  if (status === "refund_pending") return "Refund in progress";
  if (status === "refunded") return "Payment refunded";
  if (status === "payment_failed") return "Payment not completed";
  return "Manual intervention required";
}

function orderStatusDescription(
  status: HyperliquidMarketplaceOrder["status"],
): string {
  if (status === "quoted") return "The router has not associated a settled payment with this order.";
  if (status === "paid") return "The router accepted the payment and queued the reviewed execution.";
  if (status === "executing") return "The reviewed call was submitted to HyperEVM.";
  if (status === "executed") return "The destination marketplace transaction completed.";
  if (status === "recovery_pending") return "The router is reconciling the created payment. Do not submit another payment.";
  if (status === "refund_pending") return "Execution could not complete and the router is returning the HyperCore payment.";
  if (status === "refunded") return "The HyperCore payment was returned.";
  if (status === "payment_failed") return "The router confirmed that no payment moved. Close this review and request a fresh quote.";
  return "Keep the order ID and contact the router operator before taking another payment action.";
}

function orderActionLabel(
  status: HyperliquidMarketplaceOrder["status"] | undefined,
): string {
  return status ? orderStatusTitle(status) : "Payment submitted";
}
