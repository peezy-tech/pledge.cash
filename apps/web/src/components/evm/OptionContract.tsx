import { useReadContracts } from 'wagmi'
import { formatUnits } from 'viem'

import { optionAbi, optionAddress } from 'evm/contracts'

const optionContract = {
  address: optionAddress[9999],
  abi: optionAbi,
}

// ERC20 ABI for decimals function
const erc20Abi = [
  {
    type: 'function',
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', internalType: 'uint8', type: 'uint8' }],
    stateMutability: 'view',
  },
] as const

const functions = [
  "amount",
  "strikePrice",
  "expiry",
  "owner",
  "holder",
  "currency",
  "underlying",
  "exercisedAmount",
  "originalAmount",
  "vestingCliff",
  "vestingEnd",
  "vestingHaltTimestamp",
  "vestingIsHalted",
]

export default function OptionContract() {
  const { data: option } = useReadContracts({
    contracts: functions.map((f) => ({
      ...optionContract,
      functionName: f,
    })),
  })

  // Get token decimals for proper formatting
  const { data: tokenDecimals } = useReadContracts({
    contracts: [
      {
        address: option?.[5]?.result as `0x${string}`, // currency address
        abi: erc20Abi,
        functionName: 'decimals',
      },
      {
        address: option?.[6]?.result as `0x${string}`, // underlying address
        abi: erc20Abi,
        functionName: 'decimals',
      },
    ],
    query: {
      enabled: !!(option?.[5]?.result && option?.[6]?.result),
    },
  })

  console.log(option, tokenDecimals)

  const formatTimestamp = (timestamp: bigint | number) => {
    const date = new Date(Number(timestamp) * 1000)
    const now = new Date()
    const diffMs = date.getTime() - now.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffMinutes = Math.floor(diffMs / (1000 * 60))

    let relativeTime = ''
    if (Math.abs(diffDays) >= 1) {
      relativeTime = diffDays > 0 ? `in ${diffDays} days` : `${Math.abs(diffDays)} days ago`
    } else if (Math.abs(diffHours) >= 1) {
      relativeTime = diffHours > 0 ? `in ${diffHours} hours` : `${Math.abs(diffHours)} hours ago`
    } else if (Math.abs(diffMinutes) >= 1) {
      relativeTime = diffMinutes > 0 ? `in ${diffMinutes} minutes` : `${Math.abs(diffMinutes)} minutes ago`
    } else {
      relativeTime = 'now'
    }

    return (
      <div className="text-right">
        <div className="font-mono text-sm">{date.toLocaleDateString()} {date.toLocaleTimeString()}</div>
        <div className="text-xs text-gray-500">{relativeTime}</div>
      </div>
    )
  }

  const formatTokenAmount = (amount: bigint | number, isStrikePrice = false) => {
    const currencyDecimals = tokenDecimals?.[0]?.result as number
    const underlyingDecimals = tokenDecimals?.[1]?.result as number
    
    if (!currencyDecimals || !underlyingDecimals) {
      return String(amount)
    }

    // Strike price is typically in currency units per underlying token
    const decimals = isStrikePrice ? currencyDecimals : underlyingDecimals
    const formatted = formatUnits(BigInt(amount), decimals)
    
    // Remove trailing zeros and unnecessary decimal point
    const cleaned = parseFloat(formatted).toString()
    return cleaned
  }

  const formatValue = (value: any, functionName: string) => {
    if (value === undefined || value === null) return 'Loading...'
    
    // Handle timestamp values
    if (functionName === 'expiry' || functionName === 'vestingCliff' || 
        functionName === 'vestingEnd' || functionName === 'vestingHaltTimestamp') {
      if (Number(value) === 0) return 'Not set'
      return formatTimestamp(value)
    }
    
    // Handle boolean values
    if (functionName === 'vestingIsHalted') {
      return value ? 'Yes' : 'No'
    }
    
    // Handle token amounts
    if (functionName === 'amount' || functionName === 'originalAmount' || 
        functionName === 'exercisedAmount' || functionName === 'strikePrice') {
      if (Number(value) === 0) return '0'
      return formatTokenAmount(value, functionName === 'strikePrice')
    }
    
    // Handle address values
    if (functionName === 'owner' || functionName === 'holder' || 
        functionName === 'currency' || functionName === 'underlying') {
      return (
        <span className="font-mono text-xs break-all">
          {String(value)}
        </span>
      )
    }
    
    // Handle other numeric values
    return String(value)
  }

  return (
    <div className="space-y-3">
      <h2 className="text-xl font-bold mb-4">Option Contract Details</h2>
      {option?.map((o, i) => (
        <div key={functions[i]} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg border">
          <strong className="capitalize text-gray-700 min-w-0 flex-shrink-0 mr-4">
            {functions[i].replace(/([A-Z])/g, ' $1').trim()}:
          </strong>
          <div className="text-right min-w-0 flex-1">
            {formatValue(o?.result, functions[i])}
          </div>
        </div>
      ))}
    </div>
  )
}
