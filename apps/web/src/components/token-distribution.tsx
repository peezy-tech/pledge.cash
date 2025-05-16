import { PieChart, Pie, Cell, ResponsiveContainer, Legend } from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function TokenDistribution() {
  const data = [
    { name: "Liquidity", value: 60, color: "#3b82f6" },
    { name: "Founders", value: 20, color: "#10b981" },
    { name: "Treasury", value: 20, color: "#f59e0b" },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Token Distribution</CardTitle>
        <CardDescription>How your token supply will be allocated</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                labelLine={false}
                outerRadius={100}
                fill="#8884d8"
                dataKey="value"
                label={({ name, percent }) => (name && percent ? `${name} ${(percent * 100).toFixed(0)}%` : "")}
              >
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-4 space-y-2">
          <p className="text-sm">
            <span className="font-medium">Liquidity (60%):</span> Allocated to provide market liquidity, ensuring your
            token can be easily traded.
          </p>
          <p className="text-sm">
            <span className="font-medium">Founders (20%):</span> Reserved for the founding team, subject to vesting
            periods to ensure long-term commitment.
          </p>
          <p className="text-sm">
            <span className="font-medium">Treasury (20%):</span> Reserved for future development, marketing, and
            ecosystem growth.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
