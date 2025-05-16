import { useState } from 'react'

import CreateConfigForm from './components/CreateConfigForm'
import CreatePoolForm from './components/CreatePoolForm'
import TokenCreationPage from './components/token-creation-page'
import ChartsPage from './components/charts-page'
import CreateSwapForm from './components/CreateSwapForm'

function Forms() {
  const [configAddress, setConfigAddress] = useState<string>("")

  const handleConfigCreated = (address: string) => {
    setConfigAddress(address)
  }

  return (
    <>
      <h1>Meteora Dynamic Bonding Curve (DBC) Tools</h1>
      <div className="container">
        <div className="form-section">
          <CreateConfigForm onConfigCreated={handleConfigCreated} />
        </div>
        <div className="form-section">
          <CreatePoolForm initialConfigAddress={configAddress} />
        </div>
        <div className="form-section">
          <CreateSwapForm />
        </div>
      </div>
      <footer className="read-the-docs">
        <p>Ensure your devnet wallet has SOL for transaction fees.</p>
        <p>These forms interact directly with the Solana devnet.</p>
        <p><strong>Never use mainnet private keys in a frontend example like this.</strong></p>
      </footer>
    </>
  )
}



function App() {
  return <Forms />
}

export default App
