import { describe, expect, test } from "bun:test";
import type { DiscoveredGrant } from "@pledge.cash/sdk";
import { renderToString } from "react-dom/server";
import { App, parseDeployment } from "../src/App";
import { MyGrantsPanel } from "../src/features/grants/my-grants-panel";

const oldGrant: DiscoveredGrant = {
  grantAddress: "0x1000000000000000000000000000000000000000",
  tokenId: 1n,
  issuer: "0x2000000000000000000000000000000000000000",
  initialHolder: "0x3000000000000000000000000000000000000000",
  currentHolder: "0x3000000000000000000000000000000000000000",
  token: "0x4000000000000000000000000000000000000000",
  paymentToken: "0x0000000000000000000000000000000000000000",
  amount: 1n,
  price: 0n,
  expiry: 0n,
  vestingCliff: 0n,
  vestingEnd: 0n,
  transferable: false,
  transferUnlockTime: 0n,
  salt: "0x0000000000000000000000000000000000000000000000000000000000000000",
  closed: false,
};

describe("web app shell", () => {
  test("renders core protocol sections without a browser", () => {
    const html = renderToString(<App />);

    expect(html).toContain("pledge.cash");
    expect(html).toContain("Deployment");
    expect(html).toContain("TokenGrantFactory");
    expect(html).toContain("Ready");
    expect(html).toContain("Direct Grant");
    expect(html).toContain("Inspect Grant");
    expect(html).toContain("Boardroom");
    expect(html).toContain("My Grants");
  });

  test("preserves exact bigint values from runtime deployment artifacts", () => {
    const deployment = parseDeployment(`{
      "chainId": 31337,
      "creationFee": 100000000000000001,
      "deploymentTimestamp": 178264485400000000001
    }`);

    expect(deployment.creationFee).toBe(100000000000000001n);
    expect(deployment.deploymentTimestamp).toBe(178264485400000000001n);
  });

  test("hides previously loaded grants after the wallet changes", () => {
    const html = renderToString(
      <MyGrantsPanel
        account="0x5000000000000000000000000000000000000000"
        deployment={{ chainId: 31337, tokenGrantFactory: "0x6000000000000000000000000000000000000000" }}
        fromBlock="0"
        includeClosed={false}
        inspectGrant={() => undefined}
        loadMyGrants={async () => undefined}
        myGrants={{
          held: [oldGrant],
          issued: [],
          loadedFor: "0x3000000000000000000000000000000000000000",
          fromBlock: 0n,
          includeClosed: false,
        }}
        pendingAction={undefined}
        runAction={async () => undefined}
        setFromBlock={() => undefined}
        setIncludeClosed={() => undefined}
      />,
    );

    expect(html).toContain("Held Grants");
    expect(html).not.toContain("0x1000...0000");
  });

  test("hides loaded grants after the query filters change", () => {
    const html = renderToString(
      <MyGrantsPanel
        account="0x3000000000000000000000000000000000000000"
        deployment={{ chainId: 31337, tokenGrantFactory: "0x6000000000000000000000000000000000000000" }}
        fromBlock="1"
        includeClosed={false}
        inspectGrant={() => undefined}
        loadMyGrants={async () => undefined}
        myGrants={{
          held: [oldGrant],
          issued: [],
          loadedFor: "0x3000000000000000000000000000000000000000",
          fromBlock: 0n,
          includeClosed: true,
        }}
        pendingAction={undefined}
        runAction={async () => undefined}
        setFromBlock={() => undefined}
        setIncludeClosed={() => undefined}
      />,
    );

    expect(html).toContain("Held Grants");
    expect(html).not.toContain("0x1000...0000");
  });
});
