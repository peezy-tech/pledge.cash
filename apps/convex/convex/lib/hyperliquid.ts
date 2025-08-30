import * as hl from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";

export function isTestnet() {
  const flag = process.env.HL_IS_TESTNET;
  if (flag === undefined) return true;
  return flag !== "false" && flag !== "0";
}

export function transport() {
  return new hl.HttpTransport({ isTestnet: isTestnet() });
}

export function infoClient() {
  return new hl.InfoClient({ transport: transport() });
}

export function exchangeClientFromPrivateKey(priv: `0x${string}`) {
  const wallet = privateKeyToAccount(priv);
  return new hl.ExchangeClient({ transport: transport(), wallet, isTestnet: isTestnet() });
}

export function multiSignClient(opts: { multiSignAddress: `0x${string}`; operatorPrivateKey: `0x${string}` }) {
  const op = privateKeyToAccount(opts.operatorPrivateKey);
  return new hl.MultiSignClient({
    transport: transport(),
    multiSignAddress: opts.multiSignAddress,
    signatureChainId: `0x${(1337).toString(16)}` as `0x${string}`,
    signers: [
      {
        address: op.address,
        signTypedData: async (params: any) => op.signTypedData(params),
      },
    ],
    isTestnet: isTestnet(),
  });
}

export function operatorAccount() {
  const pk = process.env.OPERATOR_PRIVATE_KEY as `0x${string}` | undefined;
  if (!pk) throw new Error("OPERATOR_PRIVATE_KEY is not set");
  return privateKeyToAccount(pk);
}

export function operatorExchangeClient() {
  const wallet = operatorAccount();
  return new hl.ExchangeClient({ transport: transport(), wallet, isTestnet: isTestnet() });
}

export async function usdcTokenString() {
  const ic = infoClient();
  const meta = await ic.spotMeta();
  const usdc = meta.tokens.find((t: any) => t.name === "USDC");
  if (!usdc) throw new Error("USDC token not found in spot meta");
  return `${usdc.name}:${usdc.tokenId}` as const;
}

