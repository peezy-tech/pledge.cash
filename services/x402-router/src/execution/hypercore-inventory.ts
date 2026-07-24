import {
  HttpTransport,
  InfoClient,
} from "@nktkas/hyperliquid";
import type { Address } from "viem";
import type { RefundInventoryReader } from "../quotes/service";

export interface HyperCoreSpotStateReader {
  spotClearinghouseState(input: {
    user: Address;
  }): Promise<{
    balances: readonly {
      coin: string;
      total: string;
      hold: string;
    }[];
  }>;
}

export class HyperCoreRefundInventory implements RefundInventoryReader {
  constructor(
    private readonly account: Address,
    private readonly info: HyperCoreSpotStateReader =
      new InfoClient({
        transport: new HttpTransport({
          isTestnet: true,
          timeout: 10_000,
        }),
      }),
  ) {}

  async availableAtomicUsdc(): Promise<bigint> {
    const state = await this.info.spotClearinghouseState({
      user: this.account,
    });
    const balance = state.balances.find(item => item.coin === "USDC");
    if (!balance) return 0n;
    const total = parseDecimalAtomic(balance.total, 8);
    const hold = parseDecimalAtomic(balance.hold, 8);
    return total > hold ? total - hold : 0n;
  }
}

export function parseDecimalAtomic(value: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30) {
    throw new Error("Invalid token decimals.");
  }
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(value);
  if (!match) throw new Error("Invalid non-negative decimal balance.");
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) {
    const excess = fraction.slice(decimals);
    if (!/^0*$/.test(excess)) {
      throw new Error("Balance has more precision than the configured asset.");
    }
  }
  const normalized = fraction.slice(0, decimals).padEnd(decimals, "0");
  return BigInt(match[1]!) * 10n ** BigInt(decimals) +
    BigInt(normalized || "0");
}
