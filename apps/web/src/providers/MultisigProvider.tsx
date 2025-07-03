import { createContext, useEffect, useContext, useState, useMemo } from 'react'
import { useAccount, useChainId, useWalletClient } from 'wagmi'
import { useMultisig } from '@/hooks/useHyperliquid'
import * as hl from '@nktkas/hyperliquid'

const IS_TESTNET = true

const MultisigContext = createContext<{
  client: hl.MultiSignClient
  address: string
} | null>(null)

export const useMultisigClient = (): {
  client: hl.MultiSignClient
  address: string
} | null => {
  const context = useContext(MultisigContext)

  if (context === undefined) {
    throw new Error('useMultisigClient must be used within a MultisigProvider')
  }

  return context
}

export function MultisigProvider({ children }: { children: React.ReactNode }) {
  const { data: multisig } = useMultisig()
  const { data: walletClient } = useWalletClient()
  const account = useAccount()
  const chainId = useChainId()

  const [multisigClient, setMultisigClient] =
    useState<hl.MultiSignClient | null>(null)

  useEffect(() => {
    if (!multisig || !walletClient || !account.address) return
    // console.log(walletClient.address)
    const multisigClient = new hl.MultiSignClient({
      transport: new hl.HttpTransport({ isTestnet: IS_TESTNET }),
      multiSignAddress: multisig.address as `0x${string}`,
      signatureChainId: `0x${(1337).toString(16)}` as `0x${string}`,
      signers: [
        {
          address: account.address,
          signTypedData: async (params: {
            domain: {
              name: string
              version: string
              chainId: number
              verifyingContract: hl.Hex
            }
            types: {
              [key: string]: {
                name: string
                type: string
              }[]
            }
            primaryType: string
            message: Record<string, unknown>
          }) => {
            console.log('params', params)
            const signature = await walletClient.signTypedData({
              ...params,
              domain: {
                ...params.domain,
                chainId: 1337,
              },
            })

            console.log('signature', signature)
            return signature
          },
        },
      ],
      isTestnet: IS_TESTNET,
    })

    setMultisigClient(multisigClient)
  }, [multisig, walletClient])

  const value = useMemo(
    () =>
      multisigClient &&
      multisig && { client: multisigClient, address: multisig.address },
    [multisigClient, multisig],
  )

  return (
    <MultisigContext.Provider value={value ?? null}>
      {children}
    </MultisigContext.Provider>
  )
}
