import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

import { useHyperliquidInvoices } from "@/hooks/useHyperliquid";
import { CreateInvoiceForm } from "./CreateInvoiceForm";
import { InvoiceListItem } from "./InvoiceListItem";
import { SpotBalances } from "@/components/SpotBalances";
import { useAccount } from "wagmi";


export function InvoicesDashboard() {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const { address } = useAccount();
  const { data: invoicesData, isLoading: invoicesLoading, error: invoicesError } = useHyperliquidInvoices();

  const handleCreateSuccess = () => {
    setShowCreateForm(false);
  };

  if (invoicesLoading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <p className="text-gray-500">Loading invoices...</p>
      </div>
    );
  }

  if (invoicesError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Failed to load invoices: {invoicesError.message}
        </AlertDescription>
      </Alert>
    );
  }

  const createdInvoices = invoicesData?.created || [];
  const receivedInvoices = invoicesData?.received || [];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Hyperliquid Invoices</h1>
          <p className="text-gray-600 mt-1">
            Create and manage invoices for Hyperliquid payments
          </p>
        </div>
        <Button 
          onClick={() => setShowCreateForm(!showCreateForm)}
          variant={showCreateForm ? "outline" : "default"}
        >
          {showCreateForm ? "Cancel" : "Create Invoice"}
        </Button>
      </div>

      {/* Spot Balances */}
      <SpotBalances address={address} />

      {/* Create Invoice Form */}
      {showCreateForm && (
        <CreateInvoiceForm onSuccess={handleCreateSuccess} />
      )}

      <div className="grid lg:grid-cols-2 gap-8">
        {/* Created Invoices */}
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-semibold">Invoices Created</h2>
            <p className="text-gray-600">Invoices you've sent to others</p>
          </div>
          
          {createdInvoices.length > 0 ? (
            <div className="space-y-4">
              {createdInvoices.map((invoice) => (
                <InvoiceListItem 
                  key={invoice.id} 
                  invoice={invoice} 
                  type="created"
                />
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="flex items-center justify-center py-12">
                <div className="text-center">
                  <p className="text-gray-500 mb-4">No invoices created yet</p>
                  <Button 
                    onClick={() => setShowCreateForm(true)}
                    variant="outline"
                  >
                    Create Your First Invoice
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Received Invoices */}
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-semibold">Invoices Received</h2>
            <p className="text-gray-600">Invoices sent to you for payment</p>
          </div>
          
          {receivedInvoices.length > 0 ? (
            <div className="space-y-4">
              {receivedInvoices.map((invoice) => (
                <InvoiceListItem 
                  key={invoice.id} 
                  invoice={invoice} 
                  type="received"
                />
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="flex items-center justify-center py-12">
                <div className="text-center">
                  <p className="text-gray-500">No invoices received yet</p>
                  <p className="text-sm text-gray-400 mt-2">
                    Invoices sent to your address will appear here
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
} 