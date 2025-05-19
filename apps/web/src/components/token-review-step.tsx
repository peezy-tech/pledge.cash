import { AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from "recharts"
import { Check, Loader2 } from "lucide-react"
// import Image from "next/image"
import type { TokenFormData } from "@/app/page"

interface TokenReviewStepProps {
  formData: TokenFormData
  onDeploy: () => void
  isDeploying: boolean
  isDeployed: boolean
}

export default function TokenReviewStep({ formData, onDeploy, isDeploying, isDeployed }: TokenReviewStepProps) {
  // Generate vesting schedule data
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
    <div>
      <h2 className="text-2xl font-bold mb-6">Review & Deploy</h2>

      {isDeployed ? (
        <div className="text-center py-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 mb-4">
            <Check className="h-8 w-8 text-green-600" />
          </div>
          <h3 className="text-xl font-bold mb-2">Token Successfully Deployed!</h3>
          <p className="text-gray-600 mb-4">
            Your token {formData.tokenName} ({formData.tokenSymbol}) has been successfully deployed to the blockchain.
          </p>
          <div className="p-4 bg-gray-50 rounded-md inline-block">
            <p className="font-mono text-sm">Token Address: 0x1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t</p>
          </div>
        </div>
      ) : (
        <>
          <p className="text-gray-600 mb-6">
            Review your token details before deployment. Once deployed, some properties cannot be changed.
          </p>

          <div className="grid md:grid-cols-2 gap-6 mb-8">
            <div className="space-y-4">
              <h3 className="font-medium text-lg">Token Information</h3>

              <div className="flex items-center gap-4 p-4 border rounded-md">
                {formData.imagePreview ? (
                  <div className="relative h-16 w-16 rounded-full overflow-hidden border">
                    {/* <Image
                      src={formData.imagePreview || "/placeholder.svg"}
                      alt="Token preview"
                      fill
                      className="object-cover"
                    /> */}
                  </div>
                ) : (
                  <div className="h-16 w-16 rounded-full bg-gray-200"></div>
                )}

                <div>
                  <h4 className="font-bold">{formData.tokenName || "Token Name"}</h4>
                  <p className="text-gray-600">{formData.tokenSymbol || "SYM"}</p>
                </div>
              </div>

              <div className="p-4 border rounded-md">
                <h4 className="font-medium mb-2">Distribution</h4>
                <ul className="space-y-1">
                  <li className="flex justify-between">
                    <span>Liquidity:</span>
                    <span className="font-medium">60%</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Founders:</span>
                    <span className="font-medium">20%</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Treasury:</span>
                    <span className="font-medium">20%</span>
                  </li>
                </ul>
              </div>
            </div>

            <div>
              <h3 className="font-medium text-lg mb-4">Vesting Schedule</h3>
              <div className="h-[200px] w-full">
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
                    <XAxis dataKey="month" tickFormatter={formatMonth} />
                    <YAxis />
                    <Area type="monotone" dataKey="total" stackId="1" stroke="#8884d8" fill="#8884d8" name="Total" />
                    <Area
                      type="monotone"
                      dataKey="liquidity"
                      stackId="2"
                      stroke="#3b82f6"
                      fill="#3b82f6"
                      name="Liquidity"
                    />
                    <Area
                      type="monotone"
                      dataKey="founders"
                      stackId="2"
                      stroke="#10b981"
                      fill="#10b981"
                      name="Founders"
                    />
                    <Area
                      type="monotone"
                      dataKey="treasury"
                      stackId="2"
                      stroke="#f59e0b"
                      fill="#f59e0b"
                      name="Treasury"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {isDeploying && (
            <div className="flex items-center justify-center p-4 bg-blue-50 rounded-md mb-6">
              <Loader2 className="h-5 w-5 text-blue-600 animate-spin mr-2" />
              <span>Deploying your token to the blockchain...</span>
            </div>
          )}
          <div className="mt-8 pt-4 border-t text-center text-sm text-gray-500">
            Review all information carefully before deploying your token
          </div>
        </>
      )}
    </div>
  )
}
