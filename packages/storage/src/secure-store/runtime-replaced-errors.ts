/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Replaced-runtime error constants and warning helper for issue #2926.
 *
 * Extracted from secure-store.ts to keep that file under the max-lines lint
 * threshold. These are the single source of truth for the fail-fast message,
 * remediation, and once-per-process warning.
 *
 * @plan PLAN-20260801-ISSUE2926
 * @requirement R3, R4
 */

import { SecureStoreError } from './secure-store-errors.js';
import { isRuntimeReplaced } from './runtime-identity.js';

/**
 * The cause message explaining why credential access is disabled.
 * @plan PLAN-20260801-ISSUE2926
 * @requirement R3
 */
export const RUNTIME_REPLACED_MESSAGE =
  "LLxprt's runtime was replaced on disk while this session was running (usually an npm upgrade). macOS can no longer verify this process's identity, so credential access is disabled to avoid a password-prompt storm.";

/**
 * The remediation: restart to recover, and do not click "Always Allow"
 * because it cannot take effect for this process.
 * @plan PLAN-20260801-ISSUE2926
 * @requirement R3
 */
export const RUNTIME_REPLACED_REMEDIATION =
  'Restart LLxprt to recover. Do not click "Always Allow" — it cannot take effect for this process.';

/**
 * Tracks whether the replaced-runtime warning has been emitted this process.
 * Ensures the warning fires at most once (R4).
 */
let runtimeReplacedWarned = false;

/**
 * Resets the process-wide replaced-runtime warning flag for testing.
 * @plan PLAN-20260801-ISSUE2926
 */
export function resetRuntimeReplacedWarningForTesting(): void {
  runtimeReplacedWarned = false;
}

/**
 * Returns whether the one-time warning has been emitted this process.
 * Used by tests to verify the once-per-process guarantee (R4).
 * @plan PLAN-20260801-ISSUE2926
 * @requirement R4
 */
export function hasRuntimeReplacedWarningBeenEmitted(): boolean {
  return runtimeReplacedWarned;
}

/**
 * Creates a SecureStoreError with the RUNTIME_REPLACED code — the distinct
 * terminal error identity that downstream fallback/swallow layers must
 * rethrow rather than absorb.
 *
 * @plan PLAN-20260801-ISSUE2926
 * @requirement R3
 */
export function runtimeReplacedError(): SecureStoreError {
  return new SecureStoreError(
    RUNTIME_REPLACED_MESSAGE,
    'RUNTIME_REPLACED',
    RUNTIME_REPLACED_REMEDIATION,
  );
}

/**
 * Throws a SecureStoreError (RUNTIME_REPLACED) when the running runtime has
 * been replaced on disk. Called at the keyring-loading boundary of each
 * credential operation so that zero OS keyring operations are attempted and
 * no encrypted fallback file diverges from the Keychain.
 *
 * The warning is routed through stderr (process.stderr.write) so it is
 * guaranteed to reach the user regardless of whether an injected logger
 * was provided — most production SecureStore instances use
 * NullStorageLoggerImpl which discards messages (R4).
 *
 * Overrides fallbackPolicy: 'allow' deliberately — silently writing the
 * fallback would diverge from the Keychain, and on the next healthy start
 * get() reads the keyring first and would return the stale pre-divergence
 * value (silent data loss).
 *
 * The warning is emitted at most once per process (R4).
 *
 * @plan PLAN-20260801-ISSUE2926
 * @requirement R3, R4
 */
export function assertRuntimeNotReplaced(): void {
  if (!isRuntimeReplaced()) {
    return;
  }
  if (!runtimeReplacedWarned) {
    runtimeReplacedWarned = true;
    emitRuntimeReplacedWarning();
  }
  throw runtimeReplacedError();
}

/**
 * Emits the one-time replaced-runtime warning to stderr, guaranteeing it
 * reaches the user independent of any injected logger.
 *
 * @plan PLAN-20260801-ISSUE2926
 * @requirement R4
 */
function emitRuntimeReplacedWarning(): void {
  try {
    process.stderr.write(
      `\n${RUNTIME_REPLACED_MESSAGE} ${RUNTIME_REPLACED_REMEDIATION}\n\n`,
    );
  } catch {
    // stderr can be closed or broken (EPIPE when piped into a command that
    // exits early). Losing the notice is acceptable; losing the terminal
    // RUNTIME_REPLACED error is not, because callers key their rethrow
    // decision on it. Swallow here so the caller always sees the real error.
  }
}
