import { Button } from '@/components/ui/button'
import * as hl from '@nktkas/hyperliquid'
import { useAccount, useWalletClient } from 'wagmi'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

export function ApproveAgent() {
  const { address } = useAccount()
  const { data: walletClient } = useWalletClient()

  const handleApproveAgent = async () => {
    if (!address || !walletClient) {
      console.error('Not connected')
      return
    }
    console.log('Wallet connected, proceeding with agent approval.')

    const transport = new hl.HttpTransport()
    const exchClient = new hl.ExchangeClient({ wallet: walletClient, transport })
    console.log('Exchange client initialized.')

    try {
      const privateKey = generatePrivateKey()
      const account = privateKeyToAccount(privateKey)
      console.log('Generated private key and account:', { privateKey, agentAddress: account.address })

      console.log('Approving agent with address:', account.address)
      const result = await exchClient.approveAgent({
        agentAddress: account.address,
        agentName: 'agentName',
      })
      console.log('Agent approved:', result)
    } catch (error) {
      console.error('Error approving agent:', error)
    }
  }

  return (
    <Button onClick={handleApproveAgent}>
      Approve Agent
    </Button>
  )
}
