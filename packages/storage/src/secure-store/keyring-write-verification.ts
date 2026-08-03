/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Non-destructive keyring write verification.
 *
 * After `setPassword`, a read-back probe classifies the result into one of
 * three outcomes. A mismatched non-null value is a **conflict** (another
 * process owns the item) — it is NEVER deleted. The observed foreign value is
 * never returned or logged (no secret material may escape).
 *
 * @plan PLAN-20260801-ISSUE2927
 * @requirement R1, R2
 */

import type { KeyringAdapter } from './secure-store.js';

/**
 * Discriminated outcome of a post-write read-back probe.
 *
 * - `verified` — read-back equals the value this process just wrote.
 * - `conflict` — read-back is a different non-null value (another process won
 *   the race). The winner is left untouched.
 * - `unverified` — read-back is null or threw, so correctness cannot be
 *   confirmed.
 *
 * @plan PLAN-20260801-ISSUE2927
 * @requirement R1, R2
 */
export type KeyringWriteOutcome =
  | { readonly outcome: 'verified' }
  | { readonly outcome: 'conflict' }
  | { readonly outcome: 'unverified' };

/**
 * Reads back the credential and classifies the result without any destructive
 * side effect.
 *
 * @plan PLAN-20260801-ISSUE2927
 * @requirement R1, R2
 */
export async function verifyKeyringWrite(
  adapter: KeyringAdapter,
  serviceName: string,
  key: string,
  expected: string,
): Promise<KeyringWriteOutcome> {
  let readBack: string | null;
  try {
    readBack = await adapter.getPassword(serviceName, key);
  } catch {
    return { outcome: 'unverified' };
  }
  if (readBack === expected) {
    return { outcome: 'verified' };
  }
  if (readBack === null) {
    return { outcome: 'unverified' };
  }
  return { outcome: 'conflict' };
}
