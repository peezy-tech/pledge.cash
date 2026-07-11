import { describe, expect, test } from "bun:test";
import type {
  Address,
  GrantState,
  PledgeCashDeployment,
  PledgeCashReadClient,
} from "@pledge.cash/sdk";
import { assertCanonicalBoardroom, assertCanonicalGrant } from "../src/lib/canonical-provenance";

const boardroomFactory = "0x1000000000000000000000000000000000000000" as Address;
const tokenGrantFactory = "0x2000000000000000000000000000000000000000" as Address;
const boardroom = "0x3000000000000000000000000000000000000000" as Address;
const grant = "0x4000000000000000000000000000000000000000" as Address;
const spoof = "0x5000000000000000000000000000000000000000" as Address;
const deployment = { chainId: 31337, boardroomFactory, tokenGrantFactory } as PledgeCashDeployment;

describe("canonical product provenance", () => {
  test("rejects a spoof Boardroom that is absent from the configured factory", async () => {
    const client = readClient(async (functionName) => functionName === "isBoardroom" ? false : undefined);

    await expect(assertCanonicalBoardroom(client, deployment, spoof)).rejects.toThrow("not a Boardroom");
    await expect(assertCanonicalBoardroom(readClient(async () => true), deployment, boardroom)).resolves.toBeUndefined();
  });

  test("rejects grants with a spoof factory or mismatched token-ID registration", async () => {
    const state = { factory: tokenGrantFactory, tokenId: 42n } as GrantState;
    const wrongFactory = { ...state, factory: spoof } as GrantState;
    const mappingClient = readClient(async (functionName) => functionName === "grantForTokenId" ? spoof : undefined);

    await expect(assertCanonicalGrant(mappingClient, deployment, grant, wrongFactory)).rejects.toThrow("not created by");
    await expect(assertCanonicalGrant(mappingClient, deployment, grant, state)).rejects.toThrow("token record");
    await expect(assertCanonicalGrant(readClient(async () => grant), deployment, grant, state)).resolves.toBeUndefined();
  });
});

function readClient(read: (functionName: string) => Promise<unknown>): PledgeCashReadClient {
  return {
    readContract: async (request: { functionName?: string }) => await read(request.functionName ?? ""),
  } as unknown as PledgeCashReadClient;
}
