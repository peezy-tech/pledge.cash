import { useReadContracts, useWriteContract, useWaitForTransactionReceipt, useAccount, useTransaction } from 'wagmi'
import { formatUnits, parseUnits } from 'viem'
import { useState } from 'react'

import { optionAbi, optionAddress } from 'evm/contracts'

const optionContract = {
  address: optionAddress[9999],
  abi: optionAbi,
}

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

// TokenBalances Component
function TokenBalances({ currencyAddress, underlyingAddress }: { currencyAddress?: string; underlyingAddress?: string }) {
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
        address: currencyAddress as `0x${string}`,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [userAddress as `0x${string}`],
      },
      {
        address: currencyAddress as `0x${string}`,
        abi: erc20Abi,
        functionName: 'decimals',
      },
      {
        address: currencyAddress as `0x${string}`,
        abi: erc20Abi,
        functionName: 'symbol',
      },
      // Underlying token data
      {
        address: underlyingAddress as `0x${string}`,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [userAddress as `0x${string}`],
      },
      {
        address: underlyingAddress as `0x${string}`,
        abi: erc20Abi,
        functionName: 'decimals',
      },
      {
        address: underlyingAddress as `0x${string}`,
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

// TransactionInspector Component
function TransactionInspector() {
  const [txHash, setTxHash] = useState('')
  const [inspectHash, setInspectHash] = useState('')

  const { data: txReceipt, isLoading: receiptLoading, error: receiptError } = useWaitForTransactionReceipt({
    hash: inspectHash as `0x${string}`,
    query: {
      enabled: !!inspectHash,
    },
  })

  const { data: txData, isLoading: txLoading, error: txError } = useTransaction({
    hash: inspectHash as `0x${string}`,
    query: {
      enabled: !!inspectHash,
    },
  })

  const handleInspect = () => {
    if (txHash.startsWith('0x') && txHash.length === 66) {
      setInspectHash(txHash)
    }
  }

  const formatGas = (gas: bigint | undefined) => {
    if (!gas) return 'N/A'
    return formatLargeNumber(Number(gas))
  }

  const formatWei = (wei: bigint | undefined) => {
    if (!wei) return '0'
    const eth = formatUnits(wei, 18)
    const num = parseFloat(eth)
    return `${formatLargeNumber(num)} ETH`
  }

  return (
    <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
      <h4 className="font-semibold mb-3 text-purple-800">Transaction Inspector</h4>
      
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder="Enter transaction hash (0x...)"
          value={txHash}
          onChange={(e) => setTxHash(e.target.value)}
          className="flex-1 px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
        <button
          onClick={handleInspect}
          disabled={!txHash || !txHash.startsWith('0x') || txHash.length !== 66}
          className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Inspect
        </button>
      </div>

      {(receiptLoading || txLoading) && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded">
          <div className="text-blue-600">Loading transaction data...</div>
        </div>
      )}

      {(receiptError || txError) && (
        <div className="p-3 bg-red-50 border border-red-200 rounded">
          <div className="text-red-700 text-sm">
            Error: {receiptError?.message || txError?.message || 'Failed to fetch transaction'}
          </div>
        </div>
      )}

      {txReceipt && txData && (
        <div className="space-y-4">
          {/* Transaction Status */}
          <div className="bg-white rounded-lg border p-3">
            <h5 className="font-semibold mb-2">Transaction Status</h5>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Status:</span>
                <span className={`font-semibold ${txReceipt.status === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                  {txReceipt.status === 'success' ? '✅ Success' : '❌ Failed'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Block:</span>
                <span className="font-mono">{txReceipt.blockNumber?.toString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Transaction Index:</span>
                <span className="font-mono">{txReceipt.transactionIndex}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Type:</span>
                <span className="font-mono">{txData.type}</span>
              </div>
            </div>
          </div>

          {/* Addresses */}
          <div className="bg-white rounded-lg border p-3">
            <h5 className="font-semibold mb-2">Addresses</h5>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-gray-600">From:</span>
                <span className="font-mono text-xs break-all">{txData.from}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-600">To:</span>
                <span className="font-mono text-xs break-all">{txData.to || 'Contract Creation'}</span>
              </div>
            </div>
          </div>

          {/* Gas & Value */}
          <div className="bg-white rounded-lg border p-3">
            <h5 className="font-semibold mb-2">Gas & Value</h5>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Gas Limit:</span>
                <span className="font-mono">{formatGas(txData.gas)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Gas Used:</span>
                <span className="font-mono">{formatGas(txReceipt.gasUsed)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Gas Price:</span>
                <span className="font-mono">{formatGas(txData.gasPrice || 0n)} gwei</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Value:</span>
                <span className="font-mono">{formatWei(txData.value)}</span>
              </div>
            </div>
          </div>

          {/* Transaction Hash */}
          <div className="bg-white rounded-lg border p-3">
            <h5 className="font-semibold mb-2">Transaction Hash</h5>
            <div className="font-mono text-xs break-all bg-gray-50 p-2 rounded">
              {inspectHash}
            </div>
          </div>

          {/* Input Data */}
          {txData.input && txData.input !== '0x' && (
            <div className="bg-white rounded-lg border p-3">
              <h5 className="font-semibold mb-2">Input Data</h5>
              <div className="font-mono text-xs break-all bg-gray-50 p-2 rounded max-h-32 overflow-y-auto">
                {txData.input}
              </div>
            </div>
          )}

          {/* Logs */}
          {txReceipt.logs && txReceipt.logs.length > 0 && (
            <div className="bg-white rounded-lg border p-3">
              <h5 className="font-semibold mb-2">Events ({txReceipt.logs.length})</h5>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {txReceipt.logs.map((log, index) => (
                  <div key={index} className="bg-gray-50 p-2 rounded text-sm">
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-semibold">Event #{index + 1}</span>
                      <span className="font-mono text-xs">{log.address}</span>
                    </div>
                    <div className="font-mono text-xs break-all">
                      Topics: {log.topics.join(', ')}
                    </div>
                    {log.data && log.data !== '0x' && (
                      <div className="font-mono text-xs break-all mt-1">
                        Data: {log.data}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function OptionContract() {
  const [exerciseAmount, setExerciseAmount] = useState('')
  const [transferToAddress, setTransferToAddress] = useState('')
  const [completeHandoverAddress, setCompleteHandoverAddress] = useState('')
  const [vestingSnapshotTime, setVestingSnapshotTime] = useState('')

  const { writeContract, data: hash, error, isPending } = useWriteContract()
  
  const { isLoading: isConfirming, isSuccess: isConfirmed } = 
    useWaitForTransactionReceipt({ 
      hash,
    })

  const { data: option } = useReadContracts({
    contracts: functions.map((f) => ({
      ...optionContract,
      functionName: f,
    })),
  })

  // Get currently vested snapshot if timestamp is provided
  const { data: vestingSnapshot } = useReadContracts({
    contracts: [
      {
        ...optionContract,
        functionName: 'getCurrentlyVestedSnapshot',
        args: [BigInt(Math.floor(new Date(vestingSnapshotTime || Date.now()).getTime() / 1000))],
      },
    ],
    query: {
      enabled: !!vestingSnapshotTime,
    },
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

  // Write function handlers
  const handleExercise = () => {
    if (!exerciseAmount || !tokenDecimals?.[1]?.result) return
    
    const underlyingDecimals = tokenDecimals[1].result as number
    const amountInWei = parseUnits(exerciseAmount, underlyingDecimals)
    
    writeContract({
      ...optionContract,
      functionName: 'exercise',
      args: [amountInWei],
    })
  }

  const handleStopVestingAndWithdraw = () => {
    writeContract({
      ...optionContract,
      functionName: 'stopVestingAndWithdrawUnvested',
    })
  }

  const handleWithdrawExpired = () => {
    writeContract({
      ...optionContract,
      functionName: 'withdrawExpiredTokens',
    })
  }

  const handleRequestOwnershipHandover = () => {
    writeContract({
      ...optionContract,
      functionName: 'requestOwnershipHandover',
    })
  }

  const handleCancelOwnershipHandover = () => {
    writeContract({
      ...optionContract,
      functionName: 'cancelOwnershipHandover',
    })
  }

  const handleCompleteOwnershipHandover = () => {
    if (!completeHandoverAddress) return
    
    writeContract({
      ...optionContract,
      functionName: 'completeOwnershipHandover',
      args: [completeHandoverAddress as `0x${string}`],
    })
  }

  const handleTransferOwnership = () => {
    if (!transferToAddress) return
    
    writeContract({
      ...optionContract,
      functionName: 'transferOwnership',
      args: [transferToAddress as `0x${string}`],
    })
  }

  const handleRenounceOwnership = () => {
    writeContract({
      ...optionContract,
      functionName: 'renounceOwnership',
    })
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold mb-4">Option Contract Details</h2>
      
      {/* Token Balances */}
      <TokenBalances 
        currencyAddress={option?.[5]?.result as string}
        underlyingAddress={option?.[6]?.result as string}
      />
      
      {/* Transaction Inspector */}
      <TransactionInspector />
      
      {/* Read Functions */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-gray-800">Contract State</h3>
        {/* Contract address entry */}
        <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg border">
          <strong className="capitalize text-gray-700 min-w-0 flex-shrink-0 mr-4">
            Contract address:
          </strong>
          <div className="text-right min-w-0 flex-1 font-mono break-all">
            {optionContract.address}
          </div>
        </div>
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

        {/* Vesting Snapshot */}
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h4 className="font-semibold mb-2 text-blue-800">Vesting Snapshot</h4>
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="datetime-local"
                value={vestingSnapshotTime}
                onChange={(e) => setVestingSnapshotTime(e.target.value)}
                className="flex-1 px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={() => setVestingSnapshotTime(new Date().toISOString().slice(0, 16))}
                className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
              >
                Now
              </button>
            </div>
            {vestingSnapshot?.[0]?.result !== undefined && (
              <div className="flex justify-between items-center p-2 bg-white rounded border">
                <strong className="text-gray-700">Vested Amount at Selected Time:</strong>
                <span className="font-mono text-sm">
                  {tokenDecimals?.[1]?.result 
                    ? formatTokenAmount(vestingSnapshot[0].result, false)
                    : String(vestingSnapshot[0].result)
                  }
                </span>
              </div>
            )}
            {!vestingSnapshotTime && (
              <div className="text-sm text-gray-600 italic">
                Select a date and time to see how much would be vested at that moment
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Write Functions */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-800">Contract Actions</h3>
        
        {/* Transaction Status */}
        {hash && (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="text-sm">
              <div>Transaction Hash: <span className="font-mono text-xs">{hash}</span></div>
              {isConfirming && <div className="text-blue-600">Confirming transaction...</div>}
              {isConfirmed && <div className="text-green-600">Transaction confirmed!</div>}
            </div>
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
            <div className="text-red-700 text-sm">Error: {error.message}</div>
          </div>
        )}

        {/* Exercise Option */}
        <div className="p-4 bg-white border rounded-lg">
          <h4 className="font-semibold mb-2">Exercise Option</h4>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Amount to exercise"
              value={exerciseAmount}
              onChange={(e) => setExerciseAmount(e.target.value)}
              className="flex-1 px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleExercise}
              disabled={isPending || !exerciseAmount}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPending ? 'Executing...' : 'Exercise'}
            </button>
          </div>
        </div>

        {/* Vesting Actions */}
        <div className="p-4 bg-white border rounded-lg">
          <h4 className="font-semibold mb-2">Vesting Actions</h4>
          <div className="space-y-2">
            <button
              onClick={handleStopVestingAndWithdraw}
              disabled={isPending}
              className="w-full px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50"
            >
              Stop Vesting & Withdraw Unvested
            </button>
          </div>
        </div>

        {/* Token Management */}
        <div className="p-4 bg-white border rounded-lg">
          <h4 className="font-semibold mb-2">Token Management</h4>
          <button
            onClick={handleWithdrawExpired}
            disabled={isPending}
            className="w-full px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 disabled:opacity-50"
          >
            Withdraw Expired Tokens
          </button>
        </div>

        {/* Ownership Management */}
        <div className="p-4 bg-white border rounded-lg">
          <h4 className="font-semibold mb-3">Ownership Management</h4>
          <div className="space-y-3">
            <button
              onClick={handleRequestOwnershipHandover}
              disabled={isPending}
              className="w-full px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 disabled:opacity-50"
            >
              Request Ownership Handover
            </button>
            
            <button
              onClick={handleCancelOwnershipHandover}
              disabled={isPending}
              className="w-full px-4 py-2 bg-yellow-700 text-white rounded hover:bg-yellow-800 disabled:opacity-50"
            >
              Cancel Ownership Handover
            </button>

            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Pending owner address"
                value={completeHandoverAddress}
                onChange={(e) => setCompleteHandoverAddress(e.target.value)}
                className="flex-1 px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleCompleteOwnershipHandover}
                disabled={isPending || !completeHandoverAddress}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
              >
                Complete Handover
              </button>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                placeholder="New owner address"
                value={transferToAddress}
                onChange={(e) => setTransferToAddress(e.target.value)}
                className="flex-1 px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleTransferOwnership}
                disabled={isPending || !transferToAddress}
                className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
              >
                Transfer Ownership
              </button>
            </div>

            <button
              onClick={handleRenounceOwnership}
              disabled={isPending}
              className="w-full px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
            >
              Renounce Ownership
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
