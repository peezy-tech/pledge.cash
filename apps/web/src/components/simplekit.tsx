import { Check, ChevronLeft, Copy, RotateCcw, Wallet } from "lucide-react";
import * as React from "react";
import { formatUnits } from "viem";
import {
  type Connector,
  useAccount,
  useBalance,
  useConnect,
  useDisconnect,
} from "wagmi";
import {
  SimpleKitModal,
  SimpleKitModalBody,
  SimpleKitModalContent,
  SimpleKitModalDescription,
  SimpleKitModalFooter,
  SimpleKitModalHeader,
  SimpleKitModalTitle,
} from "./simplekit-modal";
import { Button } from "./ui/button";
import { networkForChainId } from "../lib/contracts";
import { shortAddress } from "../lib/forms";
import { cn } from "../lib/utils";

const MODAL_CLOSE_DURATION = 320;
const PREFERRED_CONNECTOR_ORDER = ["injected", "metaMask", "metaMaskSDK", "safe"];

type SimpleKitState = {
  pendingConnector: Connector | null;
  setPendingConnector: React.Dispatch<React.SetStateAction<Connector | null>>;
  isConnectorError: boolean;
  setIsConnectorError: React.Dispatch<React.SetStateAction<boolean>>;
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

type ConnectWalletButtonProps = {
  className?: string | undefined;
  disabled?: boolean | undefined;
};

type WalletOptionProps = {
  connector: Connector;
  onClick: () => void;
};

type SimpleKitApi = {
  close: () => void;
  formattedAddress: string;
  isConnected: boolean;
  isModalOpen: boolean;
  open: () => void;
  toggleModal: () => void;
};

type ConnectorsResult = {
  connectors: Connector[];
  connect: ReturnType<typeof useConnect>["connect"];
};

type UserBalance = {
  value: bigint;
  decimals: number;
  symbol?: string | undefined;
} | undefined;

type Network = ReturnType<typeof networkForChainId> | undefined;

const SimpleKitContext = React.createContext<SimpleKitState>({
  pendingConnector: null,
  setPendingConnector: () => null,
  isConnectorError: false,
  setIsConnectorError: () => false,
  open: false,
  setOpen: () => false,
});

function SimpleKitProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { address, status } = useAccount();
  const [pendingConnector, setPendingConnector] = React.useState<Connector | null>(null);
  const [isConnectorError, setIsConnectorError] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const isConnectedAccount = address !== undefined && pendingConnector === null;
  const modalContent = isConnectedAccount ? <Account /> : <Connectors />;
  const contextValue = React.useMemo(
    () => ({
      pendingConnector,
      setPendingConnector,
      isConnectorError,
      setIsConnectorError,
      open,
      setOpen,
    }),
    [isConnectorError, open, pendingConnector],
  );

  React.useEffect(() => {
    if (status !== "connected") return;
    if (!pendingConnector) return;

    setOpen(false);
    const timeout = window.setTimeout(() => {
      setPendingConnector(null);
      setIsConnectorError(false);
    }, MODAL_CLOSE_DURATION);
    return () => window.clearTimeout(timeout);
  }, [pendingConnector, status]);

  return (
    <SimpleKitContext.Provider value={contextValue}>
      {children}
      <SimpleKitModal open={open} onOpenChange={setOpen}>
        <SimpleKitModalContent>{modalContent}</SimpleKitModalContent>
      </SimpleKitModal>
    </SimpleKitContext.Provider>
  );
}

function ConnectWalletButton({ className, disabled }: ConnectWalletButtonProps): React.JSX.Element {
  const simplekit = useSimpleKit();
  const buttonLabel = simplekit.isConnected ? simplekit.formattedAddress : "Connect Wallet";

  return (
    <Button
      className={cn("min-w-[9.5rem]", className)}
      disabled={disabled}
      type="button"
      onClick={simplekit.toggleModal}
    >
      <Wallet className="h-4 w-4" />
      <span className="truncate">{buttonLabel}</span>
    </Button>
  );
}

