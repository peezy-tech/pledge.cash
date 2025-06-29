import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../utils/api";

// Hook to fetch user's spot balances
export function useHyperliquidSpotBalances() {
  return useQuery({
    queryKey: ["hyperliquid", "spot-balances"],
    queryFn: async () => {
      const response = await api.hyperliquid["spot-balances"].get();
      if (response.error) {
        throw new Error(response.error.value as string);
      }
      return response.data;
    },
  });
}

// Hook to fetch user's invoices
export function useHyperliquidInvoices() {
  return useQuery({
    queryKey: ["hyperliquid", "invoices"],
    queryFn: async () => {
      const response = await api.hyperliquid.invoices.get();
      if (response.error) {
        throw new Error(response.error.value as string);
      }
      return response.data;
    },
  });
}

// Hook to create a new invoice
export function useCreateInvoiceMutation() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (invoiceData: {
      payerAddress: string;
      token: string;
      amount: string;
      description?: string;
    }) => {
      const response = await api.hyperliquid.invoices.post(invoiceData);
      if (response.error) {
        throw new Error(response.error.value as string);
      }
      return response.data;
    },
    onSuccess: () => {
      // Invalidate and refetch invoices after creating a new one
      queryClient.invalidateQueries({ queryKey: ["hyperliquid", "invoices"] });
    },
  });
}

// Hook to confirm payment
export function useConfirmPaymentMutation() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, txHash }: { id: string; txHash: string }) => {
      const response = await api.hyperliquid.invoices[id].confirm.put({ txHash });
      if (response.error) {
        throw new Error(response.error.value as string);
      }
      return response.data;
    },
    onSuccess: () => {
      // Invalidate and refetch invoices after confirming payment
      queryClient.invalidateQueries({ queryKey: ["hyperliquid", "invoices"] });
    },
  });
} 