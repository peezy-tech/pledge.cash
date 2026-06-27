import {
  boardroomAbi,
  boardroomFactoryAbi,
  boardroomTokenAbi,
  erc20Abi,
  getPledgeCashDeployment,
  HYPEREVM_TESTNET_CHAIN_ID,
  hyperEvmTestnet,
  isZeroAddress,
  tokenGrantAbi,
  tokenGrantFactoryAbi,
  ZERO_ADDRESS,
  type Address,
  type PledgeCashDeployment,
} from "@pledge.cash/sdk";
import {
  AlertTriangle,
  ArchiveRestore,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Send,
  Wallet,
  Wand2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  encodeFunctionData,
  getAddress,
  http,
  isAddress,
  type EIP1193Provider,
  type Hex,
} from "viem";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { cn } from "./lib/utils";

type Tab = "direct" | "grant" | "boardroom";

type WalletState = {
  account?: Address;
  chainId?: number;
};

type FactorySnapshot = {
  owner?: Address;
  tokenGrantLogic?: Address;
  creationFee?: bigint;
};

type GrantForm = {
  holder: string;
  token: string;
  paymentToken: string;
  amount: string;
  price: string;
  vestingCliff: string;
  vestingEnd: string;
  expiry: string;
  transferable: boolean;
  transferUnlockTime: string;
  salt: string;
};

type GrantSnapshot = {
  address: Address;
  issuer: Address;
  holder: Address;
  token: Address;
  paymentToken: Address;
  grantSize: bigint;
  claimable: bigint;
  price: bigint;
  expiry: bigint;
  settledAmount: bigint;
  settleable: bigint;
  halted: boolean;
  closed: boolean;
};

type BoardroomForm = {
  owner: string;
  name: string;
  symbol: string;
  salt: string;
};

type BoardroomSnapshot = {
  address: Address;
  owner: Address;
  policyRegistry: Address;
  shareToken: Address;
};

type BoardroomGrantForm = {
  holder: string;
  paymentToken: string;
  amount: string;
  price: string;
  vestingCliff: string;
  vestingEnd: string;
  expiry: string;
  transferable: boolean;
  transferUnlockTime: string;
  salt: string;
};

type LogEntry = {
  id: string;
  level: "info" | "error" | "success";
  message: string;
  time: string;
};

const RPC_URL = hyperEvmTestnet.rpcUrls.default.http[0] ?? "https://rpc.hyperliquid-testnet.xyz/evm";
const EXPLORER_URL = hyperEvmTestnet.blockExplorers.default.url;

const chain = defineChain({
  id: hyperEvmTestnet.id,
  name: hyperEvmTestnet.name,
  nativeCurrency: hyperEvmTestnet.nativeCurrency,
  rpcUrls: hyperEvmTestnet.rpcUrls,
  blockExplorers: hyperEvmTestnet.blockExplorers,
});

const publicClient = createPublicClient({
  chain,
  transport: http(RPC_URL),
});

function randomSalt(): Hex {
  const bytes = new Uint8Array(32);
  if (globalThis.crypto) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function defaultTimes(): Pick<GrantForm, "vestingCliff" | "vestingEnd" | "expiry"> {
  const now = Math.floor(Date.now() / 1000);
  return {
    vestingCliff: String(now + 60),
    vestingEnd: String(now + 3600),
    expiry: String(now + 7200),
  };
}

function defaultGrantForm(): GrantForm {
  return {
    holder: "",
    token: "",
    paymentToken: ZERO_ADDRESS,
    amount: "1000000000000000000",
    price: "0",
    ...defaultTimes(),
    transferable: false,
    transferUnlockTime: "0",
    salt: randomSalt(),
  };
}

function defaultBoardroomGrantForm(): BoardroomGrantForm {
  return {
    holder: "",
    paymentToken: ZERO_ADDRESS,
    amount: "1000000000000000000",
    price: "0",
    ...defaultTimes(),
    transferable: false,
    transferUnlockTime: "0",
    salt: randomSalt(),
  };
}

function shortAddress(address: string | undefined): string {
  if (!address) return "None";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function bigintString(value: bigint | undefined): string {
  if (value === undefined) return "Unknown";
  return value.toString();
}

function dateString(timestamp: bigint | undefined): string {
  if (timestamp === undefined) return "Unknown";
  const milliseconds = Number(timestamp) * 1000;
  if (!Number.isSafeInteger(milliseconds)) return timestamp.toString();
  return `${timestamp.toString()} (${new Date(milliseconds).toLocaleString()})`;
}

function requireAddress(value: string, label: string): Address {
  const trimmed = value.trim();
  if (!isAddress(trimmed)) throw new Error(`${label} must be an EVM address.`);
  return getAddress(trimmed);
}

function requireDeploymentAddress(value: Address | undefined, label: string): Address {
  if (!value) throw new Error(`${label} is missing from the deployment artifact.`);
  return value;
}

function requireBytes32(value: string, label: string): Hex {
  const trimmed = value.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(trimmed)) throw new Error(`${label} must be bytes32.`);
  return trimmed as Hex;
}

function uintInput(value: string, label: string): bigint {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) throw new Error(`${label} must be an unsigned integer.`);
  return BigInt(trimmed);
}

function optionalPaymentToken(value: string): Address {
  const trimmed = value.trim();
  if (!trimmed) return ZERO_ADDRESS;
  return requireAddress(trimmed, "Payment token");
}

function deploymentText(deployment: PledgeCashDeployment | undefined): string {
  if (!deployment) return "{}";
  return JSON.stringify(deployment, (_, value: unknown) => (typeof value === "bigint" ? value.toString() : value), 2);
}

function transactionUrl(hash: Hex): string {
  return `${EXPLORER_URL}/tx/${hash}`;
}

function addressUrl(address: Address): string {
  return `${EXPLORER_URL}/address/${address}`;
}

function walletState(account: Address | undefined, chainId: number | undefined): WalletState {
  const next: WalletState = {};
  if (account) next.account = account;
  if (chainId !== undefined) next.chainId = chainId;
  return next;
}

