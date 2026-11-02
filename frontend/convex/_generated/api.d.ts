/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as billing from "../billing.js";
import type * as bridge from "../bridge.js";
import type * as collections from "../collections.js";
import type * as crons from "../crons.js";
import type * as customers from "../customers.js";
import type * as dailySms from "../dailySms.js";
import type * as deliveries from "../deliveries.js";
import type * as edge from "../edge.js";
import type * as employees from "../employees.js";
import type * as extra from "../extra.js";
import type * as http from "../http.js";
import type * as journal from "../journal.js";
import type * as lib from "../lib.js";
import type * as migrate from "../migrate.js";
import type * as notifications from "../notifications.js";
import type * as proFeatures from "../proFeatures.js";
import type * as products from "../products.js";
import type * as purchases from "../purchases.js";
import type * as pw from "../pw.js";
import type * as returns from "../returns.js";
import type * as routes from "../routes.js";
import type * as sales from "../sales.js";
import type * as sessions from "../sessions.js";
import type * as stats from "../stats.js";
import type * as targets from "../targets.js";
import type * as tracking from "../tracking.js";
import type * as vouchers from "../vouchers.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  billing: typeof billing;
  bridge: typeof bridge;
  collections: typeof collections;
  crons: typeof crons;
  customers: typeof customers;
  dailySms: typeof dailySms;
  deliveries: typeof deliveries;
  edge: typeof edge;
  employees: typeof employees;
  extra: typeof extra;
  http: typeof http;
  journal: typeof journal;
  lib: typeof lib;
  migrate: typeof migrate;
  notifications: typeof notifications;
  proFeatures: typeof proFeatures;
  products: typeof products;
  purchases: typeof purchases;
  pw: typeof pw;
  returns: typeof returns;
  routes: typeof routes;
  sales: typeof sales;
  sessions: typeof sessions;
  stats: typeof stats;
  targets: typeof targets;
  tracking: typeof tracking;
  vouchers: typeof vouchers;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
