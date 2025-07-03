import { createRoute, type RootRoute } from '@tanstack/react-router'
import { PageLayout } from '@/components/PageLayout'
import {
  useOperator,
  useMultisig,
  useCreateMultisigMutation,
  useSpotTokens,
  useHyperliquidSpotBalances,
} from '@/hooks/useHyperliquid'
import { Button } from '@/components/ui/button'
import { useHyperliquid } from '@/providers/HyperliquidProvider'
import { createContext, useEffect, useContext, useState, useMemo } from 'react'
import * as hl from '@nktkas/hyperliquid'
import { useAccount, useWalletClient } from 'wagmi'
import { SpotBalances } from '@/components/SpotBalances'
import type { SignTypedDataParameters } from 'viem'

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

function MultisigProvider({ children }: { children: React.ReactNode }) {
  const { data: multisig } = useMultisig()
  const { data: walletClient } = useWalletClient()
  const account = useAccount()

  const [multisigClient, setMultisigClient] =
    useState<hl.MultiSignClient | null>(null)

  useEffect(() => {
    if (!multisig || !walletClient || !account.address) return
    // console.log(walletClient.address)
    const multisigClient = new hl.MultiSignClient({
      transport: new hl.HttpTransport({ isTestnet: IS_TESTNET }),
      multiSignAddress: multisig.address as `0x${string}`,
      signatureChainId: IS_TESTNET ? '0x270f' : '0x3e7',
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
          }) => await walletClient.signTypedData(params),
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

function Multisig() {
  const MultiSigComponent = () => {
    const multisigClient = useMultisigClient()

    if (!multisigClient) return

    const { client, address } = multisigClient

    const TransferToMultisigButton = () => {
      const { exchangeClient } = useHyperliquid()
      const { data: spotTokens } = useSpotTokens()
      const { address: userAddress } = useAccount()
      const { data: spotBalances } = useHyperliquidSpotBalances(userAddress)

      if (!exchangeClient || !spotTokens || !spotBalances) return

      return (
        <Button
          onClick={() =>
            exchangeClient?.spotSend({
              destination: address as `0x${string}`,
              token: `${spotTokens?.USDC.name}:${spotTokens?.USDC.tokenId}`,
              amount: '10',
            })
          }
        >
          Transfer
        </Button>
      )
    }

    const MultisigBalances = () => (
      <SpotBalances address={address as `0x${string}`} />
    )

    const WithdrawFromMultisigButton = () => {
      const { address: userAddress } = useAccount()
      const { data: spotTokens } = useSpotTokens()

      if (!userAddress || !spotTokens?.USDC) return

      return (
        <Button
          onClick={() => {
            const params = {
              destination: userAddress,
              token: `${spotTokens?.USDC.name}:${spotTokens?.USDC.tokenId}`,
              amount: '10',
            } as const

            console.log(params)
            client.spotSend(params)
          }}
        >
          Withdraw
        </Button>
      )
    }

    return (
      <div>
        <MultisigBalances />
        <p>Multisig address: {address}</p>
        <TransferToMultisigButton />
        <WithdrawFromMultisigButton />
      </div>
    )
  }

  return (
    <MultisigProvider>
      <MultiSigComponent />
    </MultisigProvider>
  )
}

export function HomePage() {
  const { data: operator } = useOperator()
  const { data: multisig } = useMultisig()
  const { mutate: createMultisig } = useCreateMultisigMutation()
  const { data: spotTokens } = useSpotTokens()
  const { exchangeClient, infoClient } = useHyperliquid()

  const sendSeedTx = async () => {
    console.log('Starting sendSeedTx function')
    console.log('Operator:', operator?.operator)
    console.log('USDC token:', spotTokens?.USDC)

    if (!operator?.operator || !spotTokens?.USDC) {
      console.log('Missing operator or USDC token, returning early')
      return
    }

    const tokenIdentifier =
      `${spotTokens?.USDC.name}:${spotTokens?.USDC.tokenId}` as const
    console.log('Token identifier:', tokenIdentifier)
    console.log('Sending 5 USDC to operator:', operator?.operator)

    const tx = await exchangeClient?.spotSend({
      destination: operator?.operator,
      token: tokenIdentifier,
      amount: '5',
    })

    console.log('SpotSend result:', tx)
    console.log('Waiting 1 second for transaction to be indexed...')

    // wait for tx to be indexed
    await new Promise((resolve) => setTimeout(resolve, 1000))

    console.log('Fetching user details for operator:', operator?.operator)
    const userDetails = await infoClient?.userDetails({
      user: operator?.operator,
    })

    console.log('User details received, filtering transactions...')
    console.log('Total transactions:', userDetails?.length)

    console.log('User details:', userDetails)

    const txHash = userDetails
      ?.filter((tx) => {
        const matches =
          tx.action.type === 'spotSend' &&
          tx.action.destination?.toLowerCase() ===
            operator?.operator?.toLowerCase() &&
          tx.action.token === tokenIdentifier &&
          tx.action.amount === '5' &&
          tx.error === null

        if (matches) {
          console.log('Found matching transaction:', tx)
        }
        return matches
      })
      ?.sort((a, b) => b.time - a.time)[0]?.hash

    console.log('Final transaction hash:', txHash)
    return txHash
  }

  return (
    <PageLayout title="Explore">
      <div>
        <div>
          <h1>Operator</h1>
          <p>{operator?.operator}</p>
        </div>
        <Button
          onClick={async () => {
            const txHash = await sendSeedTx()
            if (!txHash) return
            createMultisig({ tx: txHash })
          }}
        >
          Create Multisig
        </Button>
        {multisig?.address && <Multisig />}
      </div>
    </PageLayout>
  )
}

export default (rootRoute: RootRoute) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: HomePage,
  })