export function App(): React.JSX.Element {
  const deployment = getPledgeCashDeployment(HYPEREVM_TESTNET_CHAIN_ID);
  const [activeTab, setActiveTab] = useState<Tab>("direct");
  const [wallet, setWallet] = useState<WalletState>({});
  const [factorySnapshot, setFactorySnapshot] = useState<FactorySnapshot>({});
  const [grantForm, setGrantForm] = useState<GrantForm>(() => defaultGrantForm());
  const [predictedGrant, setPredictedGrant] = useState<Address>();
  const [grantAddress, setGrantAddress] = useState("");
  const [grantSnapshot, setGrantSnapshot] = useState<GrantSnapshot>();
  const [settleAmount, setSettleAmount] = useState("1000000000000000000");
  const [paymentApproval, setPaymentApproval] = useState("0");
  const [boardroomForm, setBoardroomForm] = useState<BoardroomForm>(() => ({
    owner: "",
    name: "Pledge Common",
    symbol: "PLDG",
    salt: randomSalt(),
  }));
  const [predictedBoardroom, setPredictedBoardroom] = useState<Address>();
  const [boardroomAddress, setBoardroomAddress] = useState("");
  const [boardroomSnapshot, setBoardroomSnapshot] = useState<BoardroomSnapshot>();
  const [boardroomMintAmount, setBoardroomMintAmount] = useState("1000000000000000000");
  const [boardroomMintTo, setBoardroomMintTo] = useState("");
  const [boardroomGrantForm, setBoardroomGrantForm] = useState<BoardroomGrantForm>(() => defaultBoardroomGrantForm());
  const [predictedBoardroomGrant, setPredictedBoardroomGrant] = useState<Address>();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [pendingAction, setPendingAction] = useState<string>();

  const creationFee = factorySnapshot.creationFee ?? deployment?.creationFee ?? 0n;
  const walletReady = wallet.account !== undefined && wallet.chainId === HYPEREVM_TESTNET_CHAIN_ID;

  const pushLog = useCallback((message: string, level: LogEntry["level"] = "info") => {
    setLogs((current) => [
      {
        id: `${Date.now()}-${Math.random()}`,
        level,
        message,
        time: new Date().toISOString().replace(".000Z", "Z"),
      },
      ...current,
    ].slice(0, 80));
  }, []);

  useEffect(() => {
    if (!wallet.account || boardroomForm.owner) return;
    setBoardroomForm((current) => ({ ...current, owner: wallet.account ?? current.owner }));
  }, [boardroomForm.owner, wallet.account]);

  useEffect(() => {
    const provider = window.ethereum;
    if (!provider) return;

    const handleAccountsChanged = (accounts: unknown) => {
      const account = Array.isArray(accounts) && isAddress(accounts[0]) ? getAddress(accounts[0]) : undefined;
      setWallet((current) => walletState(account, current.chainId));
    };
    const handleChainChanged = (chainId: unknown) => {
      const parsedChainId = typeof chainId === "string" ? Number.parseInt(chainId, 16) : undefined;
      setWallet((current) => walletState(current.account, parsedChainId));
    };

    provider.on?.("accountsChanged", handleAccountsChanged);
    provider.on?.("chainChanged", handleChainChanged);

    return () => {
      provider.removeListener?.("accountsChanged", handleAccountsChanged);
      provider.removeListener?.("chainChanged", handleChainChanged);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadFactory(): Promise<void> {
      if (!deployment?.tokenGrantFactory) return;

      try {
        const [owner, tokenGrantLogic, creationFee_] = await Promise.all([
          publicClient.readContract({
            address: deployment.tokenGrantFactory,
            abi: tokenGrantFactoryAbi,
            functionName: "owner",
          }),
          publicClient.readContract({
            address: deployment.tokenGrantFactory,
            abi: tokenGrantFactoryAbi,
            functionName: "tokenGrantLogic",
          }),
          publicClient.readContract({
            address: deployment.tokenGrantFactory,
            abi: tokenGrantFactoryAbi,
            functionName: "creationFee",
          }),
        ]);
        if (!cancelled) {
          setFactorySnapshot({
            owner,
            tokenGrantLogic,
            creationFee: creationFee_,
          });
        }
      } catch (error) {
        pushLog(`Factory reads failed: ${errorMessage(error)}`, "error");
      }
    }

    void loadFactory();
    return () => {
      cancelled = true;
    };
  }, [deployment?.tokenGrantFactory, pushLog]);

  const runAction = async (label: string, action: () => Promise<void>): Promise<void> => {
    setPendingAction(label);
    try {
      await action();
    } catch (error) {
      pushLog(errorMessage(error), "error");
    } finally {
      setPendingAction(undefined);
    }
  };

  const activeAccount = (): Address => {
    if (!wallet.account) throw new Error("Connect wallet first.");
    if (wallet.chainId !== HYPEREVM_TESTNET_CHAIN_ID) throw new Error("Switch wallet to HyperEVM testnet first.");

    return wallet.account;
  };

  const walletClient = (): ReturnType<typeof createWalletClient> => {
    const provider = window.ethereum;
    if (!provider) throw new Error("No injected wallet provider found.");
    const account = activeAccount();

    return createWalletClient({
      account,
      chain,
      transport: custom(provider as EIP1193Provider),
    });
  };

  const connectWallet = async (): Promise<void> => {
    const provider = window.ethereum;
    if (!provider) throw new Error("No injected wallet provider found.");

    const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
    const chainId = (await provider.request({ method: "eth_chainId" })) as string;
    const account = accounts[0];
    if (!account || !isAddress(account)) throw new Error("Wallet did not return an EVM address.");
    setWallet({ account: getAddress(account), chainId: Number.parseInt(chainId, 16) });
    pushLog(`Connected ${shortAddress(account)}`, "success");
  };

  const switchChain = async (): Promise<void> => {
    const provider = window.ethereum;
    if (!provider) throw new Error("No injected wallet provider found.");

    const chainId = `0x${HYPEREVM_TESTNET_CHAIN_ID.toString(16)}`;
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? Number(error.code) : undefined;
      if (code !== 4902) throw error;
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId,
            chainName: hyperEvmTestnet.name,
            nativeCurrency: hyperEvmTestnet.nativeCurrency,
            rpcUrls: [RPC_URL],
            blockExplorerUrls: [EXPLORER_URL],
          },
        ],
      });
    }

    setWallet((current) => ({ ...current, chainId: HYPEREVM_TESTNET_CHAIN_ID }));
    pushLog("Wallet switched to HyperEVM testnet.", "success");
  };

  const grantArgs = () => {
    const holder = requireAddress(grantForm.holder, "Holder");
    const token = requireAddress(grantForm.token, "Grant token");
    const paymentToken = optionalPaymentToken(grantForm.paymentToken);
    const amount = uintInput(grantForm.amount, "Amount");
    const price = uintInput(grantForm.price, "Price");
    const expiry = uintInput(grantForm.expiry, "Expiry");
    const vestingCliff = uintInput(grantForm.vestingCliff, "Vesting cliff");
    const vestingEnd = uintInput(grantForm.vestingEnd, "Vesting end");
    const transferUnlockTime = grantForm.transferable
      ? uintInput(grantForm.transferUnlockTime, "Transfer unlock time")
      : 0n;
    const salt = requireBytes32(grantForm.salt, "Salt");

    return {
      holder,
      token,
      paymentToken,
      amount,
      price,
      expiry,
      vestingCliff,
      vestingEnd,
      transferable: grantForm.transferable,
      transferUnlockTime,
      salt,
      tuple: [
        holder,
        token,
        paymentToken,
        amount,
        price,
        expiry,
        vestingCliff,
        vestingEnd,
        grantForm.transferable,
        transferUnlockTime,
        salt,
      ] as const,
    };
  };

  const predictGrant = async (): Promise<void> => {
    if (!wallet.account) throw new Error("Connect wallet to predict a direct grant.");
    const factory = requireDeploymentAddress(deployment?.tokenGrantFactory, "TokenGrantFactory");
    const { salt } = grantArgs();
    const predicted = await publicClient.readContract({
      address: factory,
      abi: tokenGrantFactoryAbi,
      functionName: "predictGrantAddress",
      args: [wallet.account, salt],
    });
    setPredictedGrant(predicted);
    setGrantAddress(predicted);
    pushLog(`Predicted grant ${predicted}`, "success");
  };

  const approveEscrow = async (): Promise<void> => {
    const factory = requireDeploymentAddress(deployment?.tokenGrantFactory, "TokenGrantFactory");
    const { token, amount } = grantArgs();
    const hash = await walletClient().writeContract({
      account: activeAccount(),
      address: token,
      abi: erc20Abi,
      chain,
      functionName: "approve",
      args: [factory, amount],
    });
    pushLog(`Escrow approval submitted: ${hash}`, "success");
  };

  const createGrant = async (): Promise<void> => {
    const factory = requireDeploymentAddress(deployment?.tokenGrantFactory, "TokenGrantFactory");
    const { tuple } = grantArgs();
    const hash = await walletClient().writeContract({
      account: activeAccount(),
      address: factory,
      abi: tokenGrantFactoryAbi,
      chain,
      functionName: "createGrant",
      args: tuple,
      value: creationFee,
    });
    pushLog(`Grant creation submitted: ${hash}`, "success");
  };

  const loadGrant = async (): Promise<void> => {
    const grant = requireAddress(grantAddress, "Grant address");
    const now = BigInt(Math.floor(Date.now() / 1000));
    const [issuer, holder, token, paymentToken, grantSize, claimable, price, expiry, settledAmount, halted, closed, settleable] =
      await Promise.all([
        publicClient.readContract({ address: grant, abi: tokenGrantAbi, functionName: "issuer" }),
        publicClient.readContract({ address: grant, abi: tokenGrantAbi, functionName: "holder" }),
        publicClient.readContract({ address: grant, abi: tokenGrantAbi, functionName: "token" }),
        publicClient.readContract({ address: grant, abi: tokenGrantAbi, functionName: "paymentToken" }),
        publicClient.readContract({ address: grant, abi: tokenGrantAbi, functionName: "grantSize" }),
        publicClient.readContract({ address: grant, abi: tokenGrantAbi, functionName: "claimable" }),
        publicClient.readContract({ address: grant, abi: tokenGrantAbi, functionName: "price" }),
        publicClient.readContract({ address: grant, abi: tokenGrantAbi, functionName: "expiry" }),
        publicClient.readContract({ address: grant, abi: tokenGrantAbi, functionName: "settledAmount" }),
        publicClient.readContract({ address: grant, abi: tokenGrantAbi, functionName: "vestingIsHalted" }),
        publicClient.readContract({ address: grant, abi: tokenGrantAbi, functionName: "isClosed" }),
        publicClient.readContract({ address: grant, abi: tokenGrantAbi, functionName: "getSettleableAmount", args: [now] }),
      ]);

    setGrantSnapshot({
      address: grant,
      issuer,
      holder,
      token,
      paymentToken,
      grantSize,
      claimable,
      price,
      expiry,
      settledAmount,
      halted,
      closed,
      settleable,
    });
    pushLog(`Loaded grant ${grant}`, "success");
  };

  const approvePayment = async (): Promise<void> => {
    if (!grantSnapshot) throw new Error("Load a grant first.");
    if (isZeroAddress(grantSnapshot.paymentToken)) throw new Error("Selected grant has no payment token.");

    const amount = uintInput(paymentApproval, "Payment approval");
    const hash = await walletClient().writeContract({
      account: activeAccount(),
      address: grantSnapshot.paymentToken,
      abi: erc20Abi,
      chain,
      functionName: "approve",
      args: [grantSnapshot.address, amount],
    });
    pushLog(`Payment approval submitted: ${hash}`, "success");
  };

  const settleGrant = async (): Promise<void> => {
    const grant = requireAddress(grantAddress, "Grant address");
    const amount = uintInput(settleAmount, "Settle amount");
    const hash = await walletClient().writeContract({
      account: activeAccount(),
      address: grant,
      abi: tokenGrantAbi,
      chain,
      functionName: "settle",
      args: [amount],
    });
    pushLog(`Settlement submitted: ${hash}`, "success");
  };

  const haltGrant = async (): Promise<void> => {
    const grant = requireAddress(grantAddress, "Grant address");
    const hash = await walletClient().writeContract({
      account: activeAccount(),
      address: grant,
      abi: tokenGrantAbi,
      chain,
      functionName: "stopVestingAndWithdrawUnvested",
    });
    pushLog(`Vesting halt submitted: ${hash}`, "success");
  };

  const withdrawExpired = async (): Promise<void> => {
    const grant = requireAddress(grantAddress, "Grant address");
    const hash = await walletClient().writeContract({
      account: activeAccount(),
      address: grant,
      abi: tokenGrantAbi,
      chain,
      functionName: "withdrawExpiredTokens",
    });
    pushLog(`Expired withdrawal submitted: ${hash}`, "success");
  };

  const predictBoardroom = async (): Promise<void> => {
    const factory = requireDeploymentAddress(deployment?.boardroomFactory, "BoardroomFactory");
    const owner = requireAddress(boardroomForm.owner, "Boardroom owner");
    const salt = requireBytes32(boardroomForm.salt, "Boardroom salt");
    const predicted = await publicClient.readContract({
      address: factory,
      abi: boardroomFactoryAbi,
      functionName: "predictBoardroomAddress",
      args: [owner, boardroomForm.name, boardroomForm.symbol, salt],
    });
    setPredictedBoardroom(predicted);
    setBoardroomAddress(predicted);
    pushLog(`Predicted Boardroom ${predicted}`, "success");
  };

  const createBoardroom = async (): Promise<void> => {
    const factory = requireDeploymentAddress(deployment?.boardroomFactory, "BoardroomFactory");
    const owner = requireAddress(boardroomForm.owner, "Boardroom owner");
    const salt = requireBytes32(boardroomForm.salt, "Boardroom salt");
    const hash = await walletClient().writeContract({
      account: activeAccount(),
      address: factory,
      abi: boardroomFactoryAbi,
      chain,
      functionName: "createBoardroom",
      args: [owner, boardroomForm.name, boardroomForm.symbol, salt],
    });
    pushLog(`Boardroom creation submitted: ${hash}`, "success");
  };

  const loadBoardroom = async (): Promise<void> => {
    const address = requireAddress(boardroomAddress, "Boardroom address");
    const [owner, policyRegistry, shareToken] = await Promise.all([
      publicClient.readContract({ address, abi: boardroomAbi, functionName: "owner" }),
      publicClient.readContract({ address, abi: boardroomAbi, functionName: "policyRegistry" }),
      publicClient.readContract({ address, abi: boardroomAbi, functionName: "shareToken" }),
    ]);
    setBoardroomSnapshot({ address, owner, policyRegistry, shareToken });
    setBoardroomMintTo(address);
    pushLog(`Loaded Boardroom ${address}`, "success");
  };

  const mintBoardroomShares = async (): Promise<void> => {
    const boardroom = boardroomSnapshot?.address ?? requireAddress(boardroomAddress, "Boardroom address");
    const to = boardroomMintTo.trim() ? requireAddress(boardroomMintTo, "Mint recipient") : boardroom;
    const amount = uintInput(boardroomMintAmount, "Mint amount");
    const hash = await walletClient().writeContract({
      account: activeAccount(),
      address: boardroom,
      abi: boardroomAbi,
      chain,
      functionName: "mint",
      args: [to, amount],
    });
    pushLog(`Share mint submitted: ${hash}`, "success");
  };

  const boardroomGrantArgs = () => {
    if (!boardroomSnapshot) throw new Error("Load a Boardroom first.");
    const holder = requireAddress(boardroomGrantForm.holder, "Grant holder");
    const paymentToken = optionalPaymentToken(boardroomGrantForm.paymentToken);
    const amount = uintInput(boardroomGrantForm.amount, "Grant amount");
    const price = uintInput(boardroomGrantForm.price, "Grant price");
    const expiry = uintInput(boardroomGrantForm.expiry, "Grant expiry");
    const vestingCliff = uintInput(boardroomGrantForm.vestingCliff, "Grant vesting cliff");
    const vestingEnd = uintInput(boardroomGrantForm.vestingEnd, "Grant vesting end");
    const transferUnlockTime = boardroomGrantForm.transferable
      ? uintInput(boardroomGrantForm.transferUnlockTime, "Grant transfer unlock time")
      : 0n;
    const salt = requireBytes32(boardroomGrantForm.salt, "Grant salt");

    return {
      holder,
      paymentToken,
      amount,
      price,
      expiry,
      vestingCliff,
      vestingEnd,
      transferable: boardroomGrantForm.transferable,
      transferUnlockTime,
      salt,
      tuple: [
        holder,
        boardroomSnapshot.shareToken,
        paymentToken,
        amount,
        price,
        expiry,
        vestingCliff,
        vestingEnd,
        boardroomGrantForm.transferable,
        transferUnlockTime,
        salt,
      ] as const,
    };
  };

  const predictBoardroomGrantAddress = async (): Promise<void> => {
    if (!boardroomSnapshot) throw new Error("Load a Boardroom first.");
    const factory = requireDeploymentAddress(deployment?.tokenGrantFactory, "TokenGrantFactory");
    const { salt } = boardroomGrantArgs();
    const predicted = await publicClient.readContract({
      address: factory,
      abi: tokenGrantFactoryAbi,
      functionName: "predictGrantAddress",
      args: [boardroomSnapshot.address, salt],
    });
    setPredictedBoardroomGrant(predicted);
    setGrantAddress(predicted);
    pushLog(`Predicted Boardroom grant ${predicted}`, "success");
  };

  const boardroomApproveFactory = async (): Promise<void> => {
    if (!boardroomSnapshot) throw new Error("Load a Boardroom first.");
    const factory = requireDeploymentAddress(deployment?.tokenGrantFactory, "TokenGrantFactory");
    const { amount } = boardroomGrantArgs();
    const data = encodeFunctionData({
      abi: boardroomTokenAbi,
      functionName: "approve",
      args: [factory, amount],
    });
    const hash = await walletClient().writeContract({
      account: activeAccount(),
      address: boardroomSnapshot.address,
      abi: boardroomAbi,
      chain,
      functionName: "execute",
      args: [
        {
          policy: factory,
          target: boardroomSnapshot.shareToken,
          value: 0n,
          data,
        },
      ],
    });
    pushLog(`Boardroom approval submitted: ${hash}`, "success");
  };

  const boardroomCreateGrant = async (): Promise<void> => {
    if (!boardroomSnapshot) throw new Error("Load a Boardroom first.");
    const factory = requireDeploymentAddress(deployment?.tokenGrantFactory, "TokenGrantFactory");
    const { tuple } = boardroomGrantArgs();
    const data = encodeFunctionData({
      abi: tokenGrantFactoryAbi,
      functionName: "createGrant",
      args: tuple,
    });
    const hash = await walletClient().writeContract({
      account: activeAccount(),
      address: boardroomSnapshot.address,
      abi: boardroomAbi,
      chain,
      functionName: "execute",
      args: [
        {
          policy: factory,
          target: factory,
          value: creationFee,
          data,
        },
      ],
      value: creationFee,
    });
    pushLog(`Boardroom grant creation submitted: ${hash}`, "success");
  };

  const grantFacts = useMemo(() => {
    if (!grantSnapshot) return [];
    return [
      { label: "Issuer", value: <AddressLink address={grantSnapshot.issuer} /> },
      { label: "Holder", value: <AddressLink address={grantSnapshot.holder} /> },
      { label: "Grant token", value: <AddressLink address={grantSnapshot.token} /> },
      {
        label: "Payment token",
        value: isZeroAddress(grantSnapshot.paymentToken) ? "None" : <AddressLink address={grantSnapshot.paymentToken} />,
      },
      { label: "Grant size", value: grantSnapshot.grantSize.toString() },
      { label: "Claimable", value: grantSnapshot.claimable.toString() },
      { label: "Settled", value: grantSnapshot.settledAmount.toString() },
      { label: "Settleable now", value: grantSnapshot.settleable.toString() },
      { label: "Price", value: grantSnapshot.price.toString() },
      { label: "Expiry", value: dateString(grantSnapshot.expiry) },
      { label: "Halted", value: grantSnapshot.halted ? "Yes" : "No" },
      { label: "Closed", value: grantSnapshot.closed ? "Yes" : "No" },
    ];
  }, [grantSnapshot]);

  return (
    <div className="min-h-svh text-zinc-100">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950/88 backdrop-blur">
        <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <a className="flex items-center gap-3 font-bold tracking-normal text-zinc-50" href="/" aria-label="pledge.cash">
            <span className="grid h-8 w-8 place-items-center rounded-md border border-lime-300/40 bg-lime-300/10 text-lime-200">
              p
            </span>
            <span>pledge.cash</span>
          </a>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={walletReady ? "default" : "warning"}>HyperEVM testnet</Badge>
            <Button variant="secondary" onClick={() => void runAction("switch-chain", switchChain)}>
              <RefreshCw className="h-4 w-4" />
              Switch
            </Button>
            <Button onClick={() => void runAction("connect-wallet", connectWallet)}>
              <Wallet className="h-4 w-4" />
              {wallet.account ? "Connected" : "Connect"}
            </Button>
          </div>
        </div>
      </header>

      <main className="grid min-h-[calc(100svh-64px)] grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="grid content-start gap-4 border-b border-zinc-800 bg-zinc-950/35 p-4 lg:border-b-0 lg:border-r">
          <Panel
            title="Deployment"
            action={<Badge variant={deployment?.tokenGrantFactory ? "default" : "warning"}>{deployment?.tokenGrantFactory ? "Ready" : "Pending"}</Badge>}
          >
            <Facts
              columns="one"
              items={[
                { label: "Chain", value: `${HYPEREVM_TESTNET_CHAIN_ID}` },
                {
                  label: "TokenGrantFactory",
                  value: deployment?.tokenGrantFactory ? <AddressLink address={deployment.tokenGrantFactory} /> : "Missing",
                },
                {
                  label: "TokenGrantLogic",
                  value: factorySnapshot.tokenGrantLogic ? <AddressLink address={factorySnapshot.tokenGrantLogic} /> : "Unknown",
                },
                {
                  label: "BoardroomFactory",
                  value: deployment?.boardroomFactory ? <AddressLink address={deployment.boardroomFactory} /> : "Not in artifact",
                },
                { label: "Creation fee", value: `${bigintString(creationFee)} wei` },
                {
                  label: "Factory owner",
                  value: factorySnapshot.owner ? <AddressLink address={factorySnapshot.owner} /> : "Unknown",
                },
              ]}
            />
          </Panel>

          <Panel title="Wallet">
            <Facts
              columns="one"
              items={[
                { label: "Address", value: wallet.account ? <AddressLink address={wallet.account} /> : "Not connected" },
                { label: "Chain", value: wallet.chainId ? `${wallet.chainId}` : "Unknown" },
              ]}
            />
          </Panel>

          <Panel title="Log" action={<Button variant="ghost" size="sm" onClick={() => setLogs([])}>Clear</Button>}>
            <div className="max-h-[320px] overflow-auto border-t border-zinc-800">
              {logs.length === 0 ? (
                <p className="m-0 p-4 text-sm text-zinc-500">No entries</p>
              ) : (
                <ol className="grid gap-px bg-zinc-800">
                  {logs.map((entry) => (
                    <li className="bg-zinc-950 p-3" key={entry.id}>
                      <div className="mb-1 flex items-center gap-2 text-xs text-zinc-500">
                        {entry.level === "error" ? (
                          <AlertTriangle className="h-3.5 w-3.5 text-red-300" />
                        ) : entry.level === "success" ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-lime-300" />
                        ) : null}
                        <span>{entry.time}</span>
                      </div>
                      <p className="m-0 break-words text-sm text-zinc-200">{entry.message}</p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </Panel>

          <Panel title="Artifact">
            <pre className="m-0 max-h-[260px] overflow-auto border-t border-zinc-800 p-4 text-xs leading-5 text-zinc-400">
              {deploymentText(deployment)}
            </pre>
          </Panel>
        </aside>

        <section className="min-w-0 p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <TabButton active={activeTab === "direct"} onClick={() => setActiveTab("direct")}>
              Direct Grant
            </TabButton>
            <TabButton active={activeTab === "grant"} onClick={() => setActiveTab("grant")}>
              Inspect Grant
            </TabButton>
            <TabButton active={activeTab === "boardroom"} onClick={() => setActiveTab("boardroom")}>
              Boardroom
            </TabButton>
          </div>

          {activeTab === "direct" ? (
            <div className="grid gap-4">
              <Panel
                title="Create Direct Grant"
                action={
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setGrantForm((current) => ({ ...current, salt: randomSalt() }));
                      setPredictedGrant(undefined);
                    }}
                  >
                    <Wand2 className="h-4 w-4" />
                    Salt
                  </Button>
                }
              >
                <div className="grid grid-cols-1 border-t border-zinc-800 md:grid-cols-2">
                  <Field label="Holder">
                    <Input value={grantForm.holder} onChange={(event) => setGrantFormField("holder", event.target.value, setGrantForm)} spellCheck={false} />
                  </Field>
                  <Field label="Grant token">
                    <Input value={grantForm.token} onChange={(event) => setGrantFormField("token", event.target.value, setGrantForm)} spellCheck={false} />
                  </Field>
                  <Field label="Payment token">
                    <Input value={grantForm.paymentToken} onChange={(event) => setGrantFormField("paymentToken", event.target.value, setGrantForm)} spellCheck={false} />
                  </Field>
                  <Field label="Amount raw units">
                    <Input value={grantForm.amount} inputMode="numeric" onChange={(event) => setGrantFormField("amount", event.target.value, setGrantForm)} />
                  </Field>
                  <Field label="Price raw units">
                    <Input value={grantForm.price} inputMode="numeric" onChange={(event) => setGrantFormField("price", event.target.value, setGrantForm)} />
                  </Field>
                  <Field label="Vesting cliff timestamp">
                    <Input value={grantForm.vestingCliff} inputMode="numeric" onChange={(event) => setGrantFormField("vestingCliff", event.target.value, setGrantForm)} />
                  </Field>
                  <Field label="Vesting end timestamp">
                    <Input value={grantForm.vestingEnd} inputMode="numeric" onChange={(event) => setGrantFormField("vestingEnd", event.target.value, setGrantForm)} />
                  </Field>
                  <Field label="Expiry timestamp">
                    <Input value={grantForm.expiry} inputMode="numeric" onChange={(event) => setGrantFormField("expiry", event.target.value, setGrantForm)} />
                  </Field>
                  <Field label="Transferable">
                    <label className="flex h-10 items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-200">
                      <input
                        checked={grantForm.transferable}
                        className="h-4 w-4 accent-lime-300"
                        type="checkbox"
                        onChange={(event) => setGrantFormField("transferable", event.target.checked, setGrantForm)}
                      />
                      Enabled
                    </label>
                  </Field>
                  <Field label="Transfer unlock timestamp">
                    <Input
                      disabled={!grantForm.transferable}
                      value={grantForm.transferUnlockTime}
                      inputMode="numeric"
                      onChange={(event) => setGrantFormField("transferUnlockTime", event.target.value, setGrantForm)}
                    />
                  </Field>
                  <Field className="md:col-span-2" label="Salt">
                    <Input value={grantForm.salt} onChange={(event) => setGrantFormField("salt", event.target.value, setGrantForm)} spellCheck={false} />
                  </Field>
                </div>
                <ActionRow>
                  <ActionButton actionId="predict-grant" pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("predict-grant", predictGrant)}>
                    <Search className="h-4 w-4" />
                    Predict
                  </ActionButton>
                  <ActionButton actionId="approve-escrow" pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("approve-escrow", approveEscrow)}>
                    <CheckCircle2 className="h-4 w-4" />
                    Approve Factory
                  </ActionButton>
                  <ActionButton actionId="create-grant" pendingAction={pendingAction} onClick={() => void runAction("create-grant", createGrant)}>
                    <Send className="h-4 w-4" />
                    Create Grant
                  </ActionButton>
                </ActionRow>
                <Facts
                  columns="one"
                  items={[
                    { label: "Predicted grant", value: predictedGrant ? <AddressLink address={predictedGrant} /> : "None" },
                    { label: "Issuer", value: wallet.account ? <AddressLink address={wallet.account} /> : "Connect wallet" },
                    { label: "Creation fee", value: `${creationFee.toString()} wei` },
                  ]}
                />
              </Panel>
            </div>
          ) : null}

          {activeTab === "grant" ? (
            <div className="grid gap-4">
              <Panel
                title="Inspect Grant"
                action={
                  <ActionButton actionId="load-grant" pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("load-grant", loadGrant)}>
                    <RefreshCw className="h-4 w-4" />
                    Load
                  </ActionButton>
                }
              >
                <div className="border-t border-zinc-800">
                  <Field label="Grant address">
                    <Input value={grantAddress} onChange={(event) => setGrantAddress(event.target.value)} spellCheck={false} />
                  </Field>
                </div>
                <Facts columns="three" items={grantFacts} />
              </Panel>

              <Panel title="Grant Actions">
                <div className="grid grid-cols-1 border-t border-zinc-800 md:grid-cols-2">
                  <Field label="Settle amount raw units">
                    <Input value={settleAmount} inputMode="numeric" onChange={(event) => setSettleAmount(event.target.value)} />
                  </Field>
                  <Field label="Payment approval raw units">
                    <Input value={paymentApproval} inputMode="numeric" onChange={(event) => setPaymentApproval(event.target.value)} />
                  </Field>
                </div>
                <ActionRow>
                  <ActionButton actionId="approve-payment" pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("approve-payment", approvePayment)}>
                    <CheckCircle2 className="h-4 w-4" />
                    Approve Payment
                  </ActionButton>
                  <ActionButton actionId="settle-grant" pendingAction={pendingAction} onClick={() => void runAction("settle-grant", settleGrant)}>
                    <Send className="h-4 w-4" />
                    Settle
                  </ActionButton>
                  <ActionButton actionId="halt-grant" pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("halt-grant", haltGrant)}>
                    <ArchiveRestore className="h-4 w-4" />
                    Halt Vesting
                  </ActionButton>
                  <ActionButton actionId="withdraw-expired" pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("withdraw-expired", withdrawExpired)}>
                    <ArchiveRestore className="h-4 w-4" />
                    Withdraw Expired
                  </ActionButton>
                </ActionRow>
              </Panel>
            </div>
          ) : null}

          {activeTab === "boardroom" ? (
            <div className="grid gap-4">
              <Panel
                title="Create Boardroom"
                action={
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setBoardroomForm((current) => ({ ...current, salt: randomSalt() }));
                      setPredictedBoardroom(undefined);
                    }}
                  >
                    <Wand2 className="h-4 w-4" />
                    Salt
                  </Button>
                }
              >
                <div className="grid grid-cols-1 border-t border-zinc-800 md:grid-cols-2">
                  <Field label="Owner">
                    <Input value={boardroomForm.owner} onChange={(event) => setBoardroomField("owner", event.target.value, setBoardroomForm)} spellCheck={false} />
                  </Field>
                  <Field label="Name">
                    <Input value={boardroomForm.name} onChange={(event) => setBoardroomField("name", event.target.value, setBoardroomForm)} />
                  </Field>
                  <Field label="Symbol">
                    <Input value={boardroomForm.symbol} onChange={(event) => setBoardroomField("symbol", event.target.value, setBoardroomForm)} />
                  </Field>
                  <Field label="Salt">
                    <Input value={boardroomForm.salt} onChange={(event) => setBoardroomField("salt", event.target.value, setBoardroomForm)} spellCheck={false} />
                  </Field>
                </div>
                <ActionRow>
                  <ActionButton actionId="predict-boardroom" disabled={!deployment?.boardroomFactory} pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("predict-boardroom", predictBoardroom)}>
                    <Search className="h-4 w-4" />
                    Predict
                  </ActionButton>
                  <ActionButton actionId="create-boardroom" disabled={!deployment?.boardroomFactory} pendingAction={pendingAction} onClick={() => void runAction("create-boardroom", createBoardroom)}>
                    <Plus className="h-4 w-4" />
                    Create
                  </ActionButton>
                </ActionRow>
                <Facts
                  columns="one"
                  items={[
                    { label: "Predicted Boardroom", value: predictedBoardroom ? <AddressLink address={predictedBoardroom} /> : "None" },
                    { label: "Factory", value: deployment?.boardroomFactory ? <AddressLink address={deployment.boardroomFactory} /> : "Not in artifact" },
                  ]}
                />
              </Panel>

              <Panel
                title="Boardroom Account"
                action={
                  <ActionButton actionId="load-boardroom" pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("load-boardroom", loadBoardroom)}>
                    <RefreshCw className="h-4 w-4" />
                    Load
                  </ActionButton>
                }
              >
                <div className="border-t border-zinc-800">
                  <Field label="Boardroom address">
                    <Input value={boardroomAddress} onChange={(event) => setBoardroomAddress(event.target.value)} spellCheck={false} />
                  </Field>
                </div>
                <Facts
                  columns="three"
                  items={[
                    {
                      label: "Owner",
                      value: boardroomSnapshot?.owner ? <AddressLink address={boardroomSnapshot.owner} /> : "Unknown",
                    },
                    {
                      label: "Policy registry",
                      value: boardroomSnapshot?.policyRegistry ? <AddressLink address={boardroomSnapshot.policyRegistry} /> : "Unknown",
                    },
                    {
                      label: "Share token",
                      value: boardroomSnapshot?.shareToken ? <AddressLink address={boardroomSnapshot.shareToken} /> : "Unknown",
                    },
                  ]}
                />
              </Panel>

              <Panel title="Boardroom Shares">
                <div className="grid grid-cols-1 border-t border-zinc-800 md:grid-cols-2">
                  <Field label="Mint recipient">
                    <Input value={boardroomMintTo} onChange={(event) => setBoardroomMintTo(event.target.value)} spellCheck={false} />
                  </Field>
                  <Field label="Mint amount raw units">
                    <Input value={boardroomMintAmount} inputMode="numeric" onChange={(event) => setBoardroomMintAmount(event.target.value)} />
                  </Field>
                </div>
                <ActionRow>
                  <ActionButton actionId="mint-boardroom-shares" pendingAction={pendingAction} onClick={() => void runAction("mint-boardroom-shares", mintBoardroomShares)}>
                    <Plus className="h-4 w-4" />
                    Mint Shares
                  </ActionButton>
                </ActionRow>
              </Panel>

              <Panel
                title="Boardroom Share Grant"
                action={
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setBoardroomGrantForm((current) => ({ ...current, salt: randomSalt() }));
                      setPredictedBoardroomGrant(undefined);
                    }}
                  >
                    <Wand2 className="h-4 w-4" />
                    Salt
                  </Button>
                }
              >
                <div className="grid grid-cols-1 border-t border-zinc-800 md:grid-cols-2">
                  <Field label="Holder">
                    <Input value={boardroomGrantForm.holder} onChange={(event) => setBoardroomGrantField("holder", event.target.value, setBoardroomGrantForm)} spellCheck={false} />
                  </Field>
                  <Field label="Payment token">
                    <Input value={boardroomGrantForm.paymentToken} onChange={(event) => setBoardroomGrantField("paymentToken", event.target.value, setBoardroomGrantForm)} spellCheck={false} />
                  </Field>
                  <Field label="Amount raw units">
                    <Input value={boardroomGrantForm.amount} inputMode="numeric" onChange={(event) => setBoardroomGrantField("amount", event.target.value, setBoardroomGrantForm)} />
                  </Field>
                  <Field label="Price raw units">
                    <Input value={boardroomGrantForm.price} inputMode="numeric" onChange={(event) => setBoardroomGrantField("price", event.target.value, setBoardroomGrantForm)} />
                  </Field>
                  <Field label="Vesting cliff timestamp">
                    <Input value={boardroomGrantForm.vestingCliff} inputMode="numeric" onChange={(event) => setBoardroomGrantField("vestingCliff", event.target.value, setBoardroomGrantForm)} />
                  </Field>
                  <Field label="Vesting end timestamp">
                    <Input value={boardroomGrantForm.vestingEnd} inputMode="numeric" onChange={(event) => setBoardroomGrantField("vestingEnd", event.target.value, setBoardroomGrantForm)} />
                  </Field>
                  <Field label="Expiry timestamp">
                    <Input value={boardroomGrantForm.expiry} inputMode="numeric" onChange={(event) => setBoardroomGrantField("expiry", event.target.value, setBoardroomGrantForm)} />
                  </Field>
                  <Field label="Transferable">
                    <label className="flex h-10 items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-200">
                      <input
                        checked={boardroomGrantForm.transferable}
                        className="h-4 w-4 accent-lime-300"
                        type="checkbox"
                        onChange={(event) => setBoardroomGrantField("transferable", event.target.checked, setBoardroomGrantForm)}
                      />
                      Enabled
                    </label>
                  </Field>
                  <Field label="Transfer unlock timestamp">
                    <Input
                      disabled={!boardroomGrantForm.transferable}
                      value={boardroomGrantForm.transferUnlockTime}
                      inputMode="numeric"
                      onChange={(event) => setBoardroomGrantField("transferUnlockTime", event.target.value, setBoardroomGrantForm)}
                    />
                  </Field>
                  <Field className="md:col-span-2" label="Salt">
                    <Input value={boardroomGrantForm.salt} onChange={(event) => setBoardroomGrantField("salt", event.target.value, setBoardroomGrantForm)} spellCheck={false} />
                  </Field>
                </div>
                <ActionRow>
                  <ActionButton actionId="predict-boardroom-grant" pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("predict-boardroom-grant", predictBoardroomGrantAddress)}>
                    <Search className="h-4 w-4" />
                    Predict
                  </ActionButton>
                  <ActionButton actionId="boardroom-approve-factory" pendingAction={pendingAction} variant="secondary" onClick={() => void runAction("boardroom-approve-factory", boardroomApproveFactory)}>
                    <CheckCircle2 className="h-4 w-4" />
                    Approve Factory
                  </ActionButton>
                  <ActionButton actionId="boardroom-create-grant" pendingAction={pendingAction} onClick={() => void runAction("boardroom-create-grant", boardroomCreateGrant)}>
                    <Send className="h-4 w-4" />
                    Create Grant
                  </ActionButton>
                </ActionRow>
                <Facts
                  columns="one"
                  items={[
                    { label: "Predicted grant", value: predictedBoardroomGrant ? <AddressLink address={predictedBoardroomGrant} /> : "None" },
                    {
                      label: "Share token",
                      value: boardroomSnapshot?.shareToken ? <AddressLink address={boardroomSnapshot.shareToken} /> : "Load Boardroom",
                    },
                  ]}
                />
              </Panel>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}

