/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Dependency-leaf error classifier for OS keyring errors (issue #2928).
 *
 * Extracted from secure-store.ts so the adapter boundary
 * (default-keyring-adapter.ts → createGuardedAdapter) can classify and latch
 * on keyring errors WITHOUT importing from secure-store.ts (which would create
 * a cycle, since secure-store.ts imports default-keyring-adapter.ts). Imports
 * only `SecureStoreErrorCode` / `isSecureStoreError` from secure-store-errors.ts
 * (a true dependency leaf), so it introduces no cycles.
 *
 * @plan PLAN-20260805-ISSUE2928
 * @requirement R1.1, R2.5
 */

import {
  isSecureStoreError,
  type SecureStoreErrorCode,
} from './secure-store-errors.js';

function isErrorWithCode(value: unknown): value is { code: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof value.code === 'string'
  );
}

/**
 * Classifies an unknown thrown value into a SecureStoreErrorCode using message
 * heuristics. A SecureStoreError already carries an authoritative code and is
 * returned as-is.
 *
 * Ordering matters: the "access platform storage" check runs BEFORE the
 * cancellation/denied checks so a headless "no Secret Service" machine is
 * classified UNAVAILABLE (degradable) rather than DENIED (latching).
 *
 * The cancellation test is narrowly targeted at genuine
 * USER cancellation only. A bare `msg.includes('cancel')` would also match
 * abort/timeout text such as "request cancelled due to timeout"
 * (@napi-rs/keyring accepts an AbortSignal on every method), which would
 * irreversibly latch the keyring off for the whole process. Only the macOS
 * status names and explicit user-cancellation phrasing match.
 *
 * @plan PLAN-20260805-ISSUE2928
 * @requirement R1.1
 */
// Read-path limitation: @napi-rs/keyring (every published version through
// 1.3.0, the latest) does `Ok(self.inner.get_password().ok())` in
// PasswordTask::compute, discarding the OSStatus, so getPassword returns null
// for BOTH a denial and a genuine absence. The classifications below therefore
// only fire on the write, delete-verification and probe paths, which do
// propagate errors. Recovering read-path fidelity requires changing the native
// binding — tracked in issue #3067.
export function classifyError(error: unknown): SecureStoreErrorCode {
  // A SecureStoreError already carries an authoritative classification.
  // RUNTIME_REPLACED in particular matches none of the message heuristics
  // below and would be downgraded to UNAVAILABLE, which the get()/has()
  // fallback paths are allowed to swallow — absorbing a terminal error that
  // the runtime-replaced invariant requires callers to rethrow.
  if (isSecureStoreError(error)) {
    return error.code;
  }
  const msg =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();
  // "Couldn't access platform storage: PermissionDenied" is what the keyring
  // crate reports when the machine has no Secret Service at all — a headless
  // Linux box, container, ssh session or WSL. Despite the wording it means "no
  // credential backend here", not "you lack permission to use one", so it has
  // to be classified UNAVAILABLE and degrade to the encrypted file. Checked
  // before the generic denied/permission test below, which would otherwise
  // match on the substring and turn a routine no-keyring machine into a hard
  // error.
  if (msg.includes('access platform storage')) return 'UNAVAILABLE';
  // macOS errSecUserCanceled and explicit user-cancellation messages. Narrowly
  // targeted: a bare "cancel" substring would also match abort/timeout
  // messages like "request cancelled due to timeout", which would irreversibly
  // latch the keyring off for the whole process. @napi-rs/keyring accepts an
  // AbortSignal on every method, so abort-related text must NOT latch. Only
  // genuine USER cancellation matches. `cancell?ed` covers both the US
  // "canceled" and the British "cancelled" spellings.
  if (
    msg.includes('errsecusercanceled') ||
    msg.includes('errseccanceled') ||
    /\buser cancell?ed\b/.test(msg) ||
    /cancell?ed by the user\b/.test(msg)
  ) {
    return 'DENIED';
  }
  if (msg.includes('locked')) return 'LOCKED';
  if (msg.includes('denied') || msg.includes('permission')) return 'DENIED';
  if (msg.includes('timeout') || msg.includes('timed out')) return 'TIMEOUT';
  if (msg.includes('not found')) return 'NOT_FOUND';
  if (isErrorWithCode(error) && error.code === 'ENOENT') return 'NOT_FOUND';
  return 'UNAVAILABLE';
}
