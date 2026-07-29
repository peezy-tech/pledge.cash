import { isIP } from "node:net";

const FORWARDED_CLIENT_HEADERS = [
  "x-forwarded-for",
  "cf-connecting-ip",
  "true-client-ip",
  "x-real-ip"
] as const;

export function resolveClientIp(
  headers: Headers,
  peerAddress: string,
  trustedProxyIps: readonly string[]
): string {
  const peer = peerAddress.trim();
  if (!trustedProxyIps.includes(peer)) return peer;

  for (const name of FORWARDED_CLIENT_HEADERS) {
    const value = headers.get(name);
    if (value === null) continue;
    const candidate =
      name === "x-forwarded-for"
        ? value.split(",").at(-1)?.trim()
        : value.trim();
    if (candidate !== undefined && isIP(candidate) !== 0) {
      return candidate;
    }
  }

  return peer;
}