function Account(): React.JSX.Element {
  const { address, chainId } = useAccount();
  const { disconnect } = useDisconnect();
  const { data: userBalance } = useBalance({ address });
  const context = React.useContext(SimpleKitContext);
  const network = chainId ? networkForChainId(chainId) : undefined;
  const formattedAddress = address ? shortAddress(address) : "";
  const formattedBalance = formatWalletBalance(userBalance);
  const chainName = network?.name ?? `Chain ${chainId ?? "unknown"}`;
  const balanceSymbol = walletBalanceSymbol(userBalance, network);

  function handleDisconnect(): void {
    context.setOpen(false);
    window.setTimeout(() => disconnect(), MODAL_CLOSE_DURATION);
  }

  return (
    <>
      <SimpleKitModalHeader>
        <SimpleKitModalTitle>Connected</SimpleKitModalTitle>
        <SimpleKitModalDescription className="sr-only">Account modal for your connected wallet.</SimpleKitModalDescription>
      </SimpleKitModalHeader>
      <SimpleKitModalBody className="h-[286px]">
        <div className="flex h-full w-full flex-col items-center justify-center gap-6">
          <WalletAvatar address={address} />

          <div className="min-w-0 space-y-2 text-center">
            <div className="flex items-center justify-center gap-1.5">
              <h2 className="m-0 text-xl font-semibold text-zinc-50">{formattedAddress}</h2>
              <CopyAddressButton />
            </div>
            <p className="m-0 text-sm font-medium text-zinc-500">{chainName}</p>
            <p className="m-0 text-sm text-zinc-400">
              {formattedBalance} {balanceSymbol}
            </p>
          </div>

          <Button className="w-full" type="button" onClick={handleDisconnect}>
            Disconnect
          </Button>
        </div>
      </SimpleKitModalBody>
    </>
  );
}

function Connectors(): React.JSX.Element {
  const context = React.useContext(SimpleKitContext);
  const pendingConnector = context.pendingConnector;
  const title = pendingConnector?.name ?? "Connect Wallet";

  return (
    <>
      <SimpleKitModalHeader>
        <BackChevron />
        <SimpleKitModalTitle>{title}</SimpleKitModalTitle>
        <SimpleKitModalDescription className="sr-only">Connect your wallet.</SimpleKitModalDescription>
      </SimpleKitModalHeader>
      <SimpleKitModalBody>{pendingConnector ? <WalletConnecting /> : <WalletOptions />}</SimpleKitModalBody>
      <SimpleKitModalFooter>
        <div className="h-0" />
      </SimpleKitModalFooter>
    </>
  );
}

function WalletAvatar({ address }: { address: string | undefined }): React.JSX.Element {
  const style = React.useMemo(() => walletAvatarStyle(address), [address]);
  const label = address ? address.slice(2, 4).toUpperCase() : "0X";

  return (
    <div
      aria-hidden="true"
      className="grid h-20 w-20 place-items-center rounded-full border border-lime-300/30 text-base font-bold text-zinc-950 shadow-lg shadow-lime-300/5"
      style={style}
    >
      {label}
    </div>
  );
}

function WalletConnecting(): React.JSX.Element {
  const context = React.useContext(SimpleKitContext);
  const isError = context.isConnectorError;
  const title = isError ? "Request Error" : "Requesting Connection";
  const description = isError
    ? "There was an error with the request. Retry or choose another wallet."
    : `Open ${context.pendingConnector?.name ?? "your wallet"} to finish connecting.`;

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-7">
      <div className="relative grid h-24 w-24 place-items-center rounded-lg border border-zinc-800 bg-zinc-900">
        <Wallet className="h-8 w-8 text-lime-200" />
        {isError ? <RetryConnectorButton /> : null}
      </div>

      <div className="space-y-3 text-center">
        <h2 className="m-0 text-xl font-semibold text-zinc-50">{title}</h2>
        <p className="m-0 text-sm leading-6 text-zinc-500">{description}</p>
      </div>
    </div>
  );
}

function WalletOptions(): React.JSX.Element {
  const context = React.useContext(SimpleKitContext);
  const { connect, connectors } = useConnectors();

  function chooseConnector(connector: Connector): void {
    context.setIsConnectorError(false);
    context.setPendingConnector(connector);
    connect({ connector });
  }

  return (
    <div className="flex flex-col gap-3.5">
      {connectors.map((connector) => (
        <WalletOption connector={connector} key={connector.uid} onClick={() => chooseConnector(connector)} />
      ))}
    </div>
  );
}

function WalletOption({ connector, onClick }: WalletOptionProps): React.JSX.Element {
  return (
    <Button
      className="h-14 justify-between border-zinc-800 bg-zinc-950 px-4 text-base text-zinc-100 hover:bg-zinc-900"
      type="button"
      variant="secondary"
      onClick={onClick}
    >
      <span>{connector.name}</span>
      <Wallet className="h-5 w-5 text-zinc-500" />
    </Button>
  );
}

