import { useState } from "react";
import { useAccount } from "wagmi";
import * as hl from "@nktkas/hyperliquid";
import { useConfirmPaymentMutation } from "./useHyperliquid";

interface Invoice {
  id: string;
  creatorId: string;
  payerAddress: string;
  token: string;
  amount: string;
  description?: string | null;
  status: "pending" | "paid" | "expired";
  txHash?: string | null;
  createdAt: number;
  paidAt?: number | null;
  expiresAt?: number | null;
}

export function usePayInvoice() {
  const { address } = useAccount();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmPayment = useConfirmPaymentMutation();

  const pay = async (invoice: Invoice, creatorAddress: string) => {
    if (!address) {
      throw new Error("Wallet not connected");
    }

    if (!window.ethereum) {
      throw new Error("Ethereum provider not available");
    }

    setIsLoading(true);
    setError(null);

    try {
      // Initialize Hyperliquid ExchangeClient with window.ethereum
      const transport = new hl.HttpTransport();
      const exchangeClient = new hl.ExchangeClient({
        wallet: window.ethereum,
        transport,
      });

      // Execute the spotSend transaction
      console.log(`Sending ${invoice.amount} ${invoice.token} to ${creatorAddress}`);
      
      // Record the timestamp before sending
      const sendTimestamp = Date.now();
      
      const result = await exchangeClient.spotSend({
        destination: creatorAddress as `0x${string}`,
        token: invoice.token as `${string}:0x${string}`,
        amount: invoice.amount,
      });

      console.log("Spot send result:", result);

      // The spotSend doesn't directly return a txHash, so we need to find it
      // by querying the user's recent transactions
      console.log("Waiting for transaction to be indexed...");
      await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3s

      // Get the user's recent transaction details to find the transaction hash
      const infoClient = new hl.InfoClient({ transport });
      const userDetails = await infoClient.userDetails({ user: address });

      console.log("User details fetched, looking for recent spotSend...");

      // Find the most recent spot send transaction that matches our criteria
      const spotSendTx = userDetails
        .filter(tx => 
          tx.action.type === 'spotSend' && 
          tx.time > sendTimestamp && // Transaction happened after we sent
          tx.action.destination.toLowerCase() === creatorAddress.toLowerCase() &&
          tx.action.token === invoice.token &&
          tx.action.amount === invoice.amount &&
          tx.error === null // Transaction was successful
        )
        .sort((a, b) => b.time - a.time)[0]; // Get the most recent one

      if (!spotSendTx || !spotSendTx.hash) {
        throw new Error("Could not find transaction hash. Please try again or verify manually.");
      }

      const txHash = spotSendTx.hash;
      console.log(`Found transaction hash: ${txHash}`);

      // Confirm the payment with our backend
      await confirmPayment.mutateAsync({ id: invoice.id, txHash });

      return { txHash };
    } catch (error) {
      console.error("Error paying invoice:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to pay invoice";
      setError(errorMessage);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  return {
    pay,
    isLoading,
    error,
    clearError: () => setError(null),
  };
}

// Utility hook to get available tokens for payment
export function useAvailableTokens() {
  const [tokens, setTokens] = useState<Array<{ name: string; tokenId: string; identifier: string }>>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchTokens = async () => {
    setIsLoading(true);
    try {
      const transport = new hl.HttpTransport();
      const infoClient = new hl.InfoClient({ transport });
      const spotMeta = await infoClient.spotMeta();
      
      const availableTokens = spotMeta.tokens.map(token => ({
        name: token.name,
        tokenId: token.tokenId,
        identifier: `${token.name}:${token.tokenId}`,
      }));
      
      setTokens(availableTokens);
    } catch (error) {
      console.error("Error fetching available tokens:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return {
    tokens,
    isLoading,
    fetchTokens,
  };
} 