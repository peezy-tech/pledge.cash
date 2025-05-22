"use client"

import type React from "react"
import { useState, useEffect } from "react"
// import Image from "next/image"
import { Coins, Upload } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { TokenFormData } from "@/components/token-creation-page"

interface TokenMetadataStepProps {
  formData: TokenFormData
  updateFormData: (data: Partial<TokenFormData>) => void
}

export default function TokenMetadataStep({ formData, updateFormData }: TokenMetadataStepProps) {
  const [tokenName, setTokenName] = useState(formData.tokenName)
  const [tokenSymbol, setTokenSymbol] = useState(formData.tokenSymbol)
  const [imagePreview, setImagePreview] = useState<string | null>(formData.imagePreview)

  useEffect(() => {
    updateFormData({ tokenName, tokenSymbol, imagePreview })
  }, [tokenName, tokenSymbol, imagePreview, updateFormData])

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const files = e.target.files
      if (!files || files.length === 0) return

      const file = files[0]
      if (!file) return

      const reader = new FileReader()
      reader.onloadend = () => {
        if (typeof reader.result === "string") {
          setImagePreview(reader.result)
        }
      }
      reader.readAsDataURL(file)
    } catch (error) {
      console.error("Error handling image:", error)
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Token Metadata</h2>
      <p className="text-gray-600 mb-6">
        Enter the basic information about your token. This information will be stored on the blockchain.
      </p>

      <div className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="tokenName">Token Name</Label>
          <Input
            id="tokenName"
            placeholder="e.g. My Awesome Token"
            value={tokenName}
            onChange={(e) => setTokenName(e.target.value)}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="tokenSymbol">Token Symbol</Label>
          <Input
            id="tokenSymbol"
            placeholder="e.g. MAT"
            value={tokenSymbol}
            onChange={(e) => setTokenSymbol(e.target.value)}
            required
            maxLength={10}
          />
          <p className="text-xs text-muted-foreground">Maximum 10 characters, typically 3-4 uppercase letters</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="tokenImage">Token Image</Label>
          <div className="flex items-center gap-4">
            <div className="border rounded-md p-2 flex-1">
              <Label htmlFor="tokenImage" className="flex flex-col items-center gap-2 cursor-pointer py-4">
                <Upload className="h-8 w-8 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Click to upload image</span>
              </Label>
              <Input id="tokenImage" type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
            </div>

            {imagePreview ? (
              <div className="relative h-24 w-24 rounded-full overflow-hidden border">
                {/* <Image src={imagePreview || "/placeholder.svg"} alt="Token preview" fill className="object-cover" /> */}
              </div>
            ) : (
              <div className="h-24 w-24 rounded-full bg-muted flex items-center justify-center">
                <Coins className="h-10 w-10 text-muted-foreground" />
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="mt-8 pt-4 border-t text-center text-sm text-gray-500">
        Fill in the required information and click "Next Step" to continue
      </div>
    </div>
  )
}
