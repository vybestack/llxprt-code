/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { flushMockRef, providerManagerRef, providerRef } = vi.hoisted(() => ({
  flushMockRef: {
    current: undefined as ReturnType<typeof vi.fn> | undefined,
  },
  providerManagerRef: {
    current: undefined as
      | { getProviderByName: ReturnType<typeof vi.fn> }
      | undefined,
  },
  providerRef: {
    current: undefined as unknown,
  },
}));

vi.mock('@vybestack/llxprt-code-core', async () => {
  const actual = await vi.importActual<
    typeof import('@vybestack/llxprt-code-core')
  >('@vybestack/llxprt-code-core');
  const flushMock = vi.fn(() => ({
    runtimeId: 'test-runtime',
    revokedTokens: [],
  }));
  flushMockRef.current = flushMock;
  return {
    ...actual,
    flushRuntimeAuthScope: flushMock,
  };
});

vi.mock('../runtime/runtimeSettings.js', async () => {
  const actual = await vi.importActual<
    typeof import('../runtime/runtimeSettings.js')
  >('../runtime/runtimeSettings.js');
  const managerMock = {
    getProviderByName: vi.fn(() => providerRef.current),
  };
  providerManagerRef.current = managerMock;
  return {
    ...actual,
    getCliRuntimeContext: vi.fn(() => ({
      runtimeId: 'test-runtime',
      metadata: {},
    })),
    getCliProviderManager: vi.fn(() => managerMock),
  };
});

import { OAuthManager, type OAuthProvider } from './oauth-manager.js';
import type { TokenStore } from '@vybestack/llxprt-code-core';

describe('OAuthManager.logout runtime cache handling', () => {
  beforeEach(() => {
    flushMockRef.current?.mockClear();
    providerManagerRef.current?.getProviderByName.mockReset();
  });

  it('flushes runtime auth scope when logging out a provider', async () => {
    const tokenStore: TokenStore = {
      saveToken: vi.fn(),
      getToken: vi.fn().mockResolvedValue(null),
      removeToken: vi.fn().mockResolvedValue(undefined),
      listProviders: vi.fn().mockResolvedValue([]),
    };

    const manager = new OAuthManager(tokenStore);

    const provider: OAuthProvider & {
      logout?: () => Promise<void>;
      clearState?: () => void;
      clearAuthCache?: () => void;
    } = {
      name: 'qwen',
      initiateAuth: vi.fn(async () => undefined),
      getToken: vi.fn(async () => null),
      refreshIfNeeded: vi.fn(async () => null),
      logout: vi.fn().mockResolvedValue(undefined),
      clearState: vi.fn(),
      clearAuthCache: vi.fn(),
    };

    manager.registerProvider(provider);
    providerRef.current = provider;

    await manager.logout('qwen');

    expect(providerManagerRef.current).toBeDefined();
    providerManagerRef.current?.getProviderByName.mockReturnValue(provider);

    expect(flushMockRef.current).toBeDefined();
    flushMockRef.current &&
      expect(flushMockRef.current).toHaveBeenCalledWith('test-runtime');
  });
});
