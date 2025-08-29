#!/usr/bin/env bun

import { privateKeyToAccount } from "viem/accounts";

const pk = (process.env.OPERATOR_PRIVATE_KEY || "").trim();

if (!pk) {
  console.error("OPERATOR_PRIVATE_KEY is not set");
  process.exit(1);
}

try {
  const acct = privateKeyToAccount(pk as `0x${string}`);
  console.log(acct.address);
} catch (e) {
  console.error("Invalid OPERATOR_PRIVATE_KEY:", e);
  process.exit(1);
}

