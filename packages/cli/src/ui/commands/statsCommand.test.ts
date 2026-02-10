/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { statsCommand } from './statsCommand.js';
import { type CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { MessageType } from '../types.js';
import { formatDuration } from '../utils/formatters.js';

const getCliOAuthManagerMock = vi.fn();

vi.mock('../contexts/RuntimeContext.js', () => ({
  getRuntimeApi: () => ({
    getCliOAuthManager: getCliOAuthManagerMock,
  }),
}));

describe('statsCommand', () => {
  let mockContext: CommandContext;
  const startTime = new Date('2025-07-14T10:00:00.000Z');
  const endTime = new Date('2025-07-14T10:00:30.000Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(endTime);

    // 1. Create the mock context with all default values
    mockContext = createMockCommandContext();

    // 2. Directly set the property on the created mock context
    mockContext.session.stats.sessionStartTime = startTime;

    getCliOAuthManagerMock.mockReset();
  });

  it('should display general session stats when run with no subcommand', () => {
    if (!statsCommand.action) throw new Error('Command has no action');

    statsCommand.action(mockContext, '');

    const expectedDuration = formatDuration(
      endTime.getTime() - startTime.getTime(),
    );
    expect(mockContext.ui.addItem).toHaveBeenCalledWith(
      {
        type: MessageType.STATS,
        duration: expectedDuration,
      },
      expect.any(Number),
    );
  });

  it('should display model stats when using the "model" subcommand', () => {
    const modelSubCommand = statsCommand.subCommands?.find(
      (sc) => sc.name === 'model',
    );
    if (!modelSubCommand?.action) throw new Error('Subcommand has no action');

    modelSubCommand.action(mockContext, '');

    expect(mockContext.ui.addItem).toHaveBeenCalledWith(
      {
        type: MessageType.MODEL_STATS,
      },
      expect.any(Number),
    );
  });

  it('should display tool stats when using the "tools" subcommand', () => {
    const toolsSubCommand = statsCommand.subCommands?.find(
      (sc) => sc.name === 'tools',
    );
    if (!toolsSubCommand?.action) throw new Error('Subcommand has no action');

    toolsSubCommand.action(mockContext, '');

    expect(mockContext.ui.addItem).toHaveBeenCalledWith(
      {
        type: MessageType.TOOL_STATS,
      },
      expect.any(Number),
    );
  });

  it('should display cache stats when using the "cache" subcommand', () => {
    const cacheSubCommand = statsCommand.subCommands?.find(
      (sc) => sc.name === 'cache',
    );
    if (!cacheSubCommand?.action) throw new Error('Subcommand has no action');

    cacheSubCommand.action(mockContext, '');

    expect(mockContext.ui.addItem).toHaveBeenCalledWith(
      {
        type: MessageType.CACHE_STATS,
      },
      expect.any(Number),
    );
  });

  it('should show Anthropic quota info when Codex fetch fails', async () => {
    const anthropicUsage = new Map<string, Record<string, unknown>>([
      [
        'default',
        {
          five_hour: {
            utilization: 12.5,
            resets_at: '2030-01-01T00:00:00Z',
          },
        },
      ],
    ]);

    const oauthManager = {
      getAllAnthropicUsageInfo: vi.fn().mockResolvedValue(anthropicUsage),
      getAllCodexUsageInfo: vi
        .fn()
        .mockRejectedValue(new Error('codex unavailable')),
    };

    getCliOAuthManagerMock.mockReturnValue(oauthManager);

    const quotaSubCommand = statsCommand.subCommands?.find(
      (sc) => sc.name === 'quota',
    );
    if (!quotaSubCommand?.action) throw new Error('Subcommand has no action');

    await quotaSubCommand.action(mockContext, '');

    expect(oauthManager.getAllAnthropicUsageInfo).toHaveBeenCalledTimes(1);
    expect(oauthManager.getAllCodexUsageInfo).toHaveBeenCalledTimes(1);

    const addItemCalls = vi.mocked(mockContext.ui.addItem).mock.calls;
    const infoItem = addItemCalls[addItemCalls.length - 1]?.[0] as {
      type: MessageType;
      text?: string;
    };

    expect(infoItem.type).toBe(MessageType.INFO);
    expect(infoItem.text).toContain('Anthropic Quota Information');
    expect(infoItem.text).not.toContain('Codex Quota Information');
  });

  it('should show Codex quota info when Anthropic fetch fails', async () => {
    const codexUsage = new Map<string, Record<string, unknown>>([
      [
        'default',
        {
          plan_type: 'pro',
          rate_limit: {
            allowed: true,
            limit_reached: false,
            primary_window: {
              used_percent: 10,
              limit_window_seconds: 18000,
              reset_after_seconds: 1000,
              reset_at: 1893456000,
            },
            secondary_window: {
              used_percent: 45,
              limit_window_seconds: 604800,
              reset_after_seconds: 100000,
              reset_at: 1893556000,
            },
          },
          credits: {
            has_credits: true,
            unlimited: false,
            balance: '80',
          },
        },
      ],
    ]);

    const oauthManager = {
      getAllAnthropicUsageInfo: vi
        .fn()
        .mockRejectedValue(new Error('anthropic unavailable')),
      getAllCodexUsageInfo: vi.fn().mockResolvedValue(codexUsage),
    };

    getCliOAuthManagerMock.mockReturnValue(oauthManager);

    const quotaSubCommand = statsCommand.subCommands?.find(
      (sc) => sc.name === 'quota',
    );
    if (!quotaSubCommand?.action) throw new Error('Subcommand has no action');

    await quotaSubCommand.action(mockContext, '');

    expect(oauthManager.getAllAnthropicUsageInfo).toHaveBeenCalledTimes(1);
    expect(oauthManager.getAllCodexUsageInfo).toHaveBeenCalledTimes(1);

    const addItemCalls = vi.mocked(mockContext.ui.addItem).mock.calls;
    const infoItem = addItemCalls[addItemCalls.length - 1]?.[0] as {
      type: MessageType;
      text?: string;
    };

    expect(infoItem.type).toBe(MessageType.INFO);
    expect(infoItem.text).toContain('Codex Quota Information');
    expect(infoItem.text).not.toContain('Anthropic Quota Information');
    expect(infoItem.text).toContain('5-hour limit');
    expect(infoItem.text).toContain('Weekly limit');
  });
});
