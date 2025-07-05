import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useCreateInvoiceMutation } from "@/hooks/useHyperliquid";
import { useAvailableTokens } from "./usePayInvoice";

interface CreateInvoiceFormProps {
  onSuccess?: () => void;
}

export function CreateInvoiceForm({ onSuccess }: CreateInvoiceFormProps) {
  const [payerAddress, setPayerAddress] = useState("");
  const [selectedToken, setSelectedToken] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const createInvoice = useCreateInvoiceMutation();
  const { tokens, isLoading: tokensLoading, fetchTokens } = useAvailableTokens();

  useEffect(() => {
    fetchTokens();
  }, []);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (payerAddress.trim() && !payerAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
      newErrors.payerAddress = "Invalid Ethereum address format";
    }

    if (!selectedToken) {
      newErrors.token = "Please select a token";
    }

    if (!amount.trim()) {
      newErrors.amount = "Amount is required";
    } else if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      newErrors.amount = "Amount must be a valid positive number";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    try {
      await createInvoice.mutateAsync({
        payerAddress: payerAddress.trim() ? payerAddress.toLowerCase() : undefined,
        token: selectedToken,
        amount: amount.trim(),
        description: description.trim() || undefined,
      });

      // Reset form
      setPayerAddress("");
      setSelectedToken("");
      setAmount("");
      setDescription("");
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
          Create a new invoice for payment via Hyperliquid
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {createInvoice.error && (
            <Alert variant="destructive">
              <AlertDescription>
                {createInvoice.error.message}
              </AlertDescription>
            </Alert>
          )}

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
            <p className="text-xs text-gray-500">
              If you leave this blank, anyone with the link can pay the invoice.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="token">Token</Label>
            <Select value={selectedToken} onValueChange={setSelectedToken}>
              <SelectTrigger className={errors.token ? "border-red-500" : ""}>
                <SelectValue placeholder="Select a token" />
              </SelectTrigger>
              <SelectContent>
                {tokensLoading ? (
                  <SelectItem value="loading" disabled>Loading tokens...</SelectItem>
                ) : (
                  tokens.map((token) => (
                    <SelectItem key={token.identifier} value={token.identifier}>
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

          <Button 
            type="submit" 
            className="w-full"
            disabled={createInvoice.isPending}
          >
            {createInvoice.isPending ? "Creating Invoice..." : "Create Invoice"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
} 