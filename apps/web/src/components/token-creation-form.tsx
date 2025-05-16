import type React from "react"

import { useState } from "react"
import Image from "next/image"
import { Coins, Upload } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function TokenCreationForm() {
  const [tokenName, setTokenName] = useState("")
  const [tokenSymbol, setTokenSymbol] = useState("")
  const [imagePreview, setImagePreview] = useState<string | null>(null)

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Here you would handle the token creation logic
    console.log({ tokenName, tokenSymbol, imagePreview })
    alert("Token creation submitted!")
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Coins className="h-5 w-5" />
          Token Metadata
        </CardTitle>
        <CardDescription>Enter the details for your new token</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
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
                <Input
                  id="tokenImage"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleImageChange}
                  required
                />
              </div>

              {imagePreview ? (
                <div className="relative h-24 w-24 rounded-full overflow-hidden border">
                  <Image src={imagePreview || "/placeholder.svg"} alt="Token preview" fill className="object-cover" />
                </div>
              ) : (
                <div className="h-24 w-24 rounded-full bg-muted flex items-center justify-center">
                  <Coins className="h-10 w-10 text-muted-foreground" />
                </div>
              )}
            </div>
          </div>
        </CardContent>

        <CardFooter>
          <Button type="submit" className="w-full">
            Create Token
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
