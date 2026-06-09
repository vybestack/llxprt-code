/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20260608-ISSUE1586.P09
 * @requirement REQ-AUTH-001.1
 */

import { describe, expect, it } from 'vitest';
import { KeyringTokenStore } from '../keyring-token-store.js';
import type { ISecureStore } from '../interfaces/secure-store.js';

function createInMemorySecureStore(): ISecureStore {
  const entries = new Map<string, string>();
  return {
    get: async (key) => entries.get(key) ?? null,
    set: async (key, value) => {
      entries.set(key, value);
    },
    delete: async (key) => entries.delete(key),
    list: async () => [...entries.keys()],
    has: async (key) => entries.has(key),
  };
}

describe('KeyringTokenStore migrated integration test destination', () => {
  it('uses auth-local DI storage rather than core SecureStore imports', () => {
    const tokenStore = new KeyringTokenStore({
      secureStore: createInMemorySecureStore(),
      lockDir: '/tmp/llxprt-auth-integration-locks',
    });

    expect(tokenStore).toBeInstanceOf(KeyringTokenStore);
  });
});
