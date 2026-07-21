/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for turnJsonUtils helpers (issue #2607 OCR finding 5).
 * Focuses on edge cases: safeJsonStringify must always return a string, and
 * isAbortSignalActive must use strict checks without type assertions.
 */

import { describe, it, expect } from 'vitest';
import { safeJsonStringify, isAbortSignalActive } from './turnJsonUtils.js';

describe('safeJsonStringify', () => {
  it('returns a string for a normal object', () => {
    const result = safeJsonStringify({ a: 1 });
    expect(typeof result).toBe('string');
    expect(JSON.parse(result)).toStrictEqual({ a: 1 });
  });

  it('always returns a string for undefined (JSON.stringify returns undefined)', () => {
    const result = safeJsonStringify(undefined);
    expect(typeof result).toBe('string');
    // JSON.stringify(undefined) === undefined, so we must synthesize a string.
    expect(result).toBe('undefined');
  });

  it('always returns a string for a function (JSON.stringify returns undefined)', () => {
    const result = safeJsonStringify(() => 42);
    expect(typeof result).toBe('string');
    expect(result).toBe('undefined');
  });

  it('always returns a string for a symbol (JSON.stringify returns undefined)', () => {
    const result = safeJsonStringify(Symbol('s'));
    expect(typeof result).toBe('string');
    expect(result).toBe('undefined');
  });

  it('returns a string for null', () => {
    const result = safeJsonStringify(null);
    expect(result).toBe('null');
  });

  it('handles circular references without throwing', () => {
    const obj: Record<string, unknown> = {};
    obj.self = obj;
    const result = safeJsonStringify(obj);
    expect(typeof result).toBe('string');
    expect(result).toContain('[Circular]');
  });

  it('sorts object keys deterministically', () => {
    const result = safeJsonStringify({ b: 2, a: 1 });
    const parsed = JSON.parse(result) as Record<string, unknown>;
    expect(Object.keys(parsed)).toStrictEqual(['a', 'b']);
  });

  it('serializes BigInt values as JSON strings', () => {
    expect(safeJsonStringify(1n)).toBe('"1"');
  });
});

describe('isAbortSignalActive', () => {
  it('returns false for undefined', () => {
    expect(isAbortSignalActive(undefined)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isAbortSignalActive(null)).toBe(false);
  });

  it('returns false for a non-aborted AbortSignal', () => {
    expect(isAbortSignalActive(new AbortController().signal)).toBe(false);
  });

  it('returns true for an aborted AbortSignal', () => {
    const controller = new AbortController();
    controller.abort();
    expect(isAbortSignalActive(controller.signal)).toBe(true);
  });

  it('returns false for a plain object without aborted property', () => {
    expect(isAbortSignalActive({})).toBe(false);
  });

  it('returns false for an object whose aborted is not exactly true', () => {
    expect(isAbortSignalActive({ aborted: 'true' })).toBe(false);
    expect(isAbortSignalActive({ aborted: 1 })).toBe(false);
    expect(isAbortSignalActive({ aborted: undefined })).toBe(false);
  });

  it('returns true for an AbortSignal-like object with aborted === true', () => {
    expect(isAbortSignalActive({ aborted: true })).toBe(true);
  });
});
