import { sonic } from "viem/chains";

import {
  type Address,
  getContract,
  formatUnits,
  parseUnits,
  createPublicClient,
  http,
  type PublicClient,
  type WalletClient,
  createTestClient,
  publicActions,
  walletActions,
  getAddress,
  erc20Abi,
} from "viem";

const client = createPublicClient({
  chain: sonic,
  transport: http("http://localhost:1460"),
});

const wrapped_sonic = "0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38";

const COINBASE_HOT_WALLET = "0x51ba05662A3b00731d451014540049B08a4e9ea5";
const deployer = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const me = "0xE60f03D22bC1D0BFF96F31578A5744F863b6D5b0";

const contract = getContract({
  address: wrapped_sonic,
  abi: erc20Abi,
  client: { public: client },
});

const decimals = await contract.read.decimals();

async function getBalance(address) {
  const balance = await contract.read.balanceOf([address]);
  console.log(
    `Wrapped Sonic Balance: ${formatUnits(balance, decimals)}`
  );
}

await getBalance(COINBASE_HOT_WALLET)
await getBalance(deployer)
await getBalance(me)
