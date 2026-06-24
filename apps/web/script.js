const CHAIN_ID = 998;
const CHAIN_ID_HEX = "0x3e6";
const RPC_URL = "https://rpc.hyperliquid-testnet.xyz/evm";
const EXPLORER = "https://testnet.purrsec.com";
const ZERO = "0x0000000000000000000000000000000000000000";

const selectors = {
  approve: "0x095ea7b3",
  createGrant: "0x6660ef1c",
  predictGrantAddress: "0x4078ac78",
  owner: "0x8da5cb5b",
  tokenGrantLogic: "0x0b18d7a9",
  creationFee: "0xdce0b4e4",
  issuer: "0x1d143848",
  holder: "0xe534155d",
  token: "0xfc0c546a",
  paymentToken: "0x3013ce29",
  grantSize: "0xdcebfe2e",
  claimable: "0xaf38d757",
  price: "0xa035b1fe",
  expiry: "0xe184c9be",
  settledAmount: "0x3db3dc9b",
  vestingIsHalted: "0x981efe10",
  isClosed: "0xc2b6b58c",
  getSettleableAmount: "0x31eb15b0",
  getSettlementCost: "0x8e2891ea",
  settle: "0x8df82800",
  stopVestingAndWithdrawUnvested: "0xd63631bf",
  withdrawExpiredTokens: "0xf2b1d84c",
};

const state = {
  account: undefined,
  chainId: undefined,
  deployment: undefined,
  selectedGrant: undefined,
  selectedGrantData: undefined,
};

const $ = (id) => document.getElementById(id);

const log = (message) => {
  const stamp = new Date().toISOString().replace(".000Z", "Z");
  $("log").textContent = `[${stamp}] ${message}\n${$("log").textContent}`;
};

const requireProvider = () => {
  if (!window.ethereum) throw new Error("No injected wallet provider found.");
  return window.ethereum;
};

const rpc = async (method, params = []) => {
  const provider = requireProvider();
  return provider.request({ method, params });
};

const publicRpc = async (method, params = []) => {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(body.error.message ?? "RPC error");
  return body.result;
};

const isAddress = (value) => /^0x[0-9a-fA-F]{40}$/.test(value ?? "");
const isBytes32 = (value) => /^0x[0-9a-fA-F]{64}$/.test(value ?? "");
const strip0x = (value) => value.replace(/^0x/, "");
const short = (value) => (value ? `${value.slice(0, 6)}...${value.slice(-4)}` : "None");
const addressLink = (address) =>
  isAddress(address) ? `<a href="${EXPLORER}/address/${address}" rel="noreferrer" target="_blank">${short(address)}</a>` : "None";

const word = (hex) => hex.toLowerCase().replace(/^0x/, "").padStart(64, "0");
const encodeAddress = (value) => {
  if (!isAddress(value)) throw new Error(`Invalid address: ${value}`);
  return word(value);
};
const encodeUint = (value) => {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) throw new Error(`Invalid uint: ${text}`);
  return BigInt(text).toString(16).padStart(64, "0");
};
const encodeBytes32 = (value) => {
  if (!isBytes32(value)) throw new Error(`Invalid bytes32: ${value}`);
  return strip0x(value).toLowerCase();
};
const callData = (selector, values = []) => `0x${strip0x(selector)}${values.join("")}`;

const decodeAddress = (data) => {
  if (!data || data === "0x") return undefined;
  return `0x${strip0x(data).slice(24, 64)}`;
};
const decodeUint = (data) => (data && data !== "0x" ? BigInt(`0x${strip0x(data).slice(0, 64)}`) : undefined);
const decodeBool = (data) => decodeUint(data) === 1n;

const ethCall = async (to, data) => publicRpc("eth_call", [{ to, data }, "latest"]);

const sendTx = async ({ to, data, value = "0x0" }) => {
  if (!state.account) throw new Error("Connect wallet first.");
  if (state.chainId !== CHAIN_ID_HEX) throw new Error("Switch wallet to HyperEVM testnet first.");
  const hash = await rpc("eth_sendTransaction", [{ from: state.account, to, data, value }]);
  log(`Submitted ${hash}`);
  return hash;
};

