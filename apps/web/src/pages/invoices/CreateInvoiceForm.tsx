import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useCreateInvoiceMutation } from "@/hooks/useHyperliquid";
import { useAvailableTokens } from "./usePayInvoice";
import { Trash2 } from "lucide-react";

interface CreateInvoiceFormProps {
  onSuccess?: () => void;
}

type Hook = {
  id: number;
  event: "invoice.paid" | "invoice.created";
  type: "discord" | "webhook";
  url: string;
};

export function CreateInvoiceForm({ onSuccess }: CreateInvoiceFormProps) {
  const [payerAddress, setPayerAddress] = useState("");
  const [selectedToken, setSelectedToken] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [errors, setErrors] = useState<Record<string, any>>({});

  const createInvoice = useCreateInvoiceMutation();
  const {
    tokens,
    isLoading: tokensLoading,
    fetchTokens,
  } = useAvailableTokens();

  useEffect(() => {
    fetchTokens();
  }, []);

  const validateForm = () => {
    const newErrors: Record<string, any> = { hooks: [] };

    if (payerAddress.trim() && !payerAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
      newErrors.payerAddress = "Invalid Ethereum address format";
    }
    if (!selectedToken) newErrors.token = "Please select a token";
    if (!amount.trim()) newErrors.amount = "Amount is required";
    else if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      newErrors.amount = "Amount must be a valid positive number";
    }

    hooks.forEach((hook, index) => {
      if (!hook.url.trim()) {
        if (!newErrors.hooks[index]) newErrors.hooks[index] = {};
        newErrors.hooks[index].url = "URL is required.";
      }
      try {
        new URL(hook.url);
      } catch (_) {
        if (!newErrors.hooks[index]) newErrors.hooks[index] = {};
        newErrors.hooks[index].url = "Invalid URL format.";
      }
    });

    setErrors(newErrors);
    // Check if any error messages exist
    return (
      Object.keys(newErrors).length === 1 && newErrors.hooks.length === 0
    );
  };

  const handleAddHook = () => {
    setHooks([
      ...hooks,
      {
        id: Date.now(),
        event: "invoice.paid",
        type: "webhook",
        url: "",
      },
    ]);
  };

  const handleRemoveHook = (id: number) => {
    setHooks(hooks.filter((hook) => hook.id !== id));
  };

  const handleHookChange = (
    id: number,
    field: keyof Hook,
    value: string
  ) => {
    setHooks(
      hooks.map((hook) =>
        hook.id === id ? { ...hook, [field]: value } : hook
      )
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    try {
      const finalHooks = hooks.map(({ id, ...rest }) => rest);
      await createInvoice.mutateAsync({
        payerAddress: payerAddress.trim()
          ? payerAddress.toLowerCase()
          : undefined,
        token: selectedToken,
        amount: amount.trim(),
        description: description.trim() || undefined,
        hooks: finalHooks,
      });

      // Reset form
      setPayerAddress("");
      setSelectedToken("");
      setAmount("");
      setDescription("");
      setHooks([]);
      setErrors({});
      onSuccess?.();
    } catch (error) {
      console.error("Error creating invoice:", error);
    }
  };

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>Create Invoice</CardTitle>
        <CardDescription>
          Create a new invoice for payment via Hyperliquid. Add hooks to trigger
          actions on payment events.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {createInvoice.error && (
            <Alert variant="destructive">
              <AlertDescription>{createInvoice.error.message}</AlertDescription>
            </Alert>
          )}

          {/* Core Invoice Fields */}
          <div className="space-y-2">
            <Label htmlFor="payerAddress">Payer Address (Optional)</Label>
            <Input
              id="payerAddress"
              type="text"
              placeholder="0x... (leave blank for a shareable link)"
              value={payerAddress}
              onChange={(e) => setPayerAddress(e.target.value)}
              className={errors.payerAddress ? "border-red-500" : ""}
            />
            {errors.payerAddress && (
              <p className="text-sm text-red-500">{errors.payerAddress}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="token">Token</Label>
              <Select value={selectedToken} onValueChange={setSelectedToken}>
                <SelectTrigger className={errors.token ? "border-red-500" : ""}>
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  {tokensLoading ? (
                    <SelectItem value="loading" disabled>
                      Loading...
                    </SelectItem>
                  ) : (
                    tokens.map((token) => (
                      <SelectItem
                        key={token.identifier}
                        value={token.identifier}
                      >
                        {token.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {errors.token && (
                <p className="text-sm text-red-500">{errors.token}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="amount">Amount</Label>
              <Input
                id="amount"
                type="number"
                step="any"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={errors.amount ? "border-red-500" : ""}
              />
              {errors.amount && (
                <p className="text-sm text-red-500">{errors.amount}</p>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description (Optional)</Label>
            <Input
              id="description"
              type="text"
              placeholder="What is this invoice for?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Hooks Section */}
          <div className="space-y-4 rounded-md border p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-medium">Hooks</h3>
                <p className="text-sm text-muted-foreground">
                  Trigger actions when invoice events occur.
                </p>
              </div>
              <Button type="button" variant="outline" onClick={handleAddHook}>
                Add Hook
              </Button>
            </div>

            {hooks.map((hook, index) => (
              <div
                key={hook.id}
                className="space-y-3 rounded-lg border bg-background p-3"
              >
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Event</Label>
                    <Select
                      value={hook.event}
                      onValueChange={(value) =>
                        handleHookChange(hook.id, "event", value)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="invoice.paid">Invoice Paid</SelectItem>
                        <SelectItem value="invoice.created">
                          Invoice Created
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Type</Label>
                    <Select
                      value={hook.type}
                      onValueChange={(value) =>
                        handleHookChange(hook.id, "type", value)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="webhook">Generic Webhook</SelectItem>
                        <SelectItem value="discord">Discord Webhook</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="ml-auto"
                      onClick={() => handleRemoveHook(hook.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>URL</Label>
                  <Input
                    type="url"
                    placeholder="https://example.com/webhook"
                    value={hook.url}
                    onChange={(e) =>
                      handleHookChange(hook.id, "url", e.target.value)
                    }
                    className={errors.hooks?.[index]?.url ? "border-red-500" : ""}
                  />
                  {errors.hooks?.[index]?.url && (
                    <p className="text-sm text-red-500">
                      {errors.hooks[index].url}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>

          <Button type="submit" className="w-full" disabled={createInvoice.isPending}>
            {createInvoice.isPending ? "Creating Invoice..." : "Create Invoice"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
} 