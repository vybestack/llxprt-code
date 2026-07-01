/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral coverage for the /auth command ACTION fallback path (issue #2300).
 *
 * When getCliOAuthManager() returns null, the auth command must construct an
 * OAuthManager and register provider infrastructure using an EXPLICIT runtime
 * id obtained from the runtime bridge — never ambient or first-registered
 * state. These tests prove that contract by observing the runtimeId passed to
 * registerCliProviderInfrastructure.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Capture the runtimeId the fallback passes to registerCliProviderInfrastructure.
const registerSpy = vi.fn<
  (
    mgr: unknown,
    oauth: unknown,
    opts: {
      messageBus: unknown;
      runtimeId: string;
      metadata?: Record<string, unknown>;
    },
  ) => void
>();

const bridgeRuntimeId = 'cli.runtime.bridge.explicit';

const runtimeApi = {
  getCliProviderManager: vi.fn().mockReturnValue({
    getProviderByName: vi.fn().mockReturnValue(null),
  }),
  getCliOAuthManager: vi.fn().mockReturnValue(null),
  registerCliProviderInfrastructure: registerSpy,
};

vi.mock('../contexts/RuntimeContext.js', () => ({
  getRuntimeApi: () => runtimeApi,
  getRuntimeBridge: () => ({
    runtimeId: bridgeRuntimeId,
    metadata: {},
    api: runtimeApi,
    runWithScope: <T>(callback: () => T): T => callback(),
    enterScope: () => {},
  }),
}));

vi.mock('@vybestack/llxprt-code-providers/auth.js', () => ({
  OAuthManager: vi.fn().mockImplementation(() => ({
    getSupportedProviders: vi
      .fn()
      .mockReturnValue(['gemini', 'anthropic', 'codex']),
    isOAuthEnabled: vi.fn().mockReturnValue(false),
    isAuthenticated: vi.fn().mockResolvedValue(false),
    getHigherPriorityAuth: vi.fn().mockResolvedValue(null),
    peekStoredToken: vi.fn().mockResolvedValue(null),
    getAuthStatusWithBuckets: vi.fn().mockResolvedValue([]),
  })),
  createTokenStore: vi.fn().mockReturnValue({}),
}));

vi.mock('@vybestack/llxprt-code-providers/composition.js', () => ({
  registerStandardOAuthProviders: vi.fn(),
}));

vi.mock('../../auth/oauth-settings-adapter.js', () => ({
  LoadedSettingsOAuthAdapter: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@vybestack/llxprt-code-core', () => ({
  DebugLogger: vi.fn().mockImplementation(() => ({
    debug: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
  MessageBus: vi.fn().mockImplementation(() => ({})),
}));

import { authCommand } from './authCommand.js';
import type { CommandContext } from './types.js';

// authCommand.action is optional in the SlashCommand type; assert presence once.
const action = authCommand.action;
if (!action) {
  throw new Error('authCommand.action is not defined');
}

describe('auth command action fallback uses explicit runtime identity (issue #2300)', () => {
  let context: CommandContext;

  beforeEach(() => {
    registerSpy.mockClear();
    runtimeApi.getCliOAuthManager.mockReset();
    runtimeApi.getCliOAuthManager.mockReturnValue(null);
    runtimeApi.getCliProviderManager.mockReset();
    runtimeApi.getCliProviderManager.mockReturnValue({
      getProviderByName: vi.fn().mockReturnValue(null),
    });

    context = {
      services: {
        config: {
          getPolicyEngine: vi.fn().mockReturnValue({}),
          getDebugMode: vi.fn().mockReturnValue(false),
        },
        settings: {} as never,
        logger: {} as never,
      },

      ui: {} as never,
      session: {} as never,
    } as unknown as CommandContext;
  });

  it('registers provider infrastructure on the explicit bridge runtimeId when getCliOAuthManager is null', async () => {
    const result = await action(context, 'gemini status');

    expect(result).toMatchObject({
      type: 'message',
      messageType: 'info',
      content: 'gemini has no buckets authenticated',
    });
    expect(registerSpy).toHaveBeenCalledTimes(1);

    const call = registerSpy.mock.calls[0];
    expect(call).toBeDefined();
    // The runtimeId MUST be the explicit bridge id, not an ambient/derived one.
    expect(call[2].runtimeId).toBe(bridgeRuntimeId);
    expect(call[2].messageBus).toBeDefined();
    expect(call[2].messageBus).not.toBeNull();
  });

  it('does not register when getCliOAuthManager already returns a manager', async () => {
    runtimeApi.getCliOAuthManager.mockReturnValue({
      getSupportedProviders: () => ['gemini', 'anthropic', 'codex'],
      isOAuthEnabled: () => false,
      isAuthenticated: async () => false,
      getHigherPriorityAuth: async () => null,
      peekStoredToken: async () => null,
      getAuthStatusWithBuckets: async () => [],
    });

    const result = await action(context, 'gemini status');

    expect(result).toMatchObject({
      type: 'message',
      messageType: 'info',
      content: 'gemini has no buckets authenticated',
    });
    expect(registerSpy).not.toHaveBeenCalled();
  });

  it('throws when config is null in the fallback path', async () => {
    context.services.config = null;

    await expect(action(context, 'gemini status')).rejects.toThrow(
      'Auth command requires an initialized Config service.',
    );
    expect(registerSpy).not.toHaveBeenCalled();
  });
});
