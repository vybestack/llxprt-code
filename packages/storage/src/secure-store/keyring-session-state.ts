/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Process-wide OS keyring session state (issue #2928).
 *
 * Two independent reasons can disable the OS keyring for the remainder of a
 * process:
 *
 *   1. Latch (R2): the first DENIED or LOCKED classification observed from a
 *      keyring operation latches the keyring unusable, so LLxprt stops
 *      hammering a Keychain that will prompt (or fail) on every call. Exactly
 *      one user-visible warning is emitted on stderr — the same rationale as
 *      runtime-replaced-errors.ts: most production SecureStore instances use
 *      NullStorageLoggerImpl which discards logger output.
 *   2. Opt-out (R3): `LLXPRT_DISABLE_OS_KEYRING=1` or
 *      `security.disableOsKeyring` (propagated here via
 *      {@link setOsKeyringDisabledBySetting}) disables the keyring silently.
 *
 * Modelled directly on runtime-replaced-errors.ts (the closest existing
 * analogue): module-scoped boolean latches, an idempotent warning emitter
 * that swallows EPIPE, and a reset hook for tests.
 *
 * @plan PLAN-20260805-ISSUE2928
 * @requirement R2, R3
 */

import type { SecureStoreErrorCode } from './secure-store-errors.js';
import { classifyError } from './classify-error.js';

/**
 * The cause message emitted when the OS keyring is latched unusable.
 * @plan PLAN-20260805-ISSUE2928
 * @requirement R2.2
 */
export const OS_KEYRING_UNUSABLE_MESSAGE =
  'The OS keyring denied access or is locked. LLxprt has disabled it for this session to avoid repeated prompts; credential access now uses the encrypted file fallback.';

/**
 * The remediation: unlock the keyring or grant access, then restart to retry.
 * @plan PLAN-20260805-ISSUE2928
 * @requirement R2.2
 */
export const OS_KEYRING_UNUSABLE_REMEDIATION =
  'Unlock your keyring or grant LLxprt access, then restart LLxprt to retry the OS keyring.';

/**
 * Production environment marker that suppresses use of the real OS credential
 * store. Distinct from the test marker
 * (`LLXPRT_TEST_DISABLE_OS_KEYRING`) handled in default-keyring-adapter.ts:
 * test suites redirect storage roots but still sometimes need the genuine
 * keyring, so the two concerns cannot share one flag.
 */
const PROD_DISABLE_OS_KEYRING_ENV = 'LLXPRT_DISABLE_OS_KEYRING';

/** Latch state: set true by the first DENIED/LOCKED classification. */
let keyringDisabled = false;

/** Whether the one-time latch warning has been emitted this process. */
let warned = false;

/**
 * Opt-out state propagated from CLI settings
 * (`security.disableOsKeyring`). The env var is read directly (below) so it
 * always wins without a setter call. Storage is a low-level package and must
 * not read CLI settings, so the CLI pushes this boolean in during settings
 * load (R3.2).
 */
let disabledBySetting = false;

/**
 * Returns true when the production env-var opt-out is active.
 * @plan PLAN-20260805-ISSUE2928
 * @requirement R3.1
 */
export function isOsKeyringDisabledByEnv(): boolean {
  return process.env[PROD_DISABLE_OS_KEYRING_ENV] === '1';
}

/**
 * Returns true when the settings opt-out has been pushed in via
 * {@link setOsKeyringDisabledBySetting}.
 * @plan PLAN-20260805-ISSUE2928
 * @requirement R3.2
 */
export function isOsKeyringDisabledBySetting(): boolean {
  return disabledBySetting;
}

/**
 * Pushes the settings-derived opt-out into process-wide state. Called by the
 * CLI during settings load. The env var wins when both are present because it
 * is read directly in {@link isOsKeyringSessionDisabled} and in the adapter
 * factory, independent of this flag.
 * @plan PLAN-20260805-ISSUE2928
 * @requirement R3.2
 */
export function setOsKeyringDisabledBySetting(value: boolean): void {
  disabledBySetting = value;
}

/**
 * Returns true when the OS keyring must not be touched this process — either
 * because it was latched unusable (R2) or explicitly opted out (R3).
 *
 * SecureStore.getKeyring() consults this BEFORE invoking its loader, so zero
 * keyring operations occur after the transition — including for an instance
 * that had already cached an adapter.
 *
 * @plan PLAN-20260805-ISSUE2928
 * @requirement R2.3, R3.1
 */
export function isOsKeyringSessionDisabled(): boolean {
  return keyringDisabled || disabledBySetting || isOsKeyringDisabledByEnv();
}

/**
 * Returns whether the one-time latch warning has been emitted this process.
 * Used by tests to verify the once-per-process guarantee (R2.2).
 * @plan PLAN-20260805-ISSUE2928
 * @requirement R2.2
 */
export function hasOsKeyringWarningBeenEmitted(): boolean {
  return warned;
}

/**
 * Latches the OS keyring unusable when the classified code indicates an
 * authorization failure the user must intervene to fix (DENIED or LOCKED).
 * Idempotent: the FIRST qualifying call emits exactly one warning via stderr
 * and latches; subsequent calls are no-ops.
 *
 * Transient or environmental codes do NOT latch: TIMEOUT (transient),
 * UNAVAILABLE (no backend present — the adapter is already null),
 * NOT_FOUND (normal absence), and CORRUPT/CONFLICT (not authorization
 * failures). RUNTIME_REPLACED must NOT be absorbed — it stays terminal and
 * keeps propagating — so it is explicitly excluded here even though it is not
 * DENIED/LOCKED.
 *
 * @plan PLAN-20260805-ISSUE2928
 * @requirement R2.1, R2.6
 */
export function markOsKeyringUnusable(code: SecureStoreErrorCode): void {
  if (code !== 'DENIED' && code !== 'LOCKED') {
    return;
  }
  keyringDisabled = true;
  if (!warned) {
    warned = true;
    emitOsKeyringWarning();
  }
}

/**
 * Single shared classification + latch point for every keyring error, enforced
 * at the adapter boundary (createGuardedAdapter). Classifies the error, feeds
 * the code into the process-wide latch (which latches only on DENIED/LOCKED),
 * and returns the code. The caller rethrows the original error unchanged.
 *
 * This is the ONE chokepoint (R2.1/R2.3/R2.5): every consumer's adapter comes
 * from createDefaultKeyringAdapter, whose guarded wrapper routes every native
 * error through here before rethrowing. Consumers that hold an adapter directly
 * (machine-secret, MCP token storage) cannot bypass it.
 *
 * @plan PLAN-20260805-ISSUE2928
 * @requirement R2.1, R2.5, R2.6
 */
export function noteKeyringError(error: unknown): SecureStoreErrorCode {
  const code = classifyError(error);
  if (!isSyscallError(error)) {
    markOsKeyringUnusable(code);
  }
  return code;
}

/**
 * Whether the value is a Node syscall/filesystem error (an errno-shaped `code`
 * such as EACCES, EPERM, ENOSPC).
 *
 * Such errors must not latch. `classifyError` matches on message substrings, so
 * a filesystem "permission denied" (EACCES writing a cache/temp file) or a
 * "resource locked" message classifies as DENIED/LOCKED even though the OS
 * keyring itself never refused anything. Latching on that would disable the
 * keyring for the whole process over an unrelated, often transient, condition.
 * The classification is still returned so callers keep their existing
 * degradation behavior — only the irreversible latch is suppressed.
 */
function isSyscallError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  if (!('code' in error) || typeof error.code !== 'string') {
    return false;
  }
  return /^E[A-Z]{2,}$/.test(error.code);
}

/**
 * Emits the one-time latch warning to stderr, guaranteeing it reaches the user
 * independent of any injected logger. Swallows EPIPE (broken pipe when piped
 * into a command that exits early): losing the notice is acceptable; the latch
 * itself still holds and callers key their behaviour on
 * {@link isOsKeyringSessionDisabled}.
 *
 * @plan PLAN-20260805-ISSUE2928
 * @requirement R2.2
 */
function emitOsKeyringWarning(): void {
  try {
    process.stderr.write(
      `\n${OS_KEYRING_UNUSABLE_MESSAGE} ${OS_KEYRING_UNUSABLE_REMEDIATION}\n\n`,
    );
  } catch {
    // stderr closed/broken (EPIPE). The latch still holds; only the notice
    // is lost, which is acceptable.
  }
}

/**
 * Resets the process-wide OS keyring session state for testing. Clears the
 * latch, the warning flag, and the settings opt-out. The env var is external
 * and managed by the test harness directly.
 * @plan PLAN-20260805-ISSUE2928
 */
export function resetOsKeyringSessionForTesting(): void {
  keyringDisabled = false;
  warned = false;
  disabledBySetting = false;
}
