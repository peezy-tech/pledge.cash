import { AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function VestingSchedule() {
  // Generate vesting schedule data
  // Founders tokens: 1 year cliff, then linear vesting over 3 years
  // Treasury: 6 month cliff, then linear vesting over 2 years
  const vestingData = Array.from({ length: 49 }, (_, i) => {
    const month = i

    // Calculate founders vesting
    let foundersVested = 0
    if (month >= 12) {
      foundersVested = Math.min(20, ((month - 12) / 36) * 20)
    }

    // Calculate treasury vesting
    let treasuryVested = 0
    if (month >= 6) {
      treasuryVested = Math.min(20, ((month - 6) / 24) * 20)
    }

    // Liquidity is available from the start
    const liquidityVested = 60

    return {
      month: month,
      founders: foundersVested,
      treasury: treasuryVested,
      liquidity: liquidityVested,
      total: foundersVested + treasuryVested + liquidityVested,
    }
  })

  // Format month for display
  const formatMonth = (month: number) => {
    if (month === 0) return "Launch"
    if (month % 12 === 0) return `${month / 12}y`
    return ""
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Vesting Schedule</CardTitle>
        <CardDescription>Token release schedule over time</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={vestingData}
              margin={{
                top: 10,
                right: 30,
                left: 0,
                bottom: 0,
              }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="month"
                tickFormatter={formatMonth}
                label={{ value: "Months", position: "insideBottomRight", offset: -5 }}
              />
              <YAxis label={{ value: "% of Total Supply", angle: -90, position: "insideLeft" }} />
              <Area type="monotone" dataKey="total" stackId="1" stroke="#8884d8" fill="#8884d8" name="Total" />
              <Area type="monotone" dataKey="liquidity" stackId="2" stroke="#3b82f6" fill="#3b82f6" name="Liquidity" />
              <Area type="monotone" dataKey="founders" stackId="2" stroke="#10b981" fill="#10b981" name="Founders" />
              <Area type="monotone" dataKey="treasury" stackId="2" stroke="#f59e0b" fill="#f59e0b" name="Treasury" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-4 space-y-2">
          <p className="text-sm">
            <span className="font-medium">Liquidity:</span> 60% available at launch for trading
          </p>
          <p className="text-sm">
            <span className="font-medium">Founders:</span> 12-month cliff, then linear vesting over 36 months
          </p>
          <p className="text-sm">
            <span className="font-medium">Treasury:</span> 6-month cliff, then linear vesting over 24 months
          </p>
          <p className="text-sm mt-2 text-muted-foreground">
            Cliffs ensure long-term commitment from the team and sustainable project development
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
