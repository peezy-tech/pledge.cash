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

type SimpleKitState = {
  pendingConnector: Connector | null;
  setPendingConnector: React.Dispatch<React.SetStateAction<Connector | null>>;
  isConnectorError: boolean;
  setIsConnectorError: React.Dispatch<React.SetStateAction<boolean>>;
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

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
  const isConnected = address !== undefined && pendingConnector === null;

  React.useEffect(() => {
    if (status !== "connected" || !pendingConnector) return;

    setOpen(false);
    const timeout = window.setTimeout(() => {
      setPendingConnector(null);
      setIsConnectorError(false);
    }, MODAL_CLOSE_DURATION);
    return () => window.clearTimeout(timeout);
  }, [pendingConnector, status]);

  return (
    <SimpleKitContext.Provider
      value={{
        pendingConnector,
        setPendingConnector,
        isConnectorError,
        setIsConnectorError,
        open,
        setOpen,
      }}
    >
      {children}
      <SimpleKitModal open={open} onOpenChange={setOpen}>
        <SimpleKitModalContent>{isConnected ? <Account /> : <Connectors />}</SimpleKitModalContent>
      </SimpleKitModal>
    </SimpleKitContext.Provider>
  );
}

function ConnectWalletButton({
  className,
  disabled,
}: {
  className?: string | undefined;
  disabled?: boolean | undefined;
}): React.JSX.Element {
  const simplekit = useSimpleKit();

  return (
    <Button
      className={cn("min-w-[9.5rem]", className)}
      disabled={disabled}
      type="button"
      onClick={simplekit.toggleModal}
    >
      <Wallet className="h-4 w-4" />
      <span className="truncate">{simplekit.isConnected ? simplekit.formattedAddress : "Connect Wallet"}</span>
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
  const formattedBalance =
    userBalance?.value !== undefined
      ? Number(formatUnits(userBalance.value, userBalance.decimals)).toLocaleString(undefined, {
          maximumFractionDigits: 4,
        })
      : "0";

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
            <p className="m-0 text-sm font-medium text-zinc-500">{network?.name ?? `Chain ${chainId ?? "unknown"}`}</p>
            <p className="m-0 text-sm text-zinc-400">
              {formattedBalance} {userBalance?.symbol ?? network?.chain.nativeCurrency.symbol ?? ""}
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

  return (
    <>
      <SimpleKitModalHeader>
        <BackChevron />
        <SimpleKitModalTitle>{context.pendingConnector?.name ?? "Connect Wallet"}</SimpleKitModalTitle>
        <SimpleKitModalDescription className="sr-only">Connect your wallet.</SimpleKitModalDescription>
      </SimpleKitModalHeader>
      <SimpleKitModalBody>{context.pendingConnector ? <WalletConnecting /> : <WalletOptions />}</SimpleKitModalBody>
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

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-7">
      <div className="relative grid h-24 w-24 place-items-center rounded-lg border border-zinc-800 bg-zinc-900">
        <Wallet className="h-8 w-8 text-lime-200" />
        {context.isConnectorError ? <RetryConnectorButton /> : null}
      </div>

      <div className="space-y-3 text-center">
        <h2 className="m-0 text-xl font-semibold text-zinc-50">
          {context.isConnectorError ? "Request Error" : "Requesting Connection"}
        </h2>
        <p className="m-0 text-sm leading-6 text-zinc-500">
          {context.isConnectorError
            ? "There was an error with the request. Retry or choose another wallet."
            : `Open ${context.pendingConnector?.name ?? "your wallet"} to finish connecting.`}
        </p>
      </div>
    </div>
  );
}

function WalletOptions(): React.JSX.Element {
  const context = React.useContext(SimpleKitContext);
  const { connect, connectors } = useConnectors();

  return (
    <div className="flex flex-col gap-3.5">
      {connectors.map((connector) => (
        <WalletOption
          connector={connector}
          key={connector.uid}
          onClick={() => {
            context.setIsConnectorError(false);
            context.setPendingConnector(connector);
            connect({ connector });
          }}
        />
      ))}
    </div>
  );
}

function WalletOption({ connector, onClick }: { connector: Connector; onClick: () => void }): React.JSX.Element {
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
    const timeout = window.setTimeout(() => {
      if (copied) setCopied(false);
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

  return (
    <button
      className="absolute left-5 top-5 z-50 grid h-8 w-8 place-items-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-lime-300/70"
      type="button"
      onClick={() => {
        context.setIsConnectorError(false);
        context.setPendingConnector(null);
      }}
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
      onClick={() => {
        if (!context.pendingConnector) return;
        context.setIsConnectorError(false);
        connect({ connector: context.pendingConnector });
      }}
    >
      <RotateCcw className="h-4 w-4 transition-transform group-hover:-rotate-45" />
    </Button>
  );
}

function useConnectors(): { connectors: Connector[]; connect: ReturnType<typeof useConnect>["connect"] } {
  const context = React.useContext(SimpleKitContext);
  const { connect, connectors } = useConnect({
    mutation: {
      onError: () => context.setIsConnectorError(true),
    },
  });

  const sortedConnectors = React.useMemo(() => {
    const preferredOrder = ["injected", "metaMask", "metaMaskSDK", "safe"];
    return [...connectors].sort((left, right) => {
      const leftIndex = preferredOrder.indexOf(left.id);
      const rightIndex = preferredOrder.indexOf(right.id);
      return (leftIndex === -1 ? preferredOrder.length : leftIndex) - (rightIndex === -1 ? preferredOrder.length : rightIndex);
    });
  }, [connectors]);

  return { connect, connectors: sortedConnectors };
}

function useSimpleKit(): {
  close: () => void;
  formattedAddress: string;
  isConnected: boolean;
  isModalOpen: boolean;
  open: () => void;
  toggleModal: () => void;
} {
  const { address } = useAccount();
  const context = React.useContext(SimpleKitContext);
  const isConnected = address !== undefined && context.pendingConnector === null;

  return {
    close: () => context.setOpen(false),
    formattedAddress: address ? shortAddress(address) : "",
    isConnected,
    isModalOpen: context.open,
    open: () => context.setOpen(true),
    toggleModal: () => context.setOpen((current) => !current),
  };
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
