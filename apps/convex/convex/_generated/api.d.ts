/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as address from "../address.js";
import type * as billing from "../billing.js";
import type * as campaigns from "../campaigns.js";
import type * as invoices from "../invoices.js";
import type * as lib_hyperliquid from "../lib/hyperliquid.js";
import type * as market from "../market.js";
import type * as payments from "../payments.js";
import type * as pledgeWallet from "../pledgeWallet.js";
import type * as recurring from "../recurring.js";
import type * as subscriptions from "../subscriptions.js";
import type * as users from "../users.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  address: typeof address;
  billing: typeof billing;
  campaigns: typeof campaigns;
  invoices: typeof invoices;
  "lib/hyperliquid": typeof lib_hyperliquid;
  market: typeof market;
  payments: typeof payments;
  pledgeWallet: typeof pledgeWallet;
  recurring: typeof recurring;
  subscriptions: typeof subscriptions;
  users: typeof users;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