function setGrantFormField<K extends keyof GrantForm>(
  key: K,
  value: GrantForm[K],
  setter: React.Dispatch<React.SetStateAction<GrantForm>>,
): void {
  setter((current) => ({ ...current, [key]: value }));
}

function setBoardroomField<K extends keyof BoardroomForm>(
  key: K,
  value: BoardroomForm[K],
  setter: React.Dispatch<React.SetStateAction<BoardroomForm>>,
): void {
  setter((current) => ({ ...current, [key]: value }));
}

function setBoardroomGrantField<K extends keyof BoardroomGrantForm>(
  key: K,
  value: BoardroomGrantForm[K],
  setter: React.Dispatch<React.SetStateAction<BoardroomGrantForm>>,
): void {
  setter((current) => ({ ...current, [key]: value }));
}

function Panel({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <section className={cn("min-w-0 rounded-lg border border-zinc-800 bg-zinc-950/82", className)}>
      <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-3">
        <h2 className="m-0 text-base font-semibold tracking-normal text-zinc-50">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <Label className={cn("min-w-0 border-b border-zinc-800 p-4 md:border-r [&:nth-child(2n)]:md:border-r-0", className)}>
      <span>{label}</span>
      {children}
    </Label>
  );
}

function Facts({
  items,
  columns = "two",
}: {
  items: { label: string; value: ReactNode }[];
  columns?: "one" | "two" | "three";
}): React.JSX.Element {
  if (items.length === 0) {
    return <div className="border-t border-zinc-800 p-4 text-sm text-zinc-500">No data</div>;
  }

  return (
    <dl
      className={cn(
        "grid gap-px border-t border-zinc-800 bg-zinc-800",
        columns === "one" && "grid-cols-1",
        columns === "two" && "grid-cols-1 md:grid-cols-2",
        columns === "three" && "grid-cols-1 md:grid-cols-2 xl:grid-cols-3",
      )}
    >
      {items.map((item) => (
        <div className="min-w-0 bg-zinc-950 p-4" key={item.label}>
          <dt className="mb-1 text-xs font-medium text-zinc-500">{item.label}</dt>
          <dd className="m-0 break-words text-sm font-semibold text-zinc-100">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ActionRow({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="flex flex-wrap gap-2 border-t border-zinc-800 p-4">{children}</div>;
}

function ActionButton({
  actionId,
  pendingAction,
  children,
  disabled,
  ...props
}: React.ComponentProps<typeof Button> & {
  actionId: string;
  pendingAction: string | undefined;
}): React.JSX.Element {
  const pending = pendingAction === actionId;
  return (
    <Button disabled={disabled || pendingAction !== undefined} {...props}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : children}
    </Button>
  );
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      className={cn(
        "h-9 rounded-md border px-3 text-sm font-semibold transition-colors",
        active ? "border-lime-300 bg-lime-300 text-zinc-950" : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:bg-zinc-900",
      )}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function AddressLink({ address }: { address: Address }): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  const copyAddress = async (): Promise<void> => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <span className="inline-flex max-w-full items-center gap-1.5 align-middle">
      <a
        className="min-w-0 truncate text-lime-200 hover:text-lime-100"
        href={addressUrl(address)}
        rel="noreferrer"
        target="_blank"
        title={address}
      >
        {shortAddress(address)}
      </a>
      <button
        aria-label="Copy address"
        className="grid h-6 w-6 shrink-0 place-items-center rounded border border-zinc-800 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
        type="button"
        onClick={() => void copyAddress()}
      >
        {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-lime-300" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      <a
        aria-label="Open in explorer"
        className="grid h-6 w-6 shrink-0 place-items-center rounded border border-zinc-800 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
        href={addressUrl(address)}
        rel="noreferrer"
        target="_blank"
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </span>
  );
}

export function TransactionLink({ hash }: { hash: Hex }): React.JSX.Element {
  return (
    <a className="text-lime-200 hover:text-lime-100" href={transactionUrl(hash)} rel="noreferrer" target="_blank">
      {shortAddress(hash)}
    </a>
  );
}
