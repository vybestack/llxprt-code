/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the SecureStore error type guards (issue #2926).
 *
 * The central concern: `isRuntimeReplacedError` must identify the terminal
 * condition **structurally** (duck-typed on the `code` value), not via
 * `instanceof SecureStoreError`. Downstream consumers in other packages rely
 * on it to decide whether to rethrow instead of degrading to a fallback file.
 * If two copies of the class ever exist (bundling, duplicated dependency
 * resolution), `instanceof` silently returns false and the layer degrades —
 * the silent divergence / data-loss path this PR exists to prevent.
 *
 * @plan PLAN-20260801-ISSUE2926
 * @requirement R3
 */

import { describe, it, expect } from 'bun:test';
import {
  SecureStoreError,
  isSecureStoreError,
  isRuntimeReplacedError,
  type SecureStoreErrorCode,
} from './secure-store-errors.js';

describe('isSecureStoreError', () => {
  it('returns true for a SecureStoreError instance', () => {
    const error = new SecureStoreError('msg', 'UNAVAILABLE', 'retry');
    expect(isSecureStoreError(error)).toBe(true);
  });

  it('returns false for a plain Error', () => {
    expect(isSecureStoreError(new Error('boom'))).toBe(false);
  });

  it('returns false for a non-error value', () => {
    expect(isSecureStoreError(null)).toBe(false);
    expect(isSecureStoreError('string')).toBe(false);
    expect(isSecureStoreError(undefined)).toBe(false);
  });
});

describe('isRuntimeReplacedError', () => {
  it('returns true for a SecureStoreError with code RUNTIME_REPLACED', () => {
    const error = new SecureStoreError(
      'runtime replaced',
      'RUNTIME_REPLACED',
      'restart',
    );
    expect(isRuntimeReplacedError(error)).toBe(true);
  });

  it('returns false for a SecureStoreError with a different code', () => {
    const error = new SecureStoreError('unavailable', 'UNAVAILABLE', 'retry');
    expect(isRuntimeReplacedError(error)).toBe(false);
  });

  it('returns false for a plain Error', () => {
    expect(isRuntimeReplacedError(new Error('boom'))).toBe(false);
  });

  it('returns false for non-object values', () => {
    expect(isRuntimeReplacedError(null)).toBe(false);
    expect(isRuntimeReplacedError('RUNTIME_REPLACED')).toBe(false);
    expect(isRuntimeReplacedError(undefined)).toBe(false);
    expect(isRuntimeReplacedError(42)).toBe(false);
  });

  it('returns false for an object without a code property', () => {
    expect(isRuntimeReplacedError({ message: 'no code' })).toBe(false);
  });

  /**
   * THE critical cross-package test. Simulates the duplicate-class-identity
   * case: a different class (as would arise from bundling or duplicated
   * dependency resolution) that is structurally identical to SecureStoreError.
   * `instanceof SecureStoreError` would return false for this object, causing
   * the downstream fallback layer to degrade — the silent data-loss path.
   * The structural guard must still return true so the terminal error is
   * rethrown, not absorbed.
   *
   * @plan PLAN-20260801-ISSUE2926
   * @requirement R3
   */
  it('returns true for a structurally-equivalent error from a DIFFERENT class identity (duplicate-class simulation)', () => {
    // A completely independent class that mimics SecureStoreError's shape.
    // This is NOT a subclass of SecureStoreError, so instanceof fails.
    class AlienSecureStoreError extends Error {
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

    const alien = new AlienSecureStoreError(
      'runtime replaced',
      'RUNTIME_REPLACED',
      'restart',
    );

    // Proof that instanceof fails across the class-identity boundary —
    // this is exactly the failure mode the structural guard protects against.
    expect(alien instanceof SecureStoreError).toBe(false);

    // The structural guard MUST still identify it as terminal, so downstream
    // fallback layers rethrow rather than degrade to a stale fallback file.
    expect(isRuntimeReplacedError(alien)).toBe(true);
  });
});
