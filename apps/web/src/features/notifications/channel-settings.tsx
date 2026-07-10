import type { ChannelDto, TelegramLinkCodeResponse } from "@pledge.cash/sentinel/dto";
import { ExternalLink, Loader2, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { ActionRow, Facts, Panel } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import type { SentinelClient } from "../../lib/sentinel";
import { errorMessage, formatSentinelDate } from "./hooks";

type ChannelSettingsProps = {
  channels: ChannelDto[];
  client: SentinelClient;
  onChanged: () => Promise<void>;
};

export function ChannelSettings({ channels, client, onChanged }: ChannelSettingsProps): React.JSX.Element {
  const [error, setError] = useState<string>();
  const [linkCode, setLinkCode] = useState<TelegramLinkCodeResponse>();
  const [pending, setPending] = useState<string>();
  const telegramChannels = channels.filter((channel) => channel.type === "telegram");
  const enabledCount = channels.filter((channel) => channel.enabled).length;

  const createTelegramLink = async (): Promise<void> => {
    setPending("telegram");
    setError(undefined);
    try {
      setLinkCode(await client.createTelegramLinkCode());
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(undefined);
    }
  };

  const removeChannel = async (channel: ChannelDto): Promise<void> => {
    setPending(channel.id);
    setError(undefined);
    try {
      await client.deleteChannel(channel.id);
      await onChanged();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(undefined);
    }
  };

  return (
    <Panel
      title="Delivery"
      description="Telegram receives governance alerts for every wallet in your alert coverage."
      action={
        <Button
          disabled={pending !== undefined}
          variant={enabledCount === 0 ? "default" : "secondary"}
          onClick={() => void createTelegramLink()}
        >
          {pending === "telegram" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Link Telegram
        </Button>
      }
    >
      <Facts
        columns="three"
        items={[
          { label: "Channels", value: channels.length.toString() },
          { label: "Enabled", value: enabledCount.toString() },
          { label: "Telegram", value: telegramChannels.length.toString() },
        ]}
      />
      {linkCode ? (
        <div className="border-t border-zinc-800 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>Ready</Badge>
                <span className="text-sm font-semibold text-zinc-100">{linkCode.code}</span>
              </div>
              <p className="m-0 mt-1 text-sm text-zinc-500">Expires {formatSentinelDate(linkCode.expiresAt)}</p>
            </div>
            <a
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-lime-300 bg-lime-300 px-3 text-sm font-semibold text-zinc-950 transition-colors hover:bg-lime-200"
              href={linkCode.deepLink}
              rel="noreferrer"
              target="_blank"
            >
              <ExternalLink className="h-4 w-4" />
              Open Telegram
            </a>
          </div>
        </div>
      ) : null}
      {error ? <p className="m-0 border-t border-red-950 bg-red-950/35 p-4 text-sm text-red-200">{error}</p> : null}
      <ol className="m-0 grid list-none gap-px border-t border-zinc-800 bg-zinc-800 p-0">
        {channels.length === 0 ? (
          <li className="bg-zinc-950 p-4 text-sm text-zinc-500">No delivery channels</li>
        ) : (
          channels.map((channel) => (
            <li
              className="grid min-w-0 gap-3 bg-zinc-950 p-4 md:grid-cols-[minmax(0,1fr)_minmax(120px,0.3fr)_auto] md:items-center"
              key={channel.id}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Send className="h-4 w-4 text-zinc-500" />
                  <span className="text-sm font-semibold capitalize text-zinc-100">{channel.type}</span>
                  <Badge variant={channel.enabled ? "default" : "muted"}>{channel.enabled ? "Enabled" : "Disabled"}</Badge>
                </div>
                <div className="mt-1 truncate text-xs text-zinc-500">{channel.telegramChatId ?? channel.id}</div>
              </div>
              <div className="text-sm text-zinc-400">{channel.enabled ? "Active" : "Paused"}</div>
              <div className="flex md:justify-end">
                <Button
                  disabled={pending !== undefined}
                  size="sm"
                  variant="danger"
                  onClick={() => void removeChannel(channel)}
                >
                  {pending === channel.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  Remove
                </Button>
              </div>
            </li>
          ))
        )}
      </ol>
      <ActionRow>
        <Button disabled={pending !== undefined} variant="ghost" onClick={() => void onChanged()}>
          Refresh channels
        </Button>
      </ActionRow>
    </Panel>
  );
}
