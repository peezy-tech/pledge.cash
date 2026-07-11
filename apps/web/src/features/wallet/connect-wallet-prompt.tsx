import { ConnectWalletButton } from "../../components/simplekit";

export function ConnectWalletPrompt({
  description,
  title = "Connect wallet to continue",
}: {
  description: string;
  title?: string | undefined;
}): React.JSX.Element {
  return (
    <aside className="mt-4 border-l-2 border-amber-300 bg-amber-400/8 px-4 py-3" role="note">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="m-0 text-sm font-semibold text-amber-100">{title}</p>
          <p className="m-0 mt-1 max-w-2xl text-xs leading-5 text-zinc-400">{description}</p>
        </div>
        <ConnectWalletButton className="shrink-0" />
      </div>
    </aside>
  );
}
