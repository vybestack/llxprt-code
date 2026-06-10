/**
 * @plan:PLAN-20260608-ISSUE1586.P07
 * @requirement:REQ-INTF-001.1
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import type {
  ISecureStore,
  ISecureStoreError,
  SecureStoreErrorCode,
} from '../secure-store.js';

// ---------------------------------------------------------------------------
// In-memory test double implementing ISecureStore
// ---------------------------------------------------------------------------

class InMemorySecureStore implements ISecureStore {
  private readonly store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  async list(): Promise<string[]> {
    return Array.from(this.store.keys());
  }

  async has(key: string): Promise<boolean> {
    return this.store.has(key);
  }
}

// ---------------------------------------------------------------------------
// In-memory double that throws ISecureStoreError for error-path tests
// ---------------------------------------------------------------------------

class ThrowingSecureStore implements ISecureStore {
  constructor(private readonly errorCode: SecureStoreErrorCode) {}

  async get(_key: string): Promise<string | null> {
    throw this.createError(this.errorCode, 'get failed');
  }

  async set(_key: string, _value: string): Promise<void> {
    throw this.createError(this.errorCode, 'set failed');
  }

  async delete(_key: string): Promise<boolean> {
    throw this.createError(this.errorCode, 'delete failed');
  }

  async list(): Promise<string[]> {
    throw this.createError(this.errorCode, 'list failed');
  }

  async has(_key: string): Promise<boolean> {
    throw this.createError(this.errorCode, 'has failed');
  }

  private createError(
    code: SecureStoreErrorCode,
    remediation: string,
  ): ISecureStoreError {
    const error = new Error(`SecureStore error: ${code}`) as ISecureStoreError;
    error.code = code;
    error.remediation = remediation;
    return error;
  }
}

// Capture the rejected error value from a promise for assertion
async function captureError(
  promise: Promise<unknown>,
): Promise<ISecureStoreError> {
  const result = await promise.then(
    () => null,
    (e: unknown) => e as ISecureStoreError,
  );
  expect(result).not.toBeNull();
  expect(result).toBeInstanceOf(Error);
  return result!;
}

// ---------------------------------------------------------------------------
// Contract tests
// ---------------------------------------------------------------------------

describe('ISecureStore contract', () => {
  describe('save → get round-trip', () => {
    it('returns the value previously saved under a key', async () => {
      const store: ISecureStore = new InMemorySecureStore();
      await store.set('token:provider-a', 'secret-value');
      const result = await store.get('token:provider-a');
      expect(result).toBe('secret-value');
    });

    it('returns null for a key that was never set', async () => {
      const store: ISecureStore = new InMemorySecureStore();
      const result = await store.get('nonexistent');
      expect(result).toBeNull();
    });

    it('overwrites a previous value on re-set', async () => {
      const store: ISecureStore = new InMemorySecureStore();
      await store.set('k', 'v1');
      await store.set('k', 'v2');
      expect(await store.get('k')).toBe('v2');
    });

    it('handles multiple independent keys', async () => {
      const store: ISecureStore = new InMemorySecureStore();
      await store.set('a', '1');
      await store.set('b', '2');
      expect(await store.get('a')).toBe('1');
      expect(await store.get('b')).toBe('2');
    });
  });

  describe('delete', () => {
    it('removes an entry and returns true when key existed', async () => {
      const store: ISecureStore = new InMemorySecureStore();
      await store.set('target', 'val');
      const deleted = await store.delete('target');
      expect(deleted).toBe(true);
      expect(await store.get('target')).toBeNull();
    });

    it('returns false when deleting a nonexistent key', async () => {
      const store: ISecureStore = new InMemorySecureStore();
      const deleted = await store.delete('nope');
      expect(deleted).toBe(false);
    });
  });

  describe('list', () => {
    it('returns all stored keys', async () => {
      const store: ISecureStore = new InMemorySecureStore();
      await store.set('alpha', '1');
      await store.set('beta', '2');
      await store.set('gamma', '3');
      const keys = await store.list();
      const sorted = keys.toSorted();
      expect(sorted).toStrictEqual(['alpha', 'beta', 'gamma']);
    });

    it('returns an empty array when nothing is stored', async () => {
      const store: ISecureStore = new InMemorySecureStore();
      const keys = await store.list();
      expect(keys).toStrictEqual([]);
    });

    it('reflects deletions', async () => {
      const store: ISecureStore = new InMemorySecureStore();
      await store.set('keep', 'yes');
      await store.set('remove', 'no');
      await store.delete('remove');
      const keys = await store.list();
      expect(keys).toStrictEqual(['keep']);
    });
  });

  describe('has', () => {
    it('returns true when key exists', async () => {
      const store: ISecureStore = new InMemorySecureStore();
      await store.set('present', 'value');
      expect(await store.has('present')).toBe(true);
    });

    it('returns false when key does not exist', async () => {
      const store: ISecureStore = new InMemorySecureStore();
      expect(await store.has('absent')).toBe(false);
    });

    it('returns false after key is deleted', async () => {
      const store: ISecureStore = new InMemorySecureStore();
      await store.set('ephemeral', 'gone-soon');
      await store.delete('ephemeral');
      expect(await store.has('ephemeral')).toBe(false);
    });
  });

  describe('error handling', () => {
    it('throws ISecureStoreError with CORRUPT code when store is corrupt', async () => {
      const store: ISecureStore = new ThrowingSecureStore('CORRUPT');
      const error = await captureError(store.get('any'));
      expect(error.code).toBe('CORRUPT');
      expect(error.remediation).toBe('get failed');
    });

    it('throws ISecureStoreError with LOCKED code when store is locked', async () => {
      const store: ISecureStore = new ThrowingSecureStore('LOCKED');
      const error = await captureError(store.set('k', 'v'));
      expect(error.code).toBe('LOCKED');
      expect(error.remediation).toBe('set failed');
    });

    it('throws ISecureStoreError with DENIED code on permission failure', async () => {
      const store: ISecureStore = new ThrowingSecureStore('DENIED');
      const error = await captureError(store.delete('k'));
      expect(error.code).toBe('DENIED');
    });

    it('throws ISecureStoreError with NOT_FOUND code', async () => {
      const store: ISecureStore = new ThrowingSecureStore('NOT_FOUND');
      const error = await captureError(store.has('k'));
      expect(error.code).toBe('NOT_FOUND');
    });

    it('throws ISecureStoreError with UNAVAILABLE code', async () => {
      const store: ISecureStore = new ThrowingSecureStore('UNAVAILABLE');
      const error = await captureError(store.list());
      expect(error.code).toBe('UNAVAILABLE');
    });

    it('throws ISecureStoreError with TIMEOUT code', async () => {
      const store: ISecureStore = new ThrowingSecureStore('TIMEOUT');
      const error = await captureError(store.get('k'));
      expect(error.code).toBe('TIMEOUT');
    });
  });
});
