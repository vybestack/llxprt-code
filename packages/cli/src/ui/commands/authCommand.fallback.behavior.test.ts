/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral coverage for the /auth command ACTION runtime infrastructure guard
 * (issue #2300).
 *
 * When getCliOAuthManager() returns null after the provider manager resolved,
 * the runtime is only partially registered. The command must fail clearly
 * instead of synthesizing a fallback OAuthManager that masks broken bootstrap
 * state.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const runtimeApi = {
  getCliOAuthManager: vi.fn().mockReturnValue(null),
};

vi.mock('../contexts/RuntimeContext.js', () => ({
  getRuntimeApi: () => runtimeApi,
}));

vi.mock('@vybestack/llxprt-code-core', () => ({
  DebugLogger: vi.fn().mockImplementation(() => ({
    debug: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import { authCommand } from './authCommand.js';
import type { CommandContext } from './types.js';

// authCommand.action is optional in the SlashCommand type; assert presence once.
const action = authCommand.action;
if (!action) {
  throw new Error('authCommand.action is not defined');
}

describe('auth command action rejects partial runtime infrastructure (issue #2300)', () => {
  let context: CommandContext;

  beforeEach(() => {
    runtimeApi.getCliOAuthManager.mockReset();
    runtimeApi.getCliOAuthManager.mockReturnValue(null);

    context = {
      services: {
        settings: {} as never,
        logger: {} as never,
      },

      ui: {} as never,
      session: {} as never,
    } as unknown as CommandContext;
  });

  it('throws instead of synthesizing OAuth infrastructure when getCliOAuthManager is null', async () => {
    await expect(action(context, 'gemini status')).rejects.toThrow(
      'Auth command requires registered OAuth runtime infrastructure.',
    );
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
  });
});
