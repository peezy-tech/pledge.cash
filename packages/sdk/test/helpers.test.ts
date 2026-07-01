import { describe, expect, test } from "bun:test";
import { encodeErrorResult, encodeFunctionData, type Address, type Hex } from "viem";
import {
  boardroomAbi,
  boardroomTokenAbi,
  buildBoardroomShareGrantIssuanceBatch,
  buildDirectGrantCreationTransaction,
  buildErc20Approval,
  decodeKnownPledgeCashError,
  queryGrantsHeldByAddress,
  queryGrantsIssuedByAddress,
  readBoardroomState,
  readFactoryState,
  readGrantState,
  tokenGrantFactoryAbi,
  type GrantCreationTerms,
  type PledgeCashLogClient,
  type PledgeCashReadClient,
} from "../src";

const factory = "0x0000000000000000000000000000000000000fac" as Address;
const boardroom = "0x0000000000000000000000000000000000000b0a" as Address;
const shareToken = "0x0000000000000000000000000000000000000aaa" as Address;
const holder = "0x0000000000000000000000000000000000000b0b" as Address;
const issuer = "0x00000000000000000000000000000000000a11ce" as Address;
const other = "0x000000000000000000000000000000000000cafe" as Address;
const grantToken = "0x0000000000000000000000000000000000000123" as Address;
const paymentToken = "0x0000000000000000000000000000000000000456" as Address;
const salt = "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex;

const terms = {
  holder,
  token: grantToken,
  paymentToken,
  amount: 1000n,
  price: 25n,
  expiry: 3000n,
  vestingCliff: 1000n,
  vestingEnd: 2000n,
  transferable: true,
  transferUnlockTime: 1200n,
  salt,
} satisfies GrantCreationTerms;

describe("SDK action and query helpers", () => {
  test("reads factory, grant, and Boardroom state through standard viem calls", async () => {
    const client = mockReadClient({
      owner: issuer,
      tokenGrantLogic: "0x0000000000000000000000000000000000000100",
      creationFee: 10n,
      issuer,
      holder,
      token: grantToken,
      paymentToken,
      grantSize: 1000n,
      claimable: 900n,
      price: 25n,
      expiry: 3000n,
      settledAmount: 100n,
      vestingIsHalted: false,
      isClosed: false,
      getSettleableAmount: 500n,
      policyRegistry: "0x0000000000000000000000000000000000000777",
      shareToken,
    });

    await expect(readFactoryState(client, factory)).resolves.toMatchObject({
      address: factory,
      owner: issuer,
      creationFee: 10n,
    });
    await expect(readGrantState(client, boardroom, 1500n)).resolves.toMatchObject({
      address: boardroom,
      issuer,
      holder,
      settleable: 500n,
    });
    await expect(readBoardroomState(client, boardroom)).resolves.toMatchObject({
      address: boardroom,
      owner: issuer,
      shareToken,
    });
  });

  test("builds direct grant and Boardroom batch transaction inputs", () => {
    const shareGrantTerms = {
      holder: terms.holder,
      paymentToken: terms.paymentToken,
      amount: terms.amount,
      price: terms.price,
      expiry: terms.expiry,
      vestingCliff: terms.vestingCliff,
      vestingEnd: terms.vestingEnd,
      transferable: terms.transferable,
      transferUnlockTime: terms.transferUnlockTime,
      salt: terms.salt,
    };
    const direct = buildDirectGrantCreationTransaction({ factory, terms, creationFee: 10n });

    expect(direct.address).toBe(factory);
    expect(direct.abi).toBe(tokenGrantFactoryAbi);
    expect(direct.functionName).toBe("createGrant");
    expect(direct.value).toBe(10n);
    expect(direct.args).toEqual([
      holder,
      grantToken,
      paymentToken,
      1000n,
      25n,
      3000n,
      1000n,
      2000n,
      true,
      1200n,
      salt,
    ]);

    const approval = buildErc20Approval({ token: grantToken, spender: factory, amount: 1000n });
    expect(approval.functionName).toBe("approve");
    expect(approval.args).toEqual([factory, 1000n]);

    const batch = buildBoardroomShareGrantIssuanceBatch({
      boardroom,
      factory,
      shareToken,
      terms: shareGrantTerms,
      creationFee: 10n,
    });

    expect(batch.address).toBe(boardroom);
    expect(batch.abi).toBe(boardroomAbi);
    expect(batch.functionName).toBe("executeBatch");
    expect(batch.value).toBe(10n);

    const calls = batch.args[0];
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ policy: factory, target: shareToken, value: 0n });
    expect(calls[0]?.data).toBe(
      encodeFunctionData({ abi: boardroomTokenAbi, functionName: "approve", args: [factory, 1000n] }),
    );
    expect(calls[1]).toMatchObject({ policy: factory, target: factory, value: 10n });
    expect(calls[1]?.data).toBe(
      encodeFunctionData({
        abi: tokenGrantFactoryAbi,
        functionName: "createGrant",
        args: [holder, shareToken, paymentToken, 1000n, 25n, 3000n, 1000n, 2000n, true, 1200n, salt],
      }),
    );
  });

  test("folds creation, transfer, and close logs into issued and held grants", async () => {
    const firstGrant = "0x0000000000000000000000000000000000001001" as Address;
    const secondGrant = "0x0000000000000000000000000000000000001002" as Address;
    const client = mockLogClient({
      TokenGrantCreated: [
        createdLog(10n, 0, firstGrant, 1n, issuer, holder),
        createdLog(11n, 0, secondGrant, 2n, issuer, other),
      ],
      Transfer: [
        transferLog(10n, 1, "0x0000000000000000000000000000000000000000", holder, 1n),
        transferLog(11n, 1, "0x0000000000000000000000000000000000000000", other, 2n),
        transferLog(12n, 0, other, holder, 2n),
        transferLog(13n, 0, holder, "0x0000000000000000000000000000000000000000", 1n),
      ],
      GrantClosed: [closedLog(13n, 1, firstGrant, 1n, holder)],
    });

    const issued = await queryGrantsIssuedByAddress(client, { factory, issuer, fromBlock: 9n, includeClosed: true });
    expect(issued.map((grant) => grant.tokenId)).toEqual([2n, 1n]);
    expect(issued.find((grant) => grant.tokenId === 1n)?.closed).toBe(true);

    const heldOpen = await queryGrantsHeldByAddress(client, { factory, holder, fromBlock: 9n });
    expect(heldOpen.map((grant) => grant.grantAddress)).toEqual([secondGrant]);

    const heldWithClosed = await queryGrantsHeldByAddress(client, { factory, holder, fromBlock: 9n, includeClosed: true });
    expect(heldWithClosed.map((grant) => grant.tokenId)).toEqual([2n, 1n]);
    expect(heldWithClosed.find((grant) => grant.tokenId === 1n)?.lastHolder).toBe(holder);
  });

  test("decodes known custom errors from shipped ABIs", () => {
    const data = encodeErrorResult({
      abi: tokenGrantFactoryAbi,
      errorName: "InvalidCreationFeePayment",
      args: [10n, 0n],
    });

    const decoded = decodeKnownPledgeCashError({ cause: { data } });

    expect(decoded?.name).toBe("InvalidCreationFeePayment");
    expect(decoded?.args).toEqual([10n, 0n]);
    expect(decoded?.message).toBe("Invalid creation fee payment: expected 10, received 0.");
  });
});

