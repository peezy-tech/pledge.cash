import type {
  NotificationPayload,
  OutboxRow,
  RenderedMessage,
  Severity,
  StoredCall
} from "../types";

export type RenderOptions = {
  readonly chainNames?: Readonly<Record<number, string>>;
  readonly explorerUrls?: Readonly<Record<number, string | undefined>>;
  readonly now?: Date;
  readonly webOrigin?: string;
};

type Links = {
  readonly explorerTx?: string;
  readonly webAction: string;
};

export type NotificationRenderEvent = OutboxRow["event"] | "reminder" | "policy-admin";

export type RenderPayload = NotificationPayload & {
  readonly action: NotificationPayload["action"] & {
    readonly queueTxHash?: string;
    readonly resolvedTxHash?: string | null;
  };
  readonly analysis?: NotificationPayload["analysis"] & {
    readonly source?: string;
  };
  readonly boardroom?: {
    readonly address: string;
    readonly chainId: number;
    readonly name?: string | null;
  };
  readonly calls?: readonly StoredCall[];
  readonly delivery?: {
    readonly replyToExternalId?: string;
    readonly telegramChatId?: string;
  };
  readonly links?: {
    readonly explorerTx?: string;
    readonly webAction?: string;
  };
};

export type RenderableOutboxRow = Omit<OutboxRow, "event" | "payload"> & {
  readonly event: NotificationRenderEvent;
  readonly payload: RenderPayload;
};

const defaultWebOrigin = "https://pledge.cash";
const warningSign = "\u26a0\ufe0f";

export function renderNotification(
  row: OutboxRow | RenderableOutboxRow,
  options: RenderOptions = {}
): RenderedMessage {
  const links = buildLinks(row.payload, options);

  if (row.channelType === "twitter") {
    return renderTwitter(row, links, options);
  }

  return renderTelegram(row, links, options);
}

export function buildLinks(
  payload: NotificationPayload | RenderPayload,
  options: RenderOptions = {}
): Links {
  const renderPayload = payload as RenderPayload;
  const webAction =
    renderPayload.links?.webAction ??
    `${trimTrailingSlash(options.webOrigin ?? defaultWebOrigin)}/boardrooms/${payload.action.chainId}/${payload.action.boardroom}?action=${payload.action.actionHash}`;
  const explorerBase = options.explorerUrls?.[payload.action.chainId];
  const txHash = renderPayload.action.resolvedTxHash ?? renderPayload.action.queueTxHash;
  const explorerTx =
    renderPayload.links?.explorerTx ??
    (explorerBase !== undefined && txHash !== undefined
      ? `${trimTrailingSlash(explorerBase)}/tx/${txHash}`
      : undefined);

  return explorerTx === undefined ? { webAction } : { explorerTx, webAction };
}

function renderTelegram(
  row: OutboxRow | RenderableOutboxRow,
  links: Links,
  options: RenderOptions
): RenderedMessage {
  const payload = row.payload as RenderPayload;
  const severity = payload.risk?.severity ?? "medium";
  const event = eventLabel(row.event as NotificationRenderEvent);
  const boardroom = boardroomName(payload);
  const chain = chainName(payload.action.chainId, options);
  const eta = new Date(payload.action.eta);
  const utcEta = formatUtc(eta);
  const vetoWindow = vetoWindowText(eta, options.now ?? new Date());
  const summary = payload.analysis?.summary ?? "Sentinel detected a governance action.";
  const source = payload.analysis?.source ?? "template";
  const callLines = summarizeCalls(payload.calls ?? []);
  const explorerLine =
    links.explorerTx === undefined
      ? ""
      : `\n<a href="${escapeHtml(links.explorerTx)}">Queue transaction</a>`;

  const html = [
    `<b>${escapeHtml(severityBadge(severity))} ${escapeHtml(event)} governance action</b>`,
    `<b>Boardroom:</b> ${escapeHtml(boardroom)} on ${escapeHtml(chain)}`,
    `<b>Address:</b> <code>${escapeHtml(payload.action.boardroom)}</code>`,
    `<b>Executable:</b> ${escapeHtml(utcEta)} (${escapeHtml(vetoWindow)})`,
    `<b>Summary:</b> ${escapeHtml(summary)}`,
    `<b>Calls:</b>\n${escapeHtml(callLines.join("\n"))}`,
    `<b>Analysis:</b> ${escapeHtml(source)} explanation. ${escapeHtml(
      payload.analysis?.severityRationale ?? "Severity comes from deterministic Sentinel rules."
    )}`,
    `<b>Veto:</b> Open ${linkHtml(links.webAction, "the boardroom")} or call <code>cancelAction(${escapeHtml(
      payload.action.actionHash
    )})</code>.${explorerLine}`
  ].join("\n\n");

  return {
    html,
    subject: `${severityBadge(severity)} ${event} action in ${boardroom}`,
    text: [
      `${severityBadge(severity)} ${event} governance action`,
      `Boardroom: ${boardroom} on ${chain}`,
      `Address: ${payload.action.boardroom}`,
      `Executable: ${utcEta} (${vetoWindow})`,
      `Summary: ${summary}`,
      `Calls:\n${callLines.join("\n")}`,
      `Analysis: ${source} explanation. ${
        payload.analysis?.severityRationale ?? "Severity comes from deterministic Sentinel rules."
      }`,
      `Veto: ${links.webAction} or call cancelAction(${payload.action.actionHash})`,
      links.explorerTx === undefined ? "" : `Queue transaction: ${links.explorerTx}`
    ]
      .filter((line) => line.length > 0)
      .join("\n\n"),
    url: links.webAction
  };
}