function CopyAddressButton(): React.JSX.Element {
  const { address } = useAccount();
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;

    const timeout = window.setTimeout(() => {
      setCopied(false);
    }, 1000);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  async function handleCopy(): Promise<void> {
    if (!address) return;
    setCopied(true);
    await navigator.clipboard.writeText(address);
  }

  return (
    <button
      aria-label="Copy address"
      className="grid h-7 w-7 place-items-center rounded-md border border-zinc-800 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-100"
      type="button"
      onClick={() => void handleCopy()}
    >
      {copied ? <Check className="h-4 w-4 text-lime-300" strokeWidth={3} /> : <Copy className="h-4 w-4" />}
    </button>
  );
}

function BackChevron(): React.JSX.Element | null {
  const context = React.useContext(SimpleKitContext);

  if (!context.pendingConnector) return null;

  function cancelConnection(): void {
    context.setIsConnectorError(false);
    context.setPendingConnector(null);
  }

  return (
    <button
      className="absolute left-5 top-5 z-50 grid h-8 w-8 place-items-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-lime-300/70"
      type="button"
      onClick={cancelConnection}
    >
      <ChevronLeft className="h-4 w-4" />
      <span className="sr-only">Cancel connection</span>
    </button>
  );
}

function RetryConnectorButton(): React.JSX.Element {
  const context = React.useContext(SimpleKitContext);
  const { connect } = useConnect({
    mutation: {
      onError: () => context.setIsConnectorError(true),
    },
  });

  return (
    <Button
      className="group absolute -bottom-2 -right-2 h-9 w-9 rounded-full border-zinc-800 bg-zinc-950 p-0"
      type="button"
      variant="secondary"
      onClick={() => retryConnector(context, connect)}
    >
      <RotateCcw className="h-4 w-4 transition-transform group-hover:-rotate-45" />
    </Button>
  );
}

function useConnectors(): ConnectorsResult {
  const context = React.useContext(SimpleKitContext);
  const { connect, connectors } = useConnect({
    mutation: {
      onError: () => context.setIsConnectorError(true),
    },
  });

  const sortedConnectors = React.useMemo(() => {
    return [...connectors].sort((left, right) => connectorRank(left) - connectorRank(right));
  }, [connectors]);

  return { connect, connectors: sortedConnectors };
}

function useSimpleKit(): SimpleKitApi {
  const { address } = useAccount();
  const context = React.useContext(SimpleKitContext);
  const isConnected = address !== undefined && context.pendingConnector === null;
  const formattedAddress = address ? shortAddress(address) : "";

  return {
    close: () => context.setOpen(false),
    formattedAddress,
    isConnected,
    isModalOpen: context.open,
    open: () => context.setOpen(true),
    toggleModal: () => context.setOpen((current) => !current),
  };
}

function retryConnector(context: SimpleKitState, connect: ReturnType<typeof useConnect>["connect"]): void {
  if (!context.pendingConnector) return;

  context.setIsConnectorError(false);
  connect({ connector: context.pendingConnector });
}

function connectorRank(connector: Connector): number {
  const preferredIndex = PREFERRED_CONNECTOR_ORDER.indexOf(connector.id);
  return preferredIndex === -1 ? PREFERRED_CONNECTOR_ORDER.length : preferredIndex;
}

function formatWalletBalance(userBalance: UserBalance): string {
  if (userBalance?.value === undefined) return "0";

  return Number(formatUnits(userBalance.value, userBalance.decimals)).toLocaleString(undefined, {
    maximumFractionDigits: 4,
  });
}

function walletBalanceSymbol(userBalance: UserBalance, network: Network): string {
  return userBalance?.symbol ?? network?.chain.nativeCurrency.symbol ?? "";
}

function walletAvatarStyle(address: string | undefined): React.CSSProperties {
  const seed = (address ?? "0x00").replace(/^0x/i, "").padEnd(12, "0");
  const firstHue = Number.parseInt(seed.slice(0, 6), 16) % 360;
  const secondHue = Number.parseInt(seed.slice(6, 12), 16) % 360;

  return {
    background: [
      "radial-gradient(circle at 32% 28%, rgba(244, 244, 245, 0.86), rgba(244, 244, 245, 0) 26%)",
      `linear-gradient(135deg, hsl(${firstHue} 88% 62%), hsl(${secondHue} 84% 48%))`,
    ].join(", "),
  };
}

export { ConnectWalletButton, SimpleKitContext, SimpleKitProvider, useSimpleKit };