const renderDeployment = async () => {
  const facts = $("deployment-facts");
  const status = $("deployment-state");
  if (!state.deployment?.tokenGrantFactory) {
    status.textContent = "Pending";
    status.className = "status pending";
    facts.innerHTML = `
      <div><dt>Chain</dt><dd>HyperEVM testnet (${CHAIN_ID})</dd></div>
      <div><dt>Factory</dt><dd>No deployment artifact</dd></div>
    `;
    return;
  }

  const factory = state.deployment.tokenGrantFactory;
  let logic = state.deployment.tokenGrantLogic;
  let owner = state.deployment.factoryOwner;
  let fee = state.deployment.creationFee;
  try {
    logic = decodeAddress(await ethCall(factory, selectors.tokenGrantLogic)) ?? logic;
    owner = decodeAddress(await ethCall(factory, selectors.owner)) ?? owner;
    fee = String(decodeUint(await ethCall(factory, selectors.creationFee)) ?? BigInt(fee ?? 0));
  } catch (error) {
    log(`Deployment reads failed: ${error.message}`);
  }

  status.textContent = "Ready";
  status.className = "status live";
  $("creation-fee").textContent = `${fee ?? "0"} wei`;
  facts.innerHTML = `
    <div><dt>Chain</dt><dd>HyperEVM testnet (${CHAIN_ID})</dd></div>
    <div><dt>Factory</dt><dd>${addressLink(factory)}</dd></div>
    <div><dt>Implementation</dt><dd>${addressLink(logic)}</dd></div>
    <div><dt>Owner</dt><dd>${addressLink(owner)}</dd></div>
    <div><dt>Creation fee</dt><dd>${fee ?? "0"} wei</dd></div>
    <div><dt>Deployer</dt><dd>${addressLink(state.deployment.deployer)}</dd></div>
  `;
};

const loadDeployment = async () => {
  const response = await fetch(`/deployments/998.json?ts=${Date.now()}`, { cache: "no-store" });
  state.deployment = await response.json();
  $("deployment-json").textContent = JSON.stringify(state.deployment, null, 2);
  await renderDeployment();
};

const setDefaultTimes = () => {
  const now = Math.floor(Date.now() / 1000);
  $("create-cliff").value = String(now + 60);
  $("create-end").value = String(now + 3600);
  $("create-expiry").value = String(now + 7200);
};

const randomSalt = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
};

const createArgs = () => ({
  holder: $("create-holder").value.trim(),
  token: $("create-token").value.trim(),
  paymentToken: $("create-payment-token").value.trim() || ZERO,
  amount: $("create-amount").value.trim(),
  price: $("create-price").value.trim(),
  expiry: $("create-expiry").value.trim(),
  cliff: $("create-cliff").value.trim(),
  end: $("create-end").value.trim(),
  salt: $("create-salt").value.trim(),
});

const encodedCreateArgs = () => {
  const args = createArgs();
  return [
    encodeAddress(args.holder),
    encodeAddress(args.token),
    encodeAddress(args.paymentToken),
    encodeUint(args.amount),
    encodeUint(args.price),
    encodeUint(args.expiry),
    encodeUint(args.cliff),
    encodeUint(args.end),
    encodeBytes32(args.salt),
  ];
};

const predictGrant = async () => {
  if (!state.deployment?.tokenGrantFactory) throw new Error("No factory deployment loaded.");
  const { salt } = createArgs();
  const data = callData(selectors.predictGrantAddress, [encodeBytes32(salt)]);
  const result = await ethCall(state.deployment.tokenGrantFactory, data);
  const predicted = decodeAddress(result);
  state.selectedGrant = predicted;
  $("predicted-grant").innerHTML = addressLink(predicted);
  $("grant-address").value = predicted ?? "";
  log(`Predicted grant ${predicted}`);
  return predicted;
};

const approveEscrow = async () => {
  const args = createArgs();
  const spender = $("grant-address").value || (await predictGrant());
  const data = callData(selectors.approve, [encodeAddress(spender), encodeUint(args.amount)]);
  await sendTx({ to: args.token, data });
};

const createGrant = async () => {
  if (!state.deployment?.tokenGrantFactory) throw new Error("No factory deployment loaded.");
  const fee = BigInt(state.deployment.creationFee ?? 0);
  const data = callData(selectors.createGrant, encodedCreateArgs());
  await sendTx({
    to: state.deployment.tokenGrantFactory,
    data,
    value: `0x${fee.toString(16)}`,
  });
};

