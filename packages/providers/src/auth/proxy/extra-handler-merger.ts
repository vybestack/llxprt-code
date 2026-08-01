/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Merges extra request handlers into the server's requestHandlers map,
 * throwing at construction time if any key collides with a built-in op name.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-003
 * @pseudocode 003-github-broker.md lines 01-06
 */

/**
 * Merges extra handlers into the built-in handlers map. Throws if any key
 * collides with a built-in op name (fail fast — silent override of
 * get_api_key would be catastrophic).
 *
 * The `extra` parameter is typed as Record<string, unknown> because the
 * caller (CredentialProxyServer constructor) receives it from user options
 * and the actual handler type is structural. At runtime, each value is a
 * function with the correct signature.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-003
 * @pseudocode 003-github-broker.md lines 01-06
 */
export function mergeExtraHandlers<T>(
  builtIn: Partial<Record<string, T>>,
  extra: Record<string, unknown> | undefined,
): void {
  if (extra === undefined) return;
  for (const key of Object.keys(extra)) {
    if (key in builtIn) {
      throw new Error(
        `extraHandler key "${key}" collides with a built-in op name`,
      );
    }
    const handler = extra[key];
    if (handler !== undefined) {
      // `extra` is Record<string, unknown>, so confirm the value is callable
      // before it joins the dispatch table. Casting blindly would defer the
      // failure to invocation time, where it surfaces as an opaque crash on
      // a request rather than a clear error at construction.
      if (typeof handler !== 'function') {
        throw new TypeError(
          `extraHandler "${key}" must be a function, received ${typeof handler}`,
        );
      }
      builtIn[key] = handler as T;
    }
  }
}

/**
 * Resolves a handler by caller-supplied name using an own-property check.
 *
 * A plain index would resolve inherited members, so an op named "toString"
 * or "constructor" would come back truthy and then be invoked as a request
 * handler. Lives here with the other handler-table logic so both the merge
 * and the lookup share one set of assumptions about that table.
 *
 * @plan PLAN-20260731-GHBROKER.P19
 * @requirement REQ-002, REQ-015
 */
export function resolveHandler<T>(
  table: Partial<Record<string, T>>,
  op: string,
): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, op)
    ? table[op]
    : undefined;
}

/**
 * Builds a prototype-safe dispatch table from a handler object.
 *
 * Operation names arrive from the caller. Indexing an object with one
 * reaches Object.prototype members, so an op named "toString" resolves to a
 * function and is then invoked as a handler. Map keys are data rather than
 * properties, so no prototype member is ever reachable. Lives beside the
 * merge so both share one set of assumptions about that table.
 *
 * @plan PLAN-20260731-GHBROKER.P19
 * @requirement REQ-002, REQ-015
 */
export function buildHandlerMap<T>(
  table: Partial<Record<string, T>>,
): Map<string, T> {
  return new Map(
    Object.entries(table).filter(
      (entry): entry is [string, T] => entry[1] !== undefined,
    ),
  );
}

/**
 * Resolves a handler without ever using the caller-supplied string as a
 * lookup key.
 *
 * The requested name arrives from the network. Rather than indexing with it,
 * this finds the matching entry in the registered-name list and dispatches
 * on THAT value, so the key used for dispatch provably originates from our
 * own table rather than from the wire. An unregistered name yields undefined
 * and the caller rejects the request.
 *
 * @plan PLAN-20260731-GHBROKER.P19
 * @requirement REQ-002, REQ-015
 */
export function resolveRegisteredHandler<T>(
  handlers: ReadonlyMap<string, T>,
  registeredNames: readonly string[],
  requested: string,
): T | undefined {
  const match = registeredNames.find((name) => name === requested);
  return match === undefined ? undefined : handlers.get(match);
}
