/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OAuthManager, OAuthProvider } from '../oauth-manager.js';
import { TokenStore, OAuthToken } from '../types.js';
import { MessageBus, PolicyEngine } from '@vybestack/llxprt-code-core';

/**
 * Issue #828: User Declined Auth Prompt Tracking
 *
 * When the user cancels the BucketAuthConfirmation dialog,
 * subsequent auth attempts in the same session should skip the dialog
 * and proceed directly.
 */

const mockEphemeralSettings = new Map<string, unknown>();

function setMockEphemeralSetting<T>(key: string, value: T): void {
  mockEphemeralSettings.set(key, value);
}

function clearMockEphemeralSettings(): void {
  mockEphemeralSettings.clear();
}

// Mock the runtime settings module
vi.mock('../../runtime/runtimeSettings.js', () => ({
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
    getBucketStats: vi.fn(
      async (
        _provider: string,
        bucket: string,
      ): Promise<{
        bucket: string;
        requestCount: number;
        percentage: number;
        lastUsed?: number;
      } | null> => ({
        bucket,
        requestCount: 0,
        percentage: 0,
        lastUsed: undefined,
      }),
    ),
    acquireRefreshLock: vi.fn(async (): Promise<boolean> => true),
    releaseRefreshLock: vi.fn(async (): Promise<void> => {}),
  };
}

function createMockProvider(name: string): OAuthProvider {
  return {
    name,
    initiateAuth: vi.fn(async (): Promise<void> => {}),
    getToken: vi.fn(
      async (): Promise<OAuthToken> => ({
        access_token: 'mock-token',
        refresh_token: 'mock-refresh',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'Bearer' as const,
      }),
    ),
    refreshToken: vi.fn(async (): Promise<OAuthToken | null> => null),
  };
}

describe('Issue #828: User Declined Auth Prompt Tracking', () => {
  let tokenStore: TokenStore;
  let manager: OAuthManager;
  let mockProvider: OAuthProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    clearMockEphemeralSettings();
    tokenStore = createMockTokenStore();
    manager = new OAuthManager(tokenStore);
    mockProvider = createMockProvider('anthropic');
    manager.registerProvider(mockProvider);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should still show confirmation on first attempt', async () => {
    setMockEphemeralSetting('auth-bucket-prompt', true);

    let confirmationRequested = false;

    const policyEngine = new PolicyEngine();
    const messageBus = new MessageBus(policyEngine);

    messageBus.requestBucketAuthConfirmation = vi.fn(
      async (): Promise<boolean> => {
        confirmationRequested = true;
        return true; // User approves
      },
    );

    manager.setMessageBus(() => messageBus);
    await manager.toggleOAuthEnabled('anthropic');

    await manager.getToken('anthropic');

    // First attempt should show the confirmation dialog
    expect(confirmationRequested).toBe(true);
    expect(messageBus.requestBucketAuthConfirmation).toHaveBeenCalled();
  });

  it('should skip BucketAuthConfirmation after user cancels once in session', async () => {
    setMockEphemeralSetting('auth-bucket-prompt', true);

    let confirmationCount = 0;

    const policyEngine = new PolicyEngine();
    const messageBus = new MessageBus(policyEngine);

    messageBus.requestBucketAuthConfirmation = vi.fn(
      async (): Promise<boolean> => {
        confirmationCount++;
        if (confirmationCount === 1) {
          return false; // User declines on first attempt
        }
        return true;
      },
    );

    manager.setMessageBus(() => messageBus);
    await manager.toggleOAuthEnabled('anthropic');

    // First attempt - user declines
    try {
      await manager.getToken('anthropic');
    } catch {
      // Expected: multi-bucket auth cancelled
    }

    // Second attempt - should skip the dialog and proceed directly
    try {
      await manager.getToken('anthropic');
    } catch {
      // May throw if auth fails
    }

    // The confirmation dialog should NOT have been shown again
    // (confirmationCount should still be 1 from the first attempt)
    expect(confirmationCount).toBe(1);
  });

  it('should reset declined state on new OAuthManager instance', async () => {
    setMockEphemeralSetting('auth-bucket-prompt', true);

    const policyEngine = new PolicyEngine();
    const messageBus = new MessageBus(policyEngine);

    let firstManagerConfirmationCount = 0;
    messageBus.requestBucketAuthConfirmation = vi.fn(
      async (): Promise<boolean> => {
        firstManagerConfirmationCount++;
        return false; // User declines
      },
    );

    manager.setMessageBus(() => messageBus);
    await manager.toggleOAuthEnabled('anthropic');

    // First manager, first attempt - user declines
    try {
      await manager.getToken('anthropic');
    } catch {
      // Expected
    }

    expect(firstManagerConfirmationCount).toBe(1);

    // Create a new OAuthManager (new session)
    const newManager = new OAuthManager(tokenStore);
    const newMockProvider = createMockProvider('anthropic');
    newManager.registerProvider(newMockProvider);

    let secondManagerConfirmationCount = 0;
    const newMessageBus = new MessageBus(policyEngine);
    newMessageBus.requestBucketAuthConfirmation = vi.fn(
      async (): Promise<boolean> => {
        secondManagerConfirmationCount++;
        return true; // User approves
      },
    );

    newManager.setMessageBus(() => newMessageBus);
    await newManager.toggleOAuthEnabled('anthropic');

    // New manager should show dialog again (fresh session)
    await newManager.getToken('anthropic');

    expect(secondManagerConfirmationCount).toBe(1);
  });
});