const loadGrant = async () => {
  const grant = $("grant-address").value.trim();
  if (!isAddress(grant)) throw new Error("Enter a grant address.");
  const now = BigInt(Math.floor(Date.now() / 1000));
  const [issuer, holder, token, paymentToken, grantSize, claimable, price, expiry, settled, halted, closed, settleable] =
    await Promise.all([
      ethCall(grant, selectors.issuer).then(decodeAddress),
      ethCall(grant, selectors.holder).then(decodeAddress),
      ethCall(grant, selectors.token).then(decodeAddress),
      ethCall(grant, selectors.paymentToken).then(decodeAddress),
      ethCall(grant, selectors.grantSize).then(decodeUint),
      ethCall(grant, selectors.claimable).then(decodeUint),
      ethCall(grant, selectors.price).then(decodeUint),
      ethCall(grant, selectors.expiry).then(decodeUint),
      ethCall(grant, selectors.settledAmount).then(decodeUint),
      ethCall(grant, selectors.vestingIsHalted).then(decodeBool),
      ethCall(grant, selectors.isClosed).then(decodeBool),
      ethCall(grant, callData(selectors.getSettleableAmount, [encodeUint(now)])).then(decodeUint),
    ]);
  state.selectedGrant = grant;
  state.selectedGrantData = { issuer, holder, token, paymentToken, grantSize, claimable, price, expiry, settled, halted, closed, settleable };
  const expired = expiry !== undefined && now > expiry;
  $("grant-facts").innerHTML = `
    <div><dt>Issuer</dt><dd>${addressLink(issuer)}</dd></div>
    <div><dt>Holder</dt><dd>${addressLink(holder)}</dd></div>
    <div><dt>Grant token</dt><dd>${addressLink(token)}</dd></div>
    <div><dt>Payment token</dt><dd>${paymentToken === ZERO ? "None" : addressLink(paymentToken)}</dd></div>
    <div><dt>Grant size</dt><dd>${grantSize ?? "Unknown"}</dd></div>
    <div><dt>Claimable</dt><dd>${claimable ?? "Unknown"}</dd></div>
    <div><dt>Settled</dt><dd>${settled ?? "Unknown"}</dd></div>
    <div><dt>Settleable now</dt><dd>${settleable ?? "Unknown"}</dd></div>
    <div><dt>Price</dt><dd>${price ?? "Unknown"}</dd></div>
    <div><dt>Expiry</dt><dd>${expiry ?? "Unknown"}${expired ? " (expired)" : ""}</dd></div>
    <div><dt>Halted</dt><dd>${halted ? "Yes" : "No"}</dd></div>
    <div><dt>Closed</dt><dd>${closed ? "Yes" : "No"}</dd></div>
  `;
  log(`Loaded grant ${grant}`);
};

const approvePayment = async () => {
  if (!state.selectedGrantData?.paymentToken || state.selectedGrantData.paymentToken === ZERO) {
    throw new Error("Selected grant has no payment token.");
  }
  const amount = $("payment-approval").value.trim();
  const data = callData(selectors.approve, [encodeAddress(state.selectedGrant), encodeUint(amount)]);
  await sendTx({ to: state.selectedGrantData.paymentToken, data });
};

const settleGrant = async () => {
  const amount = $("settle-amount").value.trim();
  await sendTx({ to: $("grant-address").value.trim(), data: callData(selectors.settle, [encodeUint(amount)]) });
};

const haltGrant = async () => {
  await sendTx({ to: $("grant-address").value.trim(), data: selectors.stopVestingAndWithdrawUnvested });
};

const withdrawExpired = async () => {
  await sendTx({ to: $("grant-address").value.trim(), data: selectors.withdrawExpiredTokens });
};

const connectWallet = async () => {
  const accounts = await rpc("eth_requestAccounts");
  state.account = accounts[0];
  state.chainId = await rpc("eth_chainId");
  renderWallet();
};

const switchChain = async () => {
  try {
    await rpc("wallet_switchEthereumChain", [{ chainId: CHAIN_ID_HEX }]);
  } catch (error) {
    if (error.code !== 4902) throw error;
    await rpc("wallet_addEthereumChain", [
      {
        chainId: CHAIN_ID_HEX,
        chainName: "HyperEVM Testnet",
        nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
        rpcUrls: [RPC_URL],
        blockExplorerUrls: [EXPLORER],
      },
    ]);
  }
  state.chainId = await rpc("eth_chainId");
  renderWallet();
};

const renderWallet = () => {
  $("wallet-address").textContent = state.account ? short(state.account) : "Not connected";
  $("wallet-chain").textContent = state.chainId ? `${Number.parseInt(state.chainId, 16)} (${state.chainId})` : "Unknown";
  $("connect-wallet").textContent = state.account ? "Connected" : "Connect wallet";
};

const bind = (id, handler) => {
  $(id).addEventListener("click", async () => {
    try {
      await handler();
    } catch (error) {
      log(error.message);
    }
  });
};

setDefaultTimes();
$("create-salt").value = randomSalt();
bind("connect-wallet", connectWallet);
bind("switch-chain", switchChain);
bind("new-salt", () => {
  $("create-salt").value = randomSalt();
  $("predicted-grant").textContent = "None";
});
bind("predict-grant", predictGrant);
bind("approve-escrow", approveEscrow);
bind("create-grant", createGrant);
bind("load-grant", loadGrant);
bind("approve-payment", approvePayment);
bind("settle-grant", settleGrant);
bind("halt-grant", haltGrant);
bind("withdraw-expired", withdrawExpired);
bind("clear-log", () => {
  $("log").textContent = "";
});

if (window.ethereum) {
  window.ethereum.on?.("accountsChanged", (accounts) => {
    state.account = accounts[0];
    renderWallet();
  });
  window.ethereum.on?.("chainChanged", (chainId) => {
    state.chainId = chainId;
    renderWallet();
  });
}

loadDeployment().catch((error) => {
  state.deployment = { status: "pending", reason: error.message };
  $("deployment-json").textContent = JSON.stringify(state.deployment, null, 2);
  renderDeployment();
  log(error.message);
});
