/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Factory functions for creating credential stores that automatically detect
 * whether we're running inside a sandbox (proxy mode) or on the host (direct mode).
 *
 * **This module is the single entry point for obtaining TokenStore and
 * ProviderKeyStorage instances.** Direct instantiation of `KeyringTokenStore`
 * or calls to `getProviderKeyStorage()` from consumer code are prohibited.
 * Use `createTokenStore()` and `createProviderKeyStorage()` instead.
 *
 * @plan PLAN-20250214-CREDPROXY.P32
 * @plan PLAN-20250214-CREDPROXY.P36
 * @requirement R2.3, R2.4, R9.5
 */

import type {
  ProviderKeyStorage,
  TokenStore,
} from '@vybestack/llxprt-code-core';
import {
  getProviderKeyStorage,
  KeyringTokenStore,
  ProxyProviderKeyStorage,
  ProxySocketClient,
  ProxyTokenStore,
} from '@vybestack/llxprt-code-core';

let proxyTokenStore: ProxyTokenStore | undefined;
let directTokenStore: KeyringTokenStore | undefined;
let proxyKeyStorage: ProxyProviderKeyStorage | undefined;
let directKeyStorage: ProviderKeyStorage | undefined;

/**
 * Creates or returns a singleton TokenStore appropriate for the current environment.
 *
 * **This is the ONLY sanctioned way to obtain a TokenStore instance.**
 * Do not instantiate `KeyringTokenStore` or `ProxyTokenStore` directly.
 *
 * - When LLXPRT_CREDENTIAL_SOCKET env var is set: returns ProxyTokenStore
 * - Otherwise: returns KeyringTokenStore (direct host access)
 *
 * The singleton is cached per-mode, so switching between proxy and direct modes
 * will return the appropriate cached instance for each mode.
 *
 * @plan PLAN-20250214-CREDPROXY.P36
 */
export function createTokenStore(): TokenStore {
  const socketPath = process.env.LLXPRT_CREDENTIAL_SOCKET;
  if (socketPath) {
    if (!proxyTokenStore) {
      proxyTokenStore = new ProxyTokenStore(socketPath);
    }
    return proxyTokenStore;
  } else {
    if (!directTokenStore) {
      directTokenStore = new KeyringTokenStore();
    }
    return directTokenStore;
  }
}

/**
 * Creates or returns a singleton ProviderKeyStorage appropriate for the current environment.
 *
 * **This is the ONLY sanctioned way to obtain a ProviderKeyStorage instance.**
 * Do not call `getProviderKeyStorage()` directly or instantiate `ProviderKeyStorage`.
 *
 * - When LLXPRT_CREDENTIAL_SOCKET env var is set: returns ProxyProviderKeyStorage (read-only)
 * - Otherwise: returns the direct ProviderKeyStorage singleton
 *
 * @plan PLAN-20250214-CREDPROXY.P36
 */
export function createProviderKeyStorage(): ProviderKeyStorage {
  const socketPath = process.env.LLXPRT_CREDENTIAL_SOCKET;
  if (socketPath) {
    if (!proxyKeyStorage) {
      const client = new ProxySocketClient(socketPath);
      proxyKeyStorage = new ProxyProviderKeyStorage(client);
    }
    return proxyKeyStorage as unknown as ProviderKeyStorage;
  } else {
    if (!directKeyStorage) {
      directKeyStorage = getProviderKeyStorage();
    }
    return directKeyStorage;
  }
}

/**
 * Resets factory singletons. Used for test isolation.
 */
export function resetFactorySingletons(): void {
  proxyTokenStore = undefined;
  directTokenStore = undefined;
  proxyKeyStorage = undefined;
  directKeyStorage = undefined;
}
