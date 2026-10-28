/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Resolve the provider name, defaulting to 'backend' when persisted runtime
 * state carries a nullish provider. A defined value, including an empty
 * string, passes through unchanged.
 */
export function providerNameOrDefault(
  provider: string | null | undefined,
): string {
  if (provider === null || provider === undefined) {
    return 'backend';
  }
  return provider;
}
