/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageBus, PolicyEngine } from '@vybestack/llxprt-code-core';
import { OAuthManager } from './oauth-manager.js';
import type { OAuthProvider, OAuthToken, TokenStore } from './types.js';

const mockEphemeralSettings = new Map<string, unknown>();

function setMockEphemeralSetting<T>(key: string, value: T): void {
  mockEphemeralSettings.set(key, value);
}

function clearMockEphemeralSettings(): void {
  mockEphemeralSettings.clear();
}

vi.mock('../runtime/runtimeSettings.js', () => ({
  getEphemeralSetting: (key: string) => mockEphemeralSettings.get(key),
  getCliRuntimeServices: () => ({
    settingsService: {
      getCurrentProfileName: () => null,
      get: () => null,
    },
  }),
  getCliProviderManager: () => ({
    getProviderByName: () => null,
  }),
  getCliRuntimeContext: () => ({
    runtimeId: 'test-runtime',
  }),
}));

function createMockTokenStore(): TokenStore {
  const tokens = new Map<string, OAuthToken>();

  return {
    saveToken: vi.fn(
      async (
        provider: string,
        token: OAuthToken,
        bucket?: string,
      ): Promise<void> => {
        const key = `${provider}:${bucket ?? 'default'}`;
        tokens.set(key, token);
      },
    ),
    getToken: vi.fn(
      async (provider: string, bucket?: string): Promise<OAuthToken | null> => {
        const key = `${provider}:${bucket ?? 'default'}`;
        return tokens.get(key) ?? null;
      },
    ),
    removeToken: vi.fn(async (): Promise<void> => {}),
    listProviders: vi.fn(async (): Promise<string[]> => []),
    listBuckets: vi.fn(async (): Promise<string[]> => []),
    getBucketStats: vi.fn(async () => null),
    acquireRefreshLock: vi.fn(async (): Promise<boolean> => true),
    releaseRefreshLock: vi.fn(async (): Promise<void> => {}),
    acquireAuthLock: vi.fn(async (): Promise<boolean> => true),
    releaseAuthLock: vi.fn(async (): Promise<void> => {}),
  };
}

function createMockProvider(name: string): OAuthProvider {
  return {
    name,
    initiateAuth: vi.fn(
      async (): Promise<OAuthToken> => ({
        access_token: `${name}-token`,
        refresh_token: `${name}-refresh`,
        expiry: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'Bearer',
      }),
    ),
    getToken: vi.fn(
      async (): Promise<OAuthToken> => ({
        access_token: `${name}-token`,
        refresh_token: `${name}-refresh`,
        expiry: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'Bearer',
      }),
    ),
    refreshToken: vi.fn(async (): Promise<OAuthToken | null> => null),
  };
}

describe('OAuthManager explicit runtime MessageBus seam', () => {
  let manager: OAuthManager;

  beforeEach(() => {
    clearMockEphemeralSettings();
    manager = new OAuthManager(createMockTokenStore(), undefined, {
      messageBus: new MessageBus(new PolicyEngine()),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P07
   * @requirement REQ-D01-003.3
   * @requirement REQ-D01-004.3
   * @pseudocode lines 83-91
   */
  /**
   * Phase 07 equivalent-matrix coverage:
   * - runtime registration path: covered in runtime-oauth-messagebus.test.ts and expected FAIL
   * - provider singleton path: covered in providerManagerInstance.messagebus.test.ts and expected FAIL
   * - auth direct seam control: this spec is the expected PASS control proving the explicit seam itself works
   */

  it('uses the explicit auth-surface MessageBus seam for bucket confirmation while keeping multi-provider registration intact', async () => {
    setMockEphemeralSetting('auth-bucket-prompt', true);

    const explicitBus = new MessageBus(new PolicyEngine());
    explicitBus.requestBucketAuthConfirmation = vi.fn(
      async (): Promise<boolean> => true,
    );

    manager = new OAuthManager(createMockTokenStore(), undefined, {
      messageBus: explicitBus,
    });
    manager.registerProvider(createMockProvider('anthropic'));
    manager.registerProvider(createMockProvider('gemini'));

    expect(manager.getSupportedProviders().sort()).toEqual([
      'anthropic',
      'gemini',
    ]);

    await manager.toggleOAuthEnabled('anthropic');
    await manager.getToken('anthropic');

    expect(explicitBus.requestBucketAuthConfirmation).toHaveBeenCalled();
    expect(
      (manager as unknown as { runtimeMessageBus?: MessageBus })
        .runtimeMessageBus,
    ).toBe(explicitBus);
  });
});
