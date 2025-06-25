import { useReadContracts, useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi'
import { formatUnits, parseUnits } from 'viem'
import { useState } from 'react'

// ERC20 ABI for decimals and balance functions
const erc20Abi = [
  {
    type: 'function',
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', internalType: 'uint8', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'symbol',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'spender', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'transfer',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
] as const

// Helper function to format large numbers with abbreviations
const formatLargeNumber = (num: number) => {
  const abs = Math.abs(num)
  
  if (abs >= 1e12) {
    return (num / 1e12).toFixed(2).replace(/\.?0+$/, '') + 'T'
  } else if (abs >= 1e9) {
    return (num / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B'
  } else if (abs >= 1e6) {
    return (num / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M'
  } else if (abs >= 1e3) {
    return (num / 1e3).toFixed(2).replace(/\.?0+$/, '') + 'K'
  } else {
    return num.toString()
  }
}

// TokenBalances Component
export function TokenBalances({ currencyAddress, underlyingAddress }: { currencyAddress?: `0x${string}`; underlyingAddress?: `0x${string}` }) {
  const { address: userAddress } = useAccount()
  
  // State for token operations
  const [currencyApproveAmount, setCurrencyApproveAmount] = useState('')
  const [currencyApproveSpender, setCurrencyApproveSpender] = useState('')
  const [currencyTransferAmount, setCurrencyTransferAmount] = useState('')
  const [currencyTransferTo, setCurrencyTransferTo] = useState('')
  
  const [underlyingApproveAmount, setUnderlyingApproveAmount] = useState('')
  const [underlyingApproveSpender, setUnderlyingApproveSpender] = useState('')
  const [underlyingTransferAmount, setUnderlyingTransferAmount] = useState('')
  const [underlyingTransferTo, setUnderlyingTransferTo] = useState('')
  
  const [showCurrencyActions, setShowCurrencyActions] = useState(false)
  const [showUnderlyingActions, setShowUnderlyingActions] = useState(false)

  const { writeContract: writeTokenContract, data: tokenTxHash, error: tokenError, isPending: tokenPending } = useWriteContract()
  
  const { isLoading: isTokenConfirming, isSuccess: isTokenConfirmed } = 
    useWaitForTransactionReceipt({ 
      hash: tokenTxHash,
    })

  const { data: tokenData } = useReadContracts({
    contracts: [
      // Currency token data
      {
        address: currencyAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [userAddress as `0x${string}`],
      },
      {
        address: currencyAddress,
        abi: erc20Abi,
        functionName: 'decimals',
      },
      {
        address: currencyAddress,
        abi: erc20Abi,
        functionName: 'symbol',
      },
      // Underlying token data
      {
        address: underlyingAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [userAddress as `0x${string}`],
      },
      {
        address: underlyingAddress,
        abi: erc20Abi,
        functionName: 'decimals',
      },
      {
        address: underlyingAddress,
        abi: erc20Abi,
        functionName: 'symbol',
      },
    ],
    query: {
      enabled: !!(currencyAddress && underlyingAddress && userAddress),
    },
  })

  const formatBalance = (balance: bigint | undefined, decimals: number | undefined) => {
    if (!balance || decimals === undefined) return 'Loading...'
    
    const formatted = formatUnits(balance, decimals)
    const numericValue = parseFloat(formatted)
    
    // Format with abbreviations for large numbers
    const abbreviated = formatLargeNumber(numericValue)
    const full = numericValue.toString()
    
    // Show abbreviated version with full value on hover for large numbers
    if (numericValue >= 1000) {
      return (
        <span title={full} className="cursor-help">
          {abbreviated}
        </span>
      )
    }
    
    return full
  }

  // Token operation handlers
  const handleCurrencyApprove = () => {
    if (!currencyApproveAmount || !currencyApproveSpender || !tokenData?.[1]?.result) return
    
    const decimals = tokenData[1].result as number
    const amountInWei = parseUnits(currencyApproveAmount, decimals)
    
    writeTokenContract({
      address: currencyAddress as `0x${string}`,
      abi: erc20Abi,
      functionName: 'approve',
      args: [currencyApproveSpender as `0x${string}`, amountInWei],
    })
  }

  const handleCurrencyTransfer = () => {
    if (!currencyTransferAmount || !currencyTransferTo || !tokenData?.[1]?.result) return
    
    const decimals = tokenData[1].result as number
    const amountInWei = parseUnits(currencyTransferAmount, decimals)
    
    writeTokenContract({
      address: currencyAddress as `0x${string}`,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [currencyTransferTo as `0x${string}`, amountInWei],
    })
  }

  const handleUnderlyingApprove = () => {
    if (!underlyingApproveAmount || !underlyingApproveSpender || !tokenData?.[4]?.result) return
    
    const decimals = tokenData[4].result as number
    const amountInWei = parseUnits(underlyingApproveAmount, decimals)
    
    writeTokenContract({
      address: underlyingAddress as `0x${string}`,
      abi: erc20Abi,
      functionName: 'approve',
      args: [underlyingApproveSpender as `0x${string}`, amountInWei],
    })
  }

  const handleUnderlyingTransfer = () => {
    if (!underlyingTransferAmount || !underlyingTransferTo || !tokenData?.[4]?.result) return
    
    const decimals = tokenData[4].result as number
    const amountInWei = parseUnits(underlyingTransferAmount, decimals)
    
    writeTokenContract({
      address: underlyingAddress as `0x${string}`,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [underlyingTransferTo as `0x${string}`, amountInWei],
    })
  }

  if (!userAddress) {
    return (
      <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
        <div className="text-yellow-800 text-center">
          Please connect your wallet to view token balances
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
      <h4 className="font-semibold mb-3 text-green-800">Your Token Balances</h4>
      
      {/* Transaction Status */}
      {tokenTxHash && (
        <div className="mb-3 p-2 bg-blue-50 border border-blue-200 rounded">
          <div className="text-sm">
            <div>Transaction Hash: <span className="font-mono text-xs">{tokenTxHash}</span></div>
            {isTokenConfirming && <div className="text-blue-600">Confirming transaction...</div>}
            {isTokenConfirmed && <div className="text-green-600">Transaction confirmed!</div>}
          </div>
        </div>
      )}

      {tokenError && (
        <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded">
          <div className="text-red-700 text-sm">Error: {tokenError.message}</div>
        </div>
      )}
      
      <div className="space-y-3">
        {/* Currency Token */}
        <div className="bg-white rounded border">
          <div className="flex justify-between items-center p-2">
            <strong className="text-gray-700">
              Currency Token ({tokenData?.[2]?.result || 'Unknown'}):
            </strong>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm">
                {formatBalance(
                  tokenData?.[0]?.result as bigint,
                  tokenData?.[1]?.result as number
                )}
              </span>
              <button
                onClick={() => setShowCurrencyActions(!showCurrencyActions)}
                className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                {showCurrencyActions ? 'Hide' : 'Actions'}
              </button>
            </div>
          </div>
          
          {showCurrencyActions && (
            <div className="p-3 border-t bg-gray-50 space-y-3">
              {/* Approve */}
              <div>
                <h5 className="font-medium mb-2">Approve</h5>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    placeholder="Spender address"
                    value={currencyApproveSpender}
                    onChange={(e) => setCurrencyApproveSpender(e.target.value)}
                    className="flex-1 px-2 py-1 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Amount"
                    value={currencyApproveAmount}
                    onChange={(e) => setCurrencyApproveAmount(e.target.value)}
                    className="flex-1 px-2 py-1 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <button
                    onClick={handleCurrencyApprove}
                    disabled={tokenPending || !currencyApproveAmount || !currencyApproveSpender}
                    className="px-3 py-1 text-sm bg-yellow-600 text-white rounded hover:bg-yellow-700 disabled:opacity-50"
                  >
                    {tokenPending ? 'Pending...' : 'Approve'}
                  </button>
                </div>
              </div>
              
              {/* Transfer */}
              <div>
                <h5 className="font-medium mb-2">Transfer</h5>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    placeholder="Recipient address"
                    value={currencyTransferTo}
                    onChange={(e) => setCurrencyTransferTo(e.target.value)}
                    className="flex-1 px-2 py-1 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Amount"
                    value={currencyTransferAmount}
                    onChange={(e) => setCurrencyTransferAmount(e.target.value)}
                    className="flex-1 px-2 py-1 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <button
                    onClick={handleCurrencyTransfer}
                    disabled={tokenPending || !currencyTransferAmount || !currencyTransferTo}
                    className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                  >
                    {tokenPending ? 'Pending...' : 'Transfer'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Underlying Token */}
        <div className="bg-white rounded border">
          <div className="flex justify-between items-center p-2">
            <strong className="text-gray-700">
              Underlying Token ({tokenData?.[5]?.result || 'Unknown'}):
            </strong>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm">
                {formatBalance(
                  tokenData?.[3]?.result as bigint,
                  tokenData?.[4]?.result as number
                )}
              </span>
              <button
                onClick={() => setShowUnderlyingActions(!showUnderlyingActions)}
                className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                {showUnderlyingActions ? 'Hide' : 'Actions'}
              </button>
            </div>
          </div>
          
          {showUnderlyingActions && (
            <div className="p-3 border-t bg-gray-50 space-y-3">
              {/* Approve */}
              <div>
                <h5 className="font-medium mb-2">Approve</h5>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    placeholder="Spender address"
                    value={underlyingApproveSpender}
                    onChange={(e) => setUnderlyingApproveSpender(e.target.value)}
                    className="flex-1 px-2 py-1 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Amount"
                    value={underlyingApproveAmount}
                    onChange={(e) => setUnderlyingApproveAmount(e.target.value)}
                    className="flex-1 px-2 py-1 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <button
                    onClick={handleUnderlyingApprove}
                    disabled={tokenPending || !underlyingApproveAmount || !underlyingApproveSpender}
                    className="px-3 py-1 text-sm bg-yellow-600 text-white rounded hover:bg-yellow-700 disabled:opacity-50"
                  >
                    {tokenPending ? 'Pending...' : 'Approve'}
                  </button>
                </div>
              </div>
              
              {/* Transfer */}
              <div>
                <h5 className="font-medium mb-2">Transfer</h5>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    placeholder="Recipient address"
                    value={underlyingTransferTo}
                    onChange={(e) => setUnderlyingTransferTo(e.target.value)}
                    className="flex-1 px-2 py-1 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Amount"
                    value={underlyingTransferAmount}
                    onChange={(e) => setUnderlyingTransferAmount(e.target.value)}
                    className="flex-1 px-2 py-1 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <button
                    onClick={handleUnderlyingTransfer}
                    disabled={tokenPending || !underlyingTransferAmount || !underlyingTransferTo}
                    className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                  >
                    {tokenPending ? 'Pending...' : 'Transfer'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="mt-2 text-xs text-gray-600">
        Connected Address: <span className="font-mono">{userAddress}</span>
      </div>
    </div>
  )
} 