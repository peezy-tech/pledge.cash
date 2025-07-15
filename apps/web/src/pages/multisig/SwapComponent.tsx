import { useState, useEffect } from 'react'
import { useMultisigClient } from '@/providers/MultisigProvider'
import { useHyperliquid } from '@/providers/HyperliquidProvider'
import { useSpotTokens, useHyperliquidSpotBalances } from '@/hooks/useHyperliquid'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { toast } from 'sonner'
import { ArrowUpDown, TrendingUp, AlertTriangle } from 'lucide-react'
import { TokenCombobox, type TokenOption } from '@/components/TokenCombobox'
import * as hl from '@nktkas/hyperliquid'

interface TokenPrice {
  token: string
  bid: string
  ask: string
  mid: string
}

interface SwapQuote {
  inputAmount: string
  outputAmount: string
  price: string
  slippage: number
  priceImpact: string
}

// Helper function to format price according to tick size rules for spot trading
function formatSpotPrice(price: number, szDecimals: number): string {
  const MAX_DECIMALS = 8
  const maxDecimalPlaces = MAX_DECIMALS - szDecimals

  // If price is an integer, return as is (integers are always allowed)
  if (Number.isInteger(price)) {
    return price.toString()
  }

  // Apply decimal places limit first
  let formattedPrice = price.toFixed(maxDecimalPlaces)

  // Count significant figures for additional validation
  const priceStr = price.toString()
  const significantFigures = priceStr
    .replace(/^0\.0*/, "")
    .replace(".", "").length

  // If we have more than 5 significant figures, we need to round more aggressively
  if (significantFigures > 5) {
    const decimalIndex = formattedPrice.indexOf(".")
    if (decimalIndex !== -1) {
      const integerPart = formattedPrice.substring(0, decimalIndex)
      const nonZeroIntegerDigits = integerPart.replace(/^0+/, "").length

      if (nonZeroIntegerDigits > 0) {
        const allowedDecimalDigits = Math.max(0, 5 - nonZeroIntegerDigits)
        const maxAllowedDecimals = Math.min(allowedDecimalDigits, maxDecimalPlaces)
        formattedPrice = price.toFixed(maxAllowedDecimals)
      } else {
        const match = formattedPrice.match(/^0\.0*([1-9])/)
        if (match) {
          const firstNonZeroIndex = formattedPrice.indexOf(match[1])
          const allowedDecimals = Math.min(firstNonZeroIndex - 1 + 5, maxDecimalPlaces)
          formattedPrice = price.toFixed(allowedDecimals)
        }
      }
    }
  }

  // Remove trailing zeros as required for signing
  formattedPrice = formattedPrice.replace(/\.?0+$/, "")
  return formattedPrice
}

// Helper function to format amount according to szDecimals
function formatSpotAmount(amount: string | number, szDecimals: number): string {
  const amountNum = typeof amount === 'string' ? parseFloat(amount) : amount
  
  if (isNaN(amountNum)) {
    throw new Error('Invalid amount provided')
  }

  // Format to szDecimals precision
  let formattedAmount = amountNum.toFixed(szDecimals)
  
  // Remove trailing zeros
  formattedAmount = formattedAmount.replace(/\.?0+$/, "")
  
  // If the result is empty or just a decimal point, return "0"
  if (formattedAmount === "" || formattedAmount === ".") {
    return "0"
  }
  
  return formattedAmount
}

