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

// @plan:PLAN-20260608-ISSUE1586.P15 — auth types from auth package
import type {
  TokenStore,
  KeyringTokenStore,
} from '@vybestack/llxprt-code-auth';
import {
  ProxyProviderKeyStorage,
  ProxySocketClient,
  ProxyTokenStore,
} from '@vybestack/llxprt-code-auth';
import { createKeyringTokenStore } from '@vybestack/llxprt-code-core';
// ProviderKeyStorage now lives in the storage package
import type {
  ProviderKeyStorage,
  ProviderKeyStorageLike,
} from '@vybestack/llxprt-code-storage';
import { getProviderKeyStorage } from '@vybestack/llxprt-code-storage';

let proxyTokenStore: ProxyTokenStore | undefined;
let proxyTokenStoreCapabilityToken: string | undefined;
let proxyTokenStoreSocketPath: string | undefined;
let directTokenStore: KeyringTokenStore | undefined;
let proxyKeyStorage: ProxyProviderKeyStorage | undefined;
let proxyKeyStorageClient: ProxySocketClient | undefined;
let proxyKeyStorageCapabilityToken: string | undefined;
let proxyKeyStorageSocketPath: string | undefined;
let directKeyStorage: ProviderKeyStorage | undefined;

/**
 * Reads and validates the LLXPRT_CAPABILITY_TOKEN env var.
 * Returns undefined if unset or empty so the client omits it from
 * the handshake (matching the "no token" behavior).
 */
function readCapabilityToken(): string | undefined {
  const raw = process.env.LLXPRT_CAPABILITY_TOKEN;
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

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
    const capabilityToken = readCapabilityToken();
    if (
      proxyTokenStore === undefined ||
      proxyTokenStoreCapabilityToken !== capabilityToken ||
      proxyTokenStoreSocketPath !== socketPath
    ) {
      proxyTokenStore?.getClient().close();
      proxyTokenStore = new ProxyTokenStore(socketPath, capabilityToken);
      proxyTokenStoreCapabilityToken = capabilityToken;
      proxyTokenStoreSocketPath = socketPath;
    }
    return proxyTokenStore;
  }
  // Clean up stale proxy singletons when switching to direct mode
  if (proxyTokenStore !== undefined) {
    proxyTokenStore.getClient().close();
    proxyTokenStore = undefined;
    proxyTokenStoreCapabilityToken = undefined;
    proxyTokenStoreSocketPath = undefined;
  }
  directTokenStore ??= createKeyringTokenStore();
  return directTokenStore;
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
export function createProviderKeyStorage(): ProviderKeyStorageLike {
  const socketPath = process.env.LLXPRT_CREDENTIAL_SOCKET;
  if (socketPath) {
    const capabilityToken = readCapabilityToken();
    if (
      proxyKeyStorage === undefined ||
      proxyKeyStorageCapabilityToken !== capabilityToken ||
      proxyKeyStorageSocketPath !== socketPath
    ) {
      proxyKeyStorageClient?.close();
      proxyKeyStorageClient = new ProxySocketClient(
        socketPath,
        capabilityToken,
      );
      proxyKeyStorage = new ProxyProviderKeyStorage(proxyKeyStorageClient);
      proxyKeyStorageCapabilityToken = capabilityToken;
      proxyKeyStorageSocketPath = socketPath;
    }
    return proxyKeyStorage;
  }
  // Clean up stale proxy singletons when switching to direct mode
  if (proxyKeyStorage !== undefined) {
    proxyKeyStorageClient?.close();
    proxyKeyStorageClient = undefined;
    proxyKeyStorage = undefined;
    proxyKeyStorageCapabilityToken = undefined;
    proxyKeyStorageSocketPath = undefined;
  }
  directKeyStorage ??= getProviderKeyStorage();
  return directKeyStorage;
}

/**
 * Resets factory singletons. Used for test isolation.
 */
export function resetFactorySingletons(): void {
  proxyTokenStore?.getClient().close();
  proxyKeyStorageClient?.close();
  proxyTokenStore = undefined;
  proxyTokenStoreCapabilityToken = undefined;
  proxyTokenStoreSocketPath = undefined;
  directTokenStore = undefined;
  proxyKeyStorage = undefined;
  proxyKeyStorageClient = undefined;
  proxyKeyStorageCapabilityToken = undefined;
  proxyKeyStorageSocketPath = undefined;
  directKeyStorage = undefined;
}
