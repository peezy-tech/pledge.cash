import { useState } from "react"
import TokenMetadataStep from "@/components/token-metadata-step"
import TokenDistributionStep from "@/components/token-distribution-step"
import TokenReviewStep from "@/components/token-review-step"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ChevronLeft, ChevronRight } from "lucide-react"

export type TokenFormData = {
  tokenName: string
  tokenSymbol: string
  imagePreview: string | null
}

export default function TokenCreationPage() {
  const [currentStep, setCurrentStep] = useState(0)
  const [formData, setFormData] = useState<TokenFormData>({
    tokenName: "",
    tokenSymbol: "",
    imagePreview: null,
  })
  const [isDeploying, setIsDeploying] = useState(false)
  const [isDeployed, setIsDeployed] = useState(false)

  const totalSteps = 3

  const handleNext = () => {
    if (currentStep < totalSteps) {
      setCurrentStep(currentStep + 1)
    }
  }

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
    }
  }

  const updateFormData = (data: Partial<TokenFormData>) => {
    setFormData({ ...formData, ...data })
  }

  const handleDeploy = () => {
    setIsDeploying(true)
    // Mock deployment process
    setTimeout(() => {
      setIsDeploying(false)
      setIsDeployed(true)
    }, 2000)
  }

  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <h1 className="text-3xl font-bold mb-8 text-center">Create Your Token</h1>

      {/* Progress indicator */}
      <div className="mb-8">
        <div className="flex justify-between items-center">
          {[1, 2, 3].map((step) => (
            <div key={step} className="flex flex-col items-center">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  step === currentStep
                    ? "bg-blue-600 text-white"
                    : step < currentStep
                      ? "bg-green-500 text-white"
                      : "bg-gray-200 text-gray-600"
                }`}
              >
                {step < currentStep ? "✓" : step}
              </div>
              <span className="mt-2 text-sm">{step === 1 ? "Metadata" : step === 2 ? "Distribution" : "Review"}</span>
            </div>
          ))}
        </div>
        <div className="relative mt-2">
          <div className="absolute top-0 left-0 h-1 bg-gray-200 w-full"></div>
          <div
            className="absolute top-0 left-0 h-1 bg-blue-600 transition-all duration-300"
            style={{ width: `${((currentStep - 1) / (totalSteps - 1)) * 100}%` }}
          ></div>
        </div>
      </div>

      {/* Step content */}
      <Card className="p-6">
        {currentStep === 1 && <TokenMetadataStep formData={formData} updateFormData={updateFormData} />}
        {currentStep === 2 && <TokenDistributionStep />}
        {currentStep === 3 && (
          <TokenReviewStep
            formData={formData}
            onDeploy={handleDeploy}
            isDeploying={isDeploying}
            isDeployed={isDeployed}
          />
        )}

        {/* Navigation buttons */}
        {!isDeployed && (
          <div className="flex justify-between mt-8 pt-6 border-t">
            {currentStep > 1 ? (
              <Button
                variant="outline"
                onClick={handlePrevious}
                disabled={isDeploying}
                className="flex items-center gap-2 px-6"
                size="lg"
              >
                <ChevronLeft className="h-5 w-5" /> Return
              </Button>
            ) : (
              <div></div> // Empty div to maintain flex spacing
            )}

            {currentStep < totalSteps ? (
              <Button
                onClick={handleNext}
                disabled={(currentStep === 1 && (!formData.tokenName || !formData.tokenSymbol)) || isDeploying}
                className="flex items-center gap-2 px-6 bg-blue-600 hover:bg-blue-700"
                size="lg"
              >
                Next Step <ChevronRight className="h-5 w-5" />
              </Button>
            ) : (
              <Button
                onClick={handleDeploy}
                disabled={isDeploying || isDeployed}
                className="bg-green-600 hover:bg-green-700 px-6"
                size="lg"
              >
                {isDeploying ? "Deploying..." : "Deploy Token"}
              </Button>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}
