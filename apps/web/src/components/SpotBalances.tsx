import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useHyperliquidSpotBalances } from "@/hooks/useHyperliquid";

interface SpotBalancesProps {
  address?: `0x${string}`;
}

export function SpotBalances({ address }: SpotBalancesProps) {
  const { data: balancesData, isLoading: balancesLoading } = useHyperliquidSpotBalances(address);

  const formatBalance = (balance: string) => {
    const num = parseFloat(balance);
    return num.toFixed(6).replace(/\.?0+$/, "");
  };

  const balances = balancesData?.balances || [];

  return (
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
  );
} 