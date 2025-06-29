import React, { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Alert, AlertDescription } from "./ui/alert";
import { Separator } from "./ui/separator";
import { useHyperliquidInvoices, useHyperliquidSpotBalances } from "../hooks/useHyperliquid";
import { CreateInvoiceForm } from "./CreateInvoiceForm";
import { InvoiceListItem } from "./InvoiceListItem";

export function InvoicesDashboard() {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const { data: invoicesData, isLoading: invoicesLoading, error: invoicesError } = useHyperliquidInvoices();
  const { data: balancesData, isLoading: balancesLoading } = useHyperliquidSpotBalances();

  const handleCreateSuccess = () => {
    setShowCreateForm(false);
  };

  const formatBalance = (balance: string) => {
    const num = parseFloat(balance);
    return num.toFixed(6).replace(/\.?0+$/, "");
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
  const balances = balancesData?.balances || [];

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
      <Card>
        <CardHeader>
          <CardTitle>Your Spot Balances</CardTitle>
          <CardDescription>Available tokens in your Hyperliquid account</CardDescription>
        </CardHeader>
        <CardContent>
          {balancesLoading ? (
            <p className="text-gray-500">Loading balances...</p>
          ) : balances.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {balances.map((balance, index) => (
                <div key={index} className="p-3 bg-gray-50 rounded-lg">
                  <p className="font-medium">{balance.coin}</p>
                  <p className="text-sm text-gray-600">{formatBalance(balance.total)}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500">No balances found</p>
          )}
        </CardContent>
      </Card>

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
                  creatorAddress={invoice.creatorAddress}
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