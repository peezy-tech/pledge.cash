import { ArrowLeft, Loader2, SearchX } from "lucide-react";
import { Button } from "../../components/ui/button";

export function NotFoundPage({
  description = "The address does not match a pledge.cash project or workspace.",
  onReturn,
  returnHref,
  title = "This page does not exist",
}: {
  description?: string;
  onReturn?: () => void;
  returnHref?: string;
  title?: string;
}): React.JSX.Element {
  const action = returnHref ? (
    <a
      className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-lime-300 bg-lime-300 px-3 text-sm font-semibold text-zinc-950 transition-colors hover:bg-lime-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300/70"
      href={returnHref}
      onClick={(event) => {
        if (!onReturn || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onReturn();
      }}
    >
      <ArrowLeft className="h-4 w-4" />
      Return to Explore
    </a>
  ) : (
    <Button onClick={onReturn}>
      <ArrowLeft className="h-4 w-4" />
      Return to Explore
    </Button>
  );

  return (
    <div className="grid min-h-[58vh] place-items-center py-12">
      <div className="max-w-xl text-center">
        <SearchX className="mx-auto h-8 w-8 text-zinc-600" />
        <p className="m-0 mt-5 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-600">404</p>
        <h1 className="m-0 mt-2 text-3xl font-semibold tracking-[-0.025em] text-zinc-50">{title}</h1>
        <p className="m-0 mt-3 text-sm leading-6 text-zinc-400">{description}</p>
        <div className="mt-6 flex justify-center">{action}</div>
      </div>
    </div>
  );
}
export function RedirectState({
  destination,
  message = "Opening the canonical workspace…",
}: {
  destination: string;
  message?: string;
}): React.JSX.Element {
  return (
    <div aria-live="polite" className="grid min-h-[42vh] place-items-center py-12" role="status">
      <div className="text-center">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-lime-300" />
        <h1 className="m-0 mt-4 text-lg font-semibold text-zinc-100">{message}</h1>
        <p className="m-0 mt-2 text-xs text-zinc-600">{destination}</p>
      </div>
    </div>
  );
}
