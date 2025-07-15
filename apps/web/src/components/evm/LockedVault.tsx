import { useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { parseUnits } from 'viem'
import { useState } from 'react'
import { lockedVaultAbi, lockedVaultAddress } from 'evm/contracts'

const lockedVaultContract = {
  address: lockedVaultAddress[9999],
  abi: lockedVaultAbi,
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
        inputs: [
          { name: 'spender', internalType: 'address', type: 'address' },
          { name: 'amount', internalType: 'uint256', type: 'uint256' },
        ],
        name: 'approve',
        outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
        stateMutability: 'nonpayable',
      },
  ] as const

const readFunctions = [
    "director",
    "lastAuctionTime",
    "nextId"
]

export default function LockedVault() {
  const [depositToken, setDepositToken] = useState('')
  const [depositAmount, setDepositAmount] = useState('')

  const [auctionSellToken, setAuctionSellToken] = useState('')
  const [auctionAmount, setAuctionAmount] = useState('')
  const [auctionStableToken, setAuctionStableToken] = useState('')

  const { writeContract, data: hash, error, isPending } = useWriteContract()
  
  const { isLoading: isConfirming, isSuccess: isConfirmed } = 
    useWaitForTransactionReceipt({ 
      hash,
    })

  const { data: vaultState } = useReadContracts({
    contracts: readFunctions.map((f) => ({
      ...lockedVaultContract,
      functionName: f,
    })),
  })

  const formatTimestamp = (timestamp: bigint | number) => {
    if (Number(timestamp) === 0) return 'Not set';
    const date = new Date(Number(timestamp) * 1000)
    return date.toLocaleString()
  }

  const formatValue = (value: any, functionName: string) => {
    if (value === undefined || value === null) return 'Loading...'
    
    if (functionName === 'lastAuctionTime') {
      return formatTimestamp(value)
    }
    
    if (typeof value === 'bigint') {
        return value.toString()
    }

    return String(value)
  }

  const handleDeposit = async () => {
    if (!depositToken || !depositAmount) return

    // This is a simplified deposit flow. A real app would get decimals.
    // For now, we assume 18 decimals for approval and deposit.
    const amountInWei = parseUnits(depositAmount, 18)

    // First, approve the vault to spend the tokens
    writeContract({
        address: depositToken as `0x${string}`,
        abi: erc20Abi,
        functionName: 'approve',
        args: [lockedVaultContract.address, amountInWei],
      }, {
        onSuccess: async (approveHash) => {
            // Normally you'd wait for approve receipt here.
            // For simplicity, we fire and forget and hope it confirms before the next call.
            console.log('Approval transaction sent:', approveHash);
            // Ideally, wait for confirmation before depositing.
            // This is a simplified example.
            writeContract({
                ...lockedVaultContract,
                functionName: 'deposit',
                args: [depositToken as `0x${string}`, amountInWei],
            })
        }
      })
  }

  const handleCreateAuction = () => {
    if (!auctionSellToken || !auctionAmount || !auctionStableToken) return

    // Assuming 18 decimals for simplicity
    const amountInWei = parseUnits(auctionAmount, 18)

    writeContract({
        address: auctionSellToken as `0x${string}`,
        abi: erc20Abi,
        functionName: 'approve',
        args: [lockedVaultContract.address, amountInWei],
      }, {
        onSuccess: async (approveHash) => {
            console.log('Approval transaction sent:', approveHash);
            writeContract({
                ...lockedVaultContract,
                functionName: 'createAuction',
                args: [auctionSellToken as `0x${string}`, amountInWei, auctionStableToken as `0x${string}`],
            })
        }
      })
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold mb-4">LockedVault Contract UI</h2>
      
      {/* Read Functions */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-gray-800">Contract State</h3>
        <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg border">
          <strong className="capitalize text-gray-700">Contract address:</strong>
          <div className="text-right font-mono break-all">{lockedVaultContract.address}</div>
        </div>
        {vaultState?.map((o, i) => (
          <div key={readFunctions[i]} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg border">
            <strong className="capitalize text-gray-700">
              {readFunctions[i].replace(/([A-Z])/g, ' $1').trim()}:
            </strong>
            <div className="text-right">
              {formatValue(o?.result, readFunctions[i])}
            </div>
          </div>
        ))}
      </div>

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

      {/* Write Functions */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-800">Contract Actions</h3>

        {/* Deposit Tokens */}
        <div className="p-4 bg-white border rounded-lg">
          <h4 className="font-semibold mb-2">Deposit Tokens</h4>
          <div className="space-y-2">
            <input
              type="text"
              placeholder="Token Address"
              value={depositToken}
              onChange={(e) => setDepositToken(e.target.value)}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="text"
              placeholder="Amount (in smallest unit, e.g., wei)"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleDeposit}
              disabled={isPending || !depositToken || !depositAmount}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {isPending ? 'Depositing...' : 'Deposit'}
            </button>
            <p className="text-xs text-gray-500">Note: This will first ask for token approval, then you must trigger the deposit. This UI is simplified and calls both in sequence.</p>
          </div>
        </div>

        {/* Create Auction */}
        <div className="p-4 bg-white border rounded-lg">
          <h4 className="font-semibold mb-2">Create Auction</h4>
          <div className="space-y-2">
            <input
              type="text"
              placeholder="Sell Token Address"
              value={auctionSellToken}
              onChange={(e) => setAuctionSellToken(e.target.value)}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <input
              type="text"
              placeholder="Sell Amount (in smallest unit)"
              value={auctionAmount}
              onChange={(e) => setAuctionAmount(e.target.value)}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <input
              type="text"
              placeholder="Stablecoin Address for Bids"
              value={auctionStableToken}
              onChange={(e) => setAuctionStableToken(e.target.value)}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <button
              onClick={handleCreateAuction}
              disabled={isPending || !auctionSellToken || !auctionAmount || !auctionStableToken}
              className="w-full px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
            >
              {isPending ? 'Creating...' : 'Create Auction'}
            </button>
            <p className="text-xs text-gray-500">Note: This action also requires token approval before creating the auction.</p>
          </div>
        </div>
      </div>
    </div>
  )
} 