export function SwapComponent() {
  const multisigClient = useMultisigClient()
  const { infoClient } = useHyperliquid()
  const { data: spotTokens } = useSpotTokens()
  const { data: multisigBalances } = useHyperliquidSpotBalances(multisigClient?.address as `0x${string}`)

  const [swapDirection, setSwapDirection] = useState<'token-to-usdc' | 'usdc-to-token'>('token-to-usdc')
  const [selectedToken, setSelectedToken] = useState('')
  const [inputAmount, setInputAmount] = useState('')
  const [slippage, setSlippage] = useState(0.5) // 0.5% default slippage
  const [isLoading, setIsLoading] = useState(false)
  const [prices, setPrices] = useState<Record<string, TokenPrice>>({})
  const [quote, setQuote] = useState<SwapQuote | null>(null)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [spotMeta, setSpotMeta] = useState<hl.SpotMeta | null>(null)

  // Get available tokens (exclude USDC) 
  const availableTokens = spotTokens ? Object.values(spotTokens).filter(token => token.name !== 'USDC') : []

  // Get current balances
  const balances = multisigBalances?.balances || []

  // Prepare token options for combobox
  const tokenOptions: TokenOption[] = availableTokens.map(token => ({
    name: token.name,
    balance: balances.find(b => b.coin === token.name)?.total || '0'
  }))
  const usdcBalance = balances.find(b => b.coin === 'USDC')
  const selectedTokenBalance = balances.find(b => b.coin === selectedToken)

  // Fetch market data
  useEffect(() => {
    const fetchMarketData = async () => {
      if (!infoClient || !selectedToken) return

      try {
        const [allMids, l2Book, meta] = await Promise.all([
          infoClient.allMids(),
          infoClient.l2Book({ coin: selectedToken }),
          infoClient.spotMeta()
        ])

        setSpotMeta(meta)

        const mid = allMids[selectedToken]
        if (mid && l2Book.levels[0]?.[0] && l2Book.levels[1]?.[0]) {
          setPrices(prev => ({
            ...prev,
            [selectedToken]: {
              token: selectedToken,
              bid: l2Book.levels[0][0].px,
              ask: l2Book.levels[1][0].px,
              mid: mid
            }
          }))
        }
      } catch (error) {
        console.error('Error fetching market data:', error)
        toast.error('Failed to fetch market data')
      }
    }

    fetchMarketData()
  }, [infoClient, selectedToken])

  // Calculate quote
  useEffect(() => {
    if (!inputAmount || !selectedToken || !prices[selectedToken] || !spotTokens) {
      setQuote(null)
      return
    }

    const price = prices[selectedToken]
    const inputAmountNum = parseFloat(inputAmount)
    
    if (isNaN(inputAmountNum) || inputAmountNum <= 0) {
      setQuote(null)
      return
    }

    try {
      let outputAmount: number
      let executionPrice: string
      
      if (swapDirection === 'token-to-usdc') {
        // Selling token for USDC, use bid price with slippage
        const bidPrice = parseFloat(price.bid)
        const adjustedPrice = bidPrice * (1 - slippage / 100)
        outputAmount = inputAmountNum * adjustedPrice
        executionPrice = adjustedPrice.toString()
      } else {
        // Buying token with USDC, use ask price with slippage
        const askPrice = parseFloat(price.ask)
        const adjustedPrice = askPrice * (1 + slippage / 100)
        outputAmount = inputAmountNum / adjustedPrice
        executionPrice = adjustedPrice.toString()
      }

      const midPrice = parseFloat(price.mid)
      const priceImpact = Math.abs((parseFloat(executionPrice) - midPrice) / midPrice * 100)

      // Apply formatting to show what will actually be executed
      const selectedTokenMeta = spotTokens[selectedToken]
      const usdcMeta = spotTokens['USDC']
      if (selectedTokenMeta && usdcMeta) {
        const formattedPrice = formatSpotPrice(parseFloat(executionPrice), selectedTokenMeta.szDecimals)
        
        if (swapDirection === 'token-to-usdc') {
          // Selling token for USDC: format token amount, keep USDC output as calculated
          const formattedTokenAmount = formatSpotAmount(inputAmount, selectedTokenMeta.szDecimals)
          const formattedUsdcAmount = formatSpotAmount(outputAmount, usdcMeta.szDecimals)
          
          setQuote({
            inputAmount: formattedTokenAmount,
            outputAmount: formattedUsdcAmount,
            price: formattedPrice,
            slippage,
            priceImpact: priceImpact.toFixed(2)
          })
        } else {
          // Buying token with USDC: format USDC input and token output
          const formattedUsdcAmount = formatSpotAmount(inputAmount, usdcMeta.szDecimals)
          const formattedTokenAmount = formatSpotAmount(outputAmount, selectedTokenMeta.szDecimals)
          
          setQuote({
            inputAmount: formattedUsdcAmount,
            outputAmount: formattedTokenAmount,
            price: formattedPrice,
            slippage,
            priceImpact: priceImpact.toFixed(2)
          })
        }
      } else {
        setQuote({
          inputAmount,
          outputAmount: outputAmount.toString(),
          price: executionPrice,
          slippage,
          priceImpact: priceImpact.toFixed(2)
        })
      }
    } catch (error) {
      console.error('Error calculating quote:', error)
      setQuote(null)
    }
  }, [inputAmount, selectedToken, prices, swapDirection, slippage, spotTokens])

  const handleSwapDirectionToggle = () => {
    setSwapDirection(prev => prev === 'token-to-usdc' ? 'usdc-to-token' : 'token-to-usdc')
    setInputAmount('')
    setQuote(null)
  }

  const validateSwap = () => {
    if (!inputAmount || !selectedToken || !quote) {
      toast.error('Please enter amount and select token')
      return false
    }

    const inputAmountNum = parseFloat(inputAmount)
    
    if (swapDirection === 'token-to-usdc') {
      const availableBalance = parseFloat(selectedTokenBalance?.total || '0')
      if (inputAmountNum > availableBalance) {
        toast.error(`Insufficient ${selectedToken} balance`)
        return false
      }
    } else {
      const availableBalance = parseFloat(usdcBalance?.total || '0')
      if (inputAmountNum > availableBalance) {
        toast.error('Insufficient USDC balance')
        return false
      }
    }

    return true
  }

  const executeSwap = async () => {
    if (!multisigClient || !quote || !spotMeta || !spotTokens) {
      toast.error('Missing required data')
      return
    }

    if (!validateSwap()) return

    setIsLoading(true)
    try {
      const { client, agentClient } = multisigClient
      const selectedTokenMeta = spotTokens[selectedToken]
      
      if (!selectedTokenMeta) {
        throw new Error('Token metadata not found')
      }

      // Find the spot market for this token
      const spotTokenMarket = spotMeta.universe.find(
        u => u.tokens[0] === selectedTokenMeta.index && u.tokens[1] === 0
      )

      if (!spotTokenMarket) {
        throw new Error('Spot market not found for token')
      }

      const isBuy = swapDirection === 'usdc-to-token'
      
      // Use the already formatted amounts and price from the quote
      const formattedAmount = swapDirection === 'token-to-usdc' ? quote.inputAmount : quote.outputAmount
      const formattedPrice = quote.price

      // Validate formatted amount
      if (parseFloat(formattedAmount) <= 0) {
        throw new Error(`Invalid formatted amount: ${formattedAmount}. Check token decimals and input amount.`)
      }

      const orderParams = {
        orders: [
          {
            a: 10000 + spotTokenMarket.index,
            b: isBuy,
            p: formattedPrice,
            s: formattedAmount,
            r: false,
            t: { limit: { tif: "FrontendMarket" as const } },
          },
        ],
        grouping: "na" as const,
      }

      console.log('Swap execution details:')
      console.log('  Token:', selectedToken)
      console.log('  Direction:', swapDirection)
      console.log('  Formatted amount:', formattedAmount)
      console.log('  Formatted price:', formattedPrice)
      console.log('  Token szDecimals:', selectedTokenMeta.szDecimals)
      console.log('  Order params:', orderParams)
      
      let result: hl.OrderResponse | null = null
      if(agentClient) {
        result = await agentClient.order(orderParams)
      } else {
        result = await client.order(orderParams)
      }
      console.log('Swap result:', result)

      toast.success(`Successfully ${swapDirection === 'token-to-usdc' ? 'sold' : 'bought'} ${selectedToken}`)
      
      // Reset form
      setInputAmount('')
      setQuote(null)
      setShowConfirmDialog(false)
      
    } catch (error) {
      console.error('Swap failed:', error)
      toast.error('Swap failed. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  if (!multisigClient) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowUpDown className="h-5 w-5" />
            Spot Token Swap
          </CardTitle>
          <CardDescription>
            No multisig wallet found. Create one to start trading.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArrowUpDown className="h-5 w-5" />
          Spot Token Swap
        </CardTitle>
        <CardDescription>
          Trade spot tokens to and from USDC with your multisig
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Swap Direction Toggle */}
        <div className="flex items-center justify-center">
          <Button
            variant="outline"
            onClick={handleSwapDirectionToggle}
            className="flex items-center gap-2"
          >
            <ArrowUpDown className="h-4 w-4" />
            {swapDirection === 'token-to-usdc' ? 'Sell Token for USDC' : 'Buy Token with USDC'}
          </Button>
        </div>

        {/* Token Selection */}
        <div className="space-y-2">
          <Label>Select Token</Label>
          <TokenCombobox
            tokens={tokenOptions}
            selectedToken={selectedToken}
            onTokenSelect={setSelectedToken}
            placeholder="Choose a token to trade"
          />
        </div>

        {/* Amount Input */}
        <div className="space-y-2">
          <Label>
            Amount ({swapDirection === 'token-to-usdc' ? selectedToken || 'Token' : 'USDC'})
          </Label>
          <div className="space-y-1">
            <Input
              type="number"
              placeholder="0.00"
              value={inputAmount}
              onChange={(e) => setInputAmount(e.target.value)}
              min="0"
              step="any"
            />
            <p className="text-sm text-muted-foreground">
              Available: {swapDirection === 'token-to-usdc' 
                ? selectedTokenBalance?.total || '0'
                : usdcBalance?.total || '0'
              } {swapDirection === 'token-to-usdc' ? selectedToken : 'USDC'}
            </p>
          </div>
        </div>

        {/* Slippage Setting */}
        <div className="space-y-2">
          <Label>Slippage Tolerance (%)</Label>
          <div className="flex gap-2">
            {[0.1, 0.5, 1.0, 2.0].map((value) => (
              <Button
                key={value}
                size="sm"
                variant={slippage === value ? "default" : "outline"}
                onClick={() => setSlippage(value)}
              >
                {value}%
              </Button>
            ))}
            <Input
              type="number"
              placeholder="Custom"
              value={slippage}
              onChange={(e) => setSlippage(parseFloat(e.target.value) || 0.5)}
              className="w-20"
              min="0"
              max="50"
              step="0.1"
            />
          </div>
        </div>

        {/* Market Info */}
        {selectedToken && prices[selectedToken] && (
          <div className="p-3 bg-muted rounded-lg space-y-2">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              <span className="font-medium">Market Price</span>
              <Badge variant="secondary">{selectedToken}/USDC</Badge>
            </div>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Bid:</span>
                <div className="font-mono">{prices[selectedToken].bid}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Mid:</span>
                <div className="font-mono">{prices[selectedToken].mid}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Ask:</span>
                <div className="font-mono">{prices[selectedToken].ask}</div>
              </div>
            </div>
          </div>
        )}

        {/* Quote Display */}
        {quote && (
          <div className="p-3 border rounded-lg space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium">Estimated Output:</span>
              <span className="font-mono text-lg">
                {parseFloat(quote.outputAmount).toFixed(6)} {swapDirection === 'token-to-usdc' ? 'USDC' : selectedToken}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Execution Price:</span>
              <span className="font-mono">{parseFloat(quote.price).toFixed(6)}</span>
            </div>
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Price Impact:</span>
              <span className={`font-mono ${parseFloat(quote.priceImpact) > 2 ? 'text-red-500' : 'text-green-500'}`}>
                {quote.priceImpact}%
              </span>
            </div>
            {parseFloat(quote.priceImpact) > 2 && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  High price impact detected. Consider reducing the trade size.
                </AlertDescription>
              </Alert>
            )}
            <p className="text-xs text-muted-foreground">
              * Amounts and prices are formatted according to {selectedToken} precision rules
            </p>
          </div>
        )}

        {/* Swap Button */}
        <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
          <DialogTrigger asChild>
            <Button 
              className="w-full" 
              disabled={!quote || !selectedToken || !inputAmount}
              size="lg"
            >
              {swapDirection === 'token-to-usdc' ? 'Sell' : 'Buy'} {selectedToken}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirm Swap</DialogTitle>
              <DialogDescription>
                Review your swap details before executing
              </DialogDescription>
            </DialogHeader>
            {quote && (
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>You're {swapDirection === 'token-to-usdc' ? 'selling' : 'buying'}</Label>
                  <p className="text-lg font-semibold">
                    {swapDirection === 'token-to-usdc' ? quote.inputAmount : quote.outputAmount} {selectedToken}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>You'll {swapDirection === 'token-to-usdc' ? 'receive' : 'pay'}</Label>
                  <p className="text-lg font-semibold">
                    {swapDirection === 'token-to-usdc' ? quote.outputAmount : quote.inputAmount} USDC
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Execution Price</Label>
                  <p className="font-mono">{parseFloat(quote.price).toFixed(6)} USDC per {selectedToken}</p>
                </div>
                <div className="space-y-2">
                  <Label>Slippage Tolerance</Label>
                  <p>{slippage}%</p>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowConfirmDialog(false)}>
                Cancel
              </Button>
              <Button onClick={executeSwap} disabled={isLoading}>
                {isLoading ? 'Executing...' : 'Confirm Swap'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
} 