/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral coverage for the /auth command ACTION runtime infrastructure guard
 * (issue #2300).
 *
 * When the owner-scoped OAuth control cannot resolve its runtime manager,
 * the command must fail clearly instead of synthesizing OAuth infrastructure
 * that masks broken bootstrap state.
 */

import { describe, it, expect, beforeEach, vi } from 'bun:test';

const oauthControl = {
  getSupportedProviders: vi.fn().mockImplementation(() => {
    throw new Error('OAuth runtime infrastructure is unavailable');
  }),
};

void vi.mock('@vybestack/llxprt-code-core', () => ({
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
    oauthControl.getSupportedProviders.mockReset();
    oauthControl.getSupportedProviders.mockImplementation(() => {
      throw new Error('OAuth runtime infrastructure is unavailable');
    });

    context = {
      oauthControl,
      services: {
        settings: {} as never,
        logger: {} as never,
      },

      ui: {} as never,
      session: {} as never,
    } as unknown as CommandContext;
  });

  it('throws instead of synthesizing OAuth infrastructure when the owner control cannot resolve it', async () => {
    await expect(action(context, 'gemini status')).rejects.toThrow(
      /Auth command requires registered OAuth runtime infrastructure: .*unavailable/,
    );
  });

  it('does not register new infrastructure when the owner control is ready', async () => {
    oauthControl.getSupportedProviders.mockReturnValue([
      'gemini',
      'anthropic',
      'codex',
    ]);
    context.oauthControl = {
      ...context.oauthControl,
      getAuthStatusWithBuckets: async () => [],
    };

    const result = await action(context, 'gemini status');

    expect(result).toMatchObject({
      type: 'message',
      messageType: 'info',
      content: 'gemini has no buckets authenticated',
    });
  });
});
