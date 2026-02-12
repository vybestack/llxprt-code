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
const getEphemeralSettingMock = vi.fn();

vi.mock('../contexts/RuntimeContext.js', () => ({
  getRuntimeApi: () => ({
    getCliOAuthManager: getCliOAuthManagerMock,
    getEphemeralSetting: getEphemeralSettingMock,
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
    getEphemeralSettingMock.mockReset();
    // Default: no API-key provider detected
    getEphemeralSettingMock.mockReturnValue(undefined);
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

  it('should show API-key provider quota when base-url matches supported provider', async () => {
    // No OAuth manager
    getCliOAuthManagerMock.mockReturnValue(null);

    // Simulate Z.ai base URL with an API key
    getEphemeralSettingMock.mockImplementation((key: string) => {
      if (key === 'base-url') return 'https://api.z.ai/v1';
      if (key === 'auth-keyfile') return undefined;
      if (key === 'auth-key') return 'test-zai-key';
      return undefined;
    });

    // Mock fetch to return a valid Z.ai response
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 200,
        msg: 'OK',
        data: {
          limits: [
            {
              type: 'TOKENS_LIMIT',
              unit: 3,
              number: 5,
              percentage: 25,
              nextResetTime: Date.now() + 3600000,
            },
          ],
          level: 'max',
        },
        success: true,
      }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const quotaSubCommand = statsCommand.subCommands?.find(
      (sc) => sc.name === 'quota',
    );
    if (!quotaSubCommand?.action) throw new Error('Subcommand has no action');

    await quotaSubCommand.action(mockContext, '');

    const addItemCalls = vi.mocked(mockContext.ui.addItem).mock.calls;
    const lastItem = addItemCalls[addItemCalls.length - 1]?.[0] as {
      type: MessageType;
      text?: string;
    };

    expect(lastItem.type).toBe(MessageType.INFO);
    expect(lastItem.text).toContain('Z.ai Quota Information');
    expect(lastItem.text).toContain('Plan: Max');
    expect(lastItem.text).toContain('25% used');

    vi.restoreAllMocks();
  });

  it('should show no quota message when no OAuth and no API-key provider', async () => {
    getCliOAuthManagerMock.mockReturnValue(null);
    getEphemeralSettingMock.mockReturnValue(undefined);

    const quotaSubCommand = statsCommand.subCommands?.find(
      (sc) => sc.name === 'quota',
    );
    if (!quotaSubCommand?.action) throw new Error('Subcommand has no action');

    await quotaSubCommand.action(mockContext, '');

    const addItemCalls = vi.mocked(mockContext.ui.addItem).mock.calls;
    const lastItem = addItemCalls[addItemCalls.length - 1]?.[0] as {
      type: MessageType;
      text?: string;
    };

    expect(lastItem.type).toBe(MessageType.INFO);
    expect(lastItem.text).toContain('No quota information available');
  });

  it('should show both OAuth and API-key provider quotas together', async () => {
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
        .mockResolvedValue(new Map<string, Record<string, unknown>>()),
    };

    getCliOAuthManagerMock.mockReturnValue(oauthManager);

    // Also set up an API-key provider (Z.ai)
    getEphemeralSettingMock.mockImplementation((key: string) => {
      if (key === 'base-url') return 'https://api.z.ai/v1';
      if (key === 'auth-key') return 'test-zai-key';
      return undefined;
    });

    // Mock fetch for Z.ai quota
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 200,
        msg: 'OK',
        data: {
          limits: [
            {
              type: 'TOKENS_LIMIT',
              unit: 3,
              number: 5,
              percentage: 10,
              nextResetTime: Date.now() + 3600000,
            },
          ],
          level: 'pro',
        },
        success: true,
      }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const quotaSubCommand = statsCommand.subCommands?.find(
      (sc) => sc.name === 'quota',
    );
    if (!quotaSubCommand?.action) throw new Error('Subcommand has no action');

    await quotaSubCommand.action(mockContext, '');

    const addItemCalls = vi.mocked(mockContext.ui.addItem).mock.calls;
    const lastItem = addItemCalls[addItemCalls.length - 1]?.[0] as {
      type: MessageType;
      text?: string;
    };

    expect(lastItem.type).toBe(MessageType.INFO);
    // Should contain both OAuth and API-key provider quotas
    expect(lastItem.text).toContain('Anthropic Quota Information');
    expect(lastItem.text).toContain('Z.ai Quota Information');

    vi.restoreAllMocks();
  });

  it('should show Synthetic quota when base-url matches synthetic.new', async () => {
    getCliOAuthManagerMock.mockReturnValue(null);
    getEphemeralSettingMock.mockImplementation((key: string) => {
      if (key === 'base-url') return 'https://api.synthetic.new/v2';
      if (key === 'auth-key') return 'test-synthetic-key';
      return undefined;
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        subscription: { limit: 1000, requests: 200, renewsAt: null },
        search: null,
        toolCallDiscounts: null,
      }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const quotaSubCommand = statsCommand.subCommands?.find(
      (sc) => sc.name === 'quota',
    );
    if (!quotaSubCommand?.action) throw new Error('Subcommand has no action');

    await quotaSubCommand.action(mockContext, '');

    const addItemCalls = vi.mocked(mockContext.ui.addItem).mock.calls;
    const lastItem = addItemCalls[addItemCalls.length - 1]?.[0] as {
      type: MessageType;
      text?: string;
    };

    expect(lastItem.type).toBe(MessageType.INFO);
    expect(lastItem.text).toContain('Synthetic Quota Information');
    expect(lastItem.text).toContain('200/1000 used');

    vi.restoreAllMocks();
  });

  it('should show Chutes quota when base-url matches chutes.ai', async () => {
    getCliOAuthManagerMock.mockReturnValue(null);
    getEphemeralSettingMock.mockImplementation((key: string) => {
      if (key === 'base-url') return 'https://api.chutes.ai/v1';
      if (key === 'auth-key') return 'test-chutes-key';
      return undefined;
    });

    // Chutes makes 2 parallel fetch calls: quotas + user
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/quotas')) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              chute_id: null,
              is_default: true,
              quota: { usd_cents_per_hour: 500, usd_cents_per_day: 5000 },
            },
          ],
        } as Response);
      }
      // /users/me
      return Promise.resolve({
        ok: true,
        json: async () => ({
          username: 'testuser',
          balance: 42.5,
        }),
      } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);

    const quotaSubCommand = statsCommand.subCommands?.find(
      (sc) => sc.name === 'quota',
    );
    if (!quotaSubCommand?.action) throw new Error('Subcommand has no action');

    await quotaSubCommand.action(mockContext, '');

    const addItemCalls = vi.mocked(mockContext.ui.addItem).mock.calls;
    const lastItem = addItemCalls[addItemCalls.length - 1]?.[0] as {
      type: MessageType;
      text?: string;
    };

    expect(lastItem.type).toBe(MessageType.INFO);
    expect(lastItem.text).toContain('Chutes Quota Information');
    expect(lastItem.text).toContain('Balance: $42.50');

    vi.restoreAllMocks();
  });

  it('should gracefully handle API-key fetch failure with no OAuth', async () => {
    getCliOAuthManagerMock.mockReturnValue(null);
    getEphemeralSettingMock.mockImplementation((key: string) => {
      if (key === 'base-url') return 'https://api.z.ai/v1';
      if (key === 'auth-key') return 'test-key';
      return undefined;
    });

    // Mock fetch to return an error
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const quotaSubCommand = statsCommand.subCommands?.find(
      (sc) => sc.name === 'quota',
    );
    if (!quotaSubCommand?.action) throw new Error('Subcommand has no action');

    await quotaSubCommand.action(mockContext, '');

    const addItemCalls = vi.mocked(mockContext.ui.addItem).mock.calls;
    const lastItem = addItemCalls[addItemCalls.length - 1]?.[0] as {
      type: MessageType;
      text?: string;
    };

    // Should show no-quota-available message since fetch failed
    expect(lastItem.type).toBe(MessageType.INFO);
    expect(lastItem.text).toContain('No quota information available');

    vi.restoreAllMocks();
  });
});