function mockReadClient(values: Record<string, unknown>): PledgeCashReadClient {
  return {
    async readContract(parameters) {
      const functionName = parameters.functionName as string;
      if (!(functionName in values)) throw new Error(`Unexpected read: ${functionName}`);
      return values[functionName];
    },
  };
}

function mockLogClient(logs: Record<string, readonly unknown[]>): PledgeCashLogClient {
  return {
    async getLogs(parameters) {
      const eventName = (parameters.event as { name?: string }).name;
      return (eventName ? logs[eventName] : []) as never;
    },
  };
}

function createdLog(
  blockNumber: bigint,
  logIndex: number,
  grantAddress: Address,
  tokenId: bigint,
  grantIssuer: Address,
  grantHolder: Address,
) {
  return {
    blockNumber,
    logIndex,
    transactionHash: `0x${tokenId.toString(16).padStart(64, "0")}` as Hex,
    args: {
      grantAddress,
      issuer: grantIssuer,
      holder: grantHolder,
      tokenId,
      transferable: true,
      transferUnlockTime: 1200n,
      token: grantToken,
      paymentToken,
      amount: 1000n,
      price: 25n,
      expiry: 3000n,
      vestingCliff: 1000n,
      vestingEnd: 2000n,
      salt,
    },
  };
}

function transferLog(blockNumber: bigint, logIndex: number, from: Address, to: Address, tokenId: bigint) {
  return {
    blockNumber,
    logIndex,
    args: { from, to, id: tokenId },
  };
}

function closedLog(blockNumber: bigint, logIndex: number, grantAddress: Address, tokenId: bigint, lastHolder: Address) {
  return {
    blockNumber,
    logIndex,
    args: { grantAddress, tokenId, lastHolder },
  };
}
