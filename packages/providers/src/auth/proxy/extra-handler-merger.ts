/**
 * @license
 * Copyright 2025 Vybestack LLC
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
      builtIn[key] = handler as T;
    }
  }
}
