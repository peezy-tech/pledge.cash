import { PieChart, Pie, Cell, ResponsiveContainer, Legend } from "recharts"

export default function TokenDistributionStep() {
  const data = [
    { name: "Liquidity", value: 60, color: "#3b82f6" },
    { name: "Founders", value: 20, color: "#10b981" },
    { name: "Treasury", value: 20, color: "#f59e0b" },
  ]

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Token Distribution</h2>
      <p className="text-gray-600 mb-6">
        This is how your token supply will be allocated. The distribution is designed to ensure liquidity, incentivize
        the team, and support long-term development.
      </p>

      <div className="h-[300px] w-full mb-6">
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

      <div className="space-y-4">
        <div className="p-4 border rounded-md">
          <h3 className="font-medium text-lg mb-2">Liquidity (60%)</h3>
          <p className="text-gray-600">
            Allocated to provide market liquidity, ensuring your token can be easily traded. This portion will be
            available immediately upon launch.
          </p>
        </div>

        <div className="p-4 border rounded-md">
          <h3 className="font-medium text-lg mb-2">Founders (20%)</h3>
          <p className="text-gray-600">
            Reserved for the founding team, subject to a 12-month cliff followed by linear vesting over 36 months. This
            ensures long-term commitment from the team.
          </p>
        </div>

        <div className="p-4 border rounded-md">
          <h3 className="font-medium text-lg mb-2">Treasury (20%)</h3>
          <p className="text-gray-600">
            Reserved for future development, marketing, and ecosystem growth. Subject to a 6-month cliff followed by
            linear vesting over 24 months to ensure sustainable project development.
          </p>
        </div>
      </div>
      <div className="mt-8 pt-4 border-t text-center text-sm text-gray-500">
        Review the token distribution and click "Next Step" to continue to the final review
      </div>
    </div>
  )
}
