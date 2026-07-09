import { getAbiItem, type Address, type Hex } from "viem";

import { boardroomTokenAbi, ZERO_ADDRESS } from "@pledge.cash/sdk";
import type { PledgeCashLogClient } from "@pledge.cash/sdk";

export type ShareTransfer = {
  readonly amount: bigint;
  readonly blockNumber: bigint;
  readonly from: Address;
  readonly logIndex: number;
  readonly to: Address;
  readonly token: Address;
  readonly transactionHash: Hex;
};

export type ShareBalanceDeltaInput = {
  readonly blockNumber: bigint;
  readonly chainId: number;
  readonly delta: bigint;
  readonly holder: Lowercase<Address>;
  readonly token: Lowercase<Address>;
};

export type ShareBalanceWriter = {
  applyShareBalanceDeltas(inputs: readonly ShareBalanceDeltaInput[]): Promise<void>;
};

type RawTransferLog = {
  address?: Address;
  args?: Record<string, unknown>;
  blockNumber?: bigint;
  logIndex?: number;
  transactionHash?: Hex;
};

const transferEvent = getAbiItem({ abi: boardroomTokenAbi, name: "Transfer" });

export async function queryShareTransfers(
  client: PledgeCashLogClient,
  input: {
    readonly fromBlock: bigint;
    readonly toBlock: bigint;
    readonly tokens: readonly Address[];
  }
): Promise<ShareTransfer[]> {
  const tokens = uniqueAddresses(input.tokens);
  if (tokens.length === 0) return [];

  const logs = (await client.getLogs({
    address: tokens.length === 1 ? tokens[0]! : tokens,
    event: transferEvent,
    fromBlock: input.fromBlock,
    toBlock: input.toBlock
  } as never)) as RawTransferLog[];

  return logs
    .flatMap((log) => maybeArray(toShareTransfer(log)))
    .sort(compareTransfers);
}

export async function applyShareTransfers(
  store: ShareBalanceWriter,
  chainId: number,
  transfers: readonly ShareTransfer[]
): Promise<void> {
  const deltas = new Map<string, ShareBalanceDeltaInput>();

  for (const transfer of transfers) {
    const token = lowerAddress(transfer.token);
    if (!isZeroAddress(transfer.from)) {
      mergeDelta(deltas, {
        blockNumber: transfer.blockNumber,
        chainId,
        delta: -transfer.amount,
        holder: lowerAddress(transfer.from),
        token
      });
    }

    if (!isZeroAddress(transfer.to)) {
      mergeDelta(deltas, {
        blockNumber: transfer.blockNumber,
        chainId,
        delta: transfer.amount,
        holder: lowerAddress(transfer.to),
        token
      });
    }
  }

  await store.applyShareBalanceDeltas([...deltas.values()]);
}

export function aggregateShareBalanceDeltas(
  inputs: readonly ShareBalanceDeltaInput[]
): ShareBalanceDeltaInput[] {
  const deltas = new Map<string, ShareBalanceDeltaInput>();
  for (const input of inputs) mergeDelta(deltas, input);
  return [...deltas.values()];
}

function mergeDelta(
  deltas: Map<string, ShareBalanceDeltaInput>,
  input: ShareBalanceDeltaInput
): void {
  const key = `${input.chainId}:${input.token}:${input.holder}`;
  const existing = deltas.get(key);
  deltas.set(key, {
    ...input,
    blockNumber:
      existing === undefined || input.blockNumber > existing.blockNumber
        ? input.blockNumber
        : existing.blockNumber,
    delta: (existing?.delta ?? 0n) + input.delta
  });
}

function toShareTransfer(log: RawTransferLog): ShareTransfer | undefined {
  if (!log.address || log.blockNumber === undefined || log.logIndex === undefined || !log.transactionHash) {
    return undefined;
  }

  const args = log.args ?? {};
  const from = addressArg(args, "from");
  const to = addressArg(args, "to");
  const amount = bigintArg(args, "amount") ?? bigintArg(args, "value");
  if (!from || !to || amount === undefined) return undefined;

  return {
    amount,
    blockNumber: log.blockNumber,
    from,
    logIndex: log.logIndex,
    to,
    token: log.address,
    transactionHash: log.transactionHash
  };
}

function uniqueAddresses(addresses: readonly Address[]): Address[] {
  return [...new Map(addresses.map((address) => [address.toLowerCase(), address])).values()];
}

function addressArg(args: Record<string, unknown>, name: string): Address | undefined {
  const value = args[name];
  return typeof value === "string" ? (value as Address) : undefined;
}

function bigintArg(args: Record<string, unknown>, name: string): bigint | undefined {
  const value = args[name];
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  return undefined;
}

function maybeArray<T>(value: T | undefined): T[] {
  return value === undefined ? [] : [value];
}

function compareTransfers(left: ShareTransfer, right: ShareTransfer): number {
  if (left.blockNumber < right.blockNumber) return -1;
  if (left.blockNumber > right.blockNumber) return 1;
  return left.logIndex - right.logIndex;
}

function isZeroAddress(address: Address): boolean {
  return address.toLowerCase() === ZERO_ADDRESS;
}

function lowerAddress(address: Address): Lowercase<Address> {
  return address.toLowerCase() as Lowercase<Address>;
}
