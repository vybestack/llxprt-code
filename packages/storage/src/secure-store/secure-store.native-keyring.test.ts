/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import * as crypto from 'node:crypto';
import { SecureStore } from './secure-store.js';

const SERVICE_PREFIX = 'llxprt-code-native-smoke';

function createStore(): SecureStore {
  return new SecureStore(
    `${SERVICE_PREFIX}-${crypto.randomUUID().substring(0, 8)}`,
    { fallbackPolicy: 'deny' },
  );
}

function uniqueKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().substring(0, 8)}`;
}

describe('SecureStore native keyring', () => {
  const entriesToClean: Array<{ store: SecureStore; key: string }> = [];

  afterEach(async () => {
    const entries = entriesToClean.splice(0);
    const results = await Promise.allSettled(
      entries.map(({ store, key }) => store.delete(key)),
    );
    const failures = entries
      .map(({ key }, index) => ({ key, result: results[index] }))
      .filter(
        (entry): entry is { key: string; result: PromiseRejectedResult } =>
          entry.result.status === 'rejected',
      );

    if (failures.length > 0) {
      const details = failures
        .map(({ key, result }) => `  • ${key}: ${String(result.reason)}`)
        .join('\n');
      throw new Error(
        `afterEach cleanup failed to delete ${failures.length} keyring entry(ies), leaving real OS keyring pollution:\n${details}`,
      );
    }
  });

  it('sets and gets a value through the real OS keyring', async () => {
    const store = createStore();
    const key = uniqueKey('roundtrip');
    const value = `secret-${crypto.randomUUID()}`;
    entriesToClean.push({ store, key });

    await store.set(key, value);

    expect(await store.get(key)).toBe(value);
  });

  it('reports whether a real OS keyring entry exists', async () => {
    const store = createStore();
    const key = uniqueKey('has');
    entriesToClean.push({ store, key });

    expect(await store.has(key)).toBe(false);

    await store.set(key, `secret-${crypto.randomUUID()}`);

    expect(await store.has(key)).toBe(true);
  });

  it('deletes a real OS keyring entry', async () => {
    const store = createStore();
    const key = uniqueKey('delete');
    entriesToClean.push({ store, key });
    await store.set(key, `secret-${crypto.randomUUID()}`);

    expect(await store.delete(key)).toBe(true);
    expect(await store.get(key)).toBeNull();
  });

  it('reports the real OS keyring as available', async () => {
    expect(await createStore().isKeychainAvailable()).toBe(true);
  });
});