function renderTwitter(
  row: OutboxRow | RenderableOutboxRow,
  links: Links,
  options: RenderOptions
): RenderedMessage {
  const payload = row.payload as RenderPayload;
  const boardroom = boardroomName(payload);
  const chain = chainName(payload.action.chainId, options);
  const summary = oneLine(payload.analysis?.summary ?? "governance action pending");
  const eta = formatUtc(new Date(payload.action.eta));
  const event = row.event as NotificationRenderEvent;
  const text =
    event === "queued"
      ? fitTweetParts(
          `${warningSign} HIGH-RISK action queued in ${boardroom} on ${chain}: `,
          summary,
          `. Executable ${eta}. Shareholders can veto.`,
          links.webAction
        )
      : fitTweet(
          `UPDATE: ${boardroom} action on ${chain} was ${eventLabel(
            event
          ).toLowerCase()}. Shareholders can review details.`,
          links.webAction
        );

  return { text, url: links.webAction };
}

function severityBadge(severity: Severity): string {
  switch (severity) {
    case "high":
      return "HIGH";
    case "medium":
      return "MEDIUM";
    case "low":
      return "LOW";
  }
}

function eventLabel(event: NotificationRenderEvent): string {
  switch (event) {
    case "queued":
      return "Queued";
    case "cancelled":
      return "Cancelled";
    case "executed":
      return "Executed";
    case "reminder":
      return "Reminder";
    case "policy-admin":
      return "Policy-admin";
  }
}

function boardroomName(payload: RenderPayload): string {
  return payload.boardroom?.name ?? shortAddress(payload.action.boardroom);
}

function chainName(chainId: number, options: RenderOptions): string {
  return options.chainNames?.[chainId] ?? `chain ${chainId}`;
}

function summarizeCalls(calls: readonly StoredCall[]): string[] {
  if (calls.length === 0) {
    return ["- No decoded calls were stored for this action."];
  }

  return calls.map((call) => {
    const name = call.decodedFunction ?? call.selector;
    const value = call.value === "0" ? "" : ` value ${call.value}`;
    return `- #${call.callIndex} ${name} -> ${shortAddress(call.target)}${value}`;
  });
}

function vetoWindowText(eta: Date, now: Date): string {
  const ms = eta.getTime() - now.getTime();
  if (!Number.isFinite(ms)) {
    return "veto window timing unavailable";
  }

  if (ms <= 0) {
    return "veto window has ended";
  }

  const hours = Math.max(1, Math.ceil(ms / 3_600_000));
  return `veto window ends in ${hours}h`;
}

function fitTweet(base: string, url: string): string {
  const suffix = ` ${url}`;
  const maxBaseLength = 280 - suffix.length;
  if (maxBaseLength <= 0) {
    return truncate(url, 280);
  }

  return `${truncate(base, maxBaseLength)}${suffix}`;
}

function fitTweetParts(prefix: string, variable: string, suffix: string, url: string): string {
  const urlSuffix = ` ${url}`;
  const variableLength = 280 - prefix.length - suffix.length - urlSuffix.length;
  if (variableLength <= 0) {
    const prefixLength = 280 - suffix.length - urlSuffix.length;
    if (prefixLength <= 0) {
      return fitTweet(suffix.trimStart(), url);
    }

    return `${truncate(prefix, prefixLength)}${suffix}${urlSuffix}`;
  }

  return `${prefix}${truncate(variable, variableLength)}${suffix}${urlSuffix}`;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  if (maxLength <= 3) {
    return value.slice(0, maxLength);
  }

  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function formatUtc(date: Date): string {
  if (!Number.isFinite(date.getTime())) {
    return "unknown UTC";
  }

  return date.toISOString().replace(".000Z", "Z");
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function shortAddress(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function linkHtml(url: string, text: string): string {
  return `<a href="${escapeHtml(url)}">${escapeHtml(text)}</a>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
