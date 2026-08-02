/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Dependency-leaf module for SecureStore error types.
 *
 * Extracted from secure-store.ts so that runtime-replaced detection and
 * error helpers can value-import `SecureStoreError` / `SecureStoreErrorCode`
 * without creating a cycle back into secure-store.ts (which imports them).
 *
 * @plan PLAN-20260801-ISSUE2926
 * @requirement R3
 */

/**
 * Error codes for SecureStore operations.
 *
 * `RUNTIME_REPLACED` is a terminal error identity introduced in issue #2926.
 * Downstream fallback and swallow layers that degrade on ordinary
 * `UNAVAILABLE` MUST rethrow `RUNTIME_REPLACED` rather than absorb it —
 * absorbing it would diverge the fallback file from the Keychain, causing
 * silent stale-value data loss on the next healthy start.
 *
 * @plan PLAN-20260801-ISSUE2926
 * @requirement R3
 */
export type SecureStoreErrorCode =
  | 'UNAVAILABLE'
  | 'LOCKED'
  | 'DENIED'
  | 'CORRUPT'
  | 'TIMEOUT'
  | 'NOT_FOUND'
  | 'RUNTIME_REPLACED';

/**
 * Type guard: narrows an unknown thrown value to a SecureStoreError.
 *
 * @plan PLAN-20260801-ISSUE2926
 */
export function isSecureStoreError(error: unknown): error is SecureStoreError {
  return error instanceof SecureStoreError;
}

/**
 * Type guard: narrows to a SecureStoreError whose code is RUNTIME_REPLACED.
 *
 * Used by fallback/swallow layers that must rethrow terminal replaced-runtime
 * errors while still degrading on ordinary UNAVAILABLE.
 *
 * Identification is **structural** (duck-typed on the `code` value), NOT based
 * on `instanceof SecureStoreError`. Downstream consumers in other packages
 * (core, cli, auth) rely on this guard to decide whether to rethrow instead of
 * degrading to a fallback file. If two copies of `SecureStoreError` ever exist
 * (bundling, duplicated dependency resolution), `instanceof` silently returns
 * false and the layer degrades — which is precisely the silent divergence /
 * data-loss path this PR exists to prevent. Failing open here is the worst
 * possible failure mode.
 *
 * Consistent with `isRuntimeReplacedStoreError` in
 * packages/auth/src/interfaces/secure-store.ts, which is already structural.
 *
 * @plan PLAN-20260801-ISSUE2926
 * @requirement R3
 */
export function isRuntimeReplacedError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'RUNTIME_REPLACED'
  );
}

/**
 * Error thrown by SecureStore operations.
 *
 * @plan PLAN-20260801-ISSUE2926
 */
export class SecureStoreError extends Error {
  readonly code: SecureStoreErrorCode;
  readonly remediation: string;

  constructor(
    message: string,
    code: SecureStoreErrorCode,
    remediation: string,
  ) {
    super(message);
    this.name = 'SecureStoreError';
    this.code = code;
    this.remediation = remediation;
  }
}
