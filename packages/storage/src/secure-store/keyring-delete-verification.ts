/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Keyring delete verification.
 *
 * Reads back the credential after a delete to check whether it is actually
 * gone. This is necessary on every platform because `@napi-rs/keyring`'s
 * `deleteCredential()` erases backend errors into a boolean: on Linux/Windows
 * failures collapse to `false`, and on macOS the OSStatus is discarded at
 * three layers below the binding so failures collapse to `true`. Absence is
 * decided by `=== null` only — the empty string is a present credential.
 *
 * A rejecting read-back propagates, because absence cannot be confirmed and
 * claiming the secret is gone would be the exact failure this module exists
 * to detect.
 *
 * Known limitation: this detects a credential that remains *readable* after a
 * delete (the macOS silent-failure case, ACL denials, partial backend
 * failure). It does NOT detect a fully locked store (the read erases to
 * `null`) or `Ambiguous` collisions (the binding erases the ambiguous read
 * error to `null`, so the probe reports absent for a credential that still
 * exists). Completeness requires the upstream fix; see
 * project-plans/issue3011/plan.md for the full matrix.
 *
 * @plan PLAN-20260804-ISSUE3011
 * @requirement R1
 */

/**
 * Discriminated outcome of a post-delete read-back probe.
 *
 * - `absent` — read-back is `null`; the credential is gone.
 * - `still-present` — read-back is a value (including the empty string); the
 *   delete did not take effect.
 *
 * @plan PLAN-20260804-ISSUE3011
 * @requirement R1
 */
export type KeyringDeleteOutcome = 'absent' | 'still-present';

/**
 * Reads back the credential after a delete and classifies whether it is gone.
 *
 * Takes a thunk rather than a `KeyringAdapter` because the adapter is still
 * under construction inside the factory when this runs.
 *
 * @plan PLAN-20260804-ISSUE3011
 * @requirement R1
 */
export async function verifyKeyringDelete(
  readBack: () => Promise<string | null>,
): Promise<KeyringDeleteOutcome> {
  const value = await readBack();
  return value === null ? 'absent' : 'still-present';
}
