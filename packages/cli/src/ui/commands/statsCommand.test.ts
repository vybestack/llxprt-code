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
const getActiveProviderNameMock = vi.fn();
const getCliProviderManagerMock = vi.fn();

vi.mock('../contexts/RuntimeContext.js', () => ({
  getRuntimeApi: () => ({
    getCliOAuthManager: getCliOAuthManagerMock,
    getEphemeralSetting: getEphemeralSettingMock,
    getActiveProviderName: getActiveProviderNameMock,
    getCliProviderManager: getCliProviderManagerMock,
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
    getActiveProviderNameMock.mockReset();
    getCliProviderManagerMock.mockReset();
    // Default: no API-key provider detected
    getEphemeralSettingMock.mockReturnValue(undefined);
  });

  it('should display general session stats when run with no subcommand', async () => {
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (!statsCommand.action) throw new Error('Command has no action');

    await statsCommand.action(mockContext, '');

    const expectedDuration = formatDuration(
      endTime.getTime() - startTime.getTime(),
    );
    expect(mockContext.ui.addItem).toHaveBeenCalledWith({
      type: MessageType.STATS,
      duration: expectedDuration,
      quotaLines: undefined,
    });
  });

  it('should display model stats when using the "model" subcommand', () => {
    const modelSubCommand = statsCommand.subCommands?.find(
      (sc) => sc.name === 'model',
    );
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (!modelSubCommand?.action) throw new Error('Subcommand has no action');

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
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
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (!toolsSubCommand?.action) throw new Error('Subcommand has no action');

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
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
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (!cacheSubCommand?.action) throw new Error('Subcommand has no action');

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
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
      getAllGeminiUsageInfo: vi
        .fn()
        .mockResolvedValue(new Map<string, Record<string, unknown>>()),
    };

    getCliOAuthManagerMock.mockReturnValue(oauthManager);

    const quotaSubCommand = statsCommand.subCommands?.find(
      (sc) => sc.name === 'quota',
    );
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
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
      getAllGeminiUsageInfo: vi
        .fn()
        .mockResolvedValue(new Map<string, Record<string, unknown>>()),
    };

    getCliOAuthManagerMock.mockReturnValue(oauthManager);

    const quotaSubCommand = statsCommand.subCommands?.find(
      (sc) => sc.name === 'quota',
    );
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
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
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
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
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
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
      getAllGeminiUsageInfo: vi
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
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
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
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
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
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
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
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
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

  it('should show Gemini quota when OAuthManager returns quota data', async () => {
    const geminiUsage = new Map<string, Record<string, unknown>>([
      [
        'default',
        {
          buckets: [
            {
              modelId: 'gemini-2.5-pro',
              tokenType: 'input_tokens',
              remainingAmount: '8000',
              remainingFraction: 0.8,
              resetTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            },
            {
              modelId: 'gemini-2.5-flash',
              tokenType: 'input_tokens',
              remainingAmount: '45000',
              remainingFraction: 0.95,
            },
          ],
        },
      ],
    ]);

    const oauthManager = {
      getAllAnthropicUsageInfo: vi
        .fn()
        .mockResolvedValue(new Map<string, Record<string, unknown>>()),
      getAllCodexUsageInfo: vi
        .fn()
        .mockResolvedValue(new Map<string, Record<string, unknown>>()),
      getAllGeminiUsageInfo: vi.fn().mockResolvedValue(geminiUsage),
    };

    getCliOAuthManagerMock.mockReturnValue(oauthManager);

    const quotaSubCommand = statsCommand.subCommands?.find(
      (cmd) => cmd.name === 'quota',
    );
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (!quotaSubCommand?.action) throw new Error('No quota subcommand');

    await quotaSubCommand.action(mockContext, '');

    const addItemCalls = vi.mocked(mockContext.ui.addItem).mock.calls;
    const lastItem = addItemCalls[addItemCalls.length - 1]?.[0] as {
      type: MessageType;
      text?: string;
    };

    expect(lastItem.type).toBe(MessageType.INFO);
    expect(lastItem.text).toContain('Gemini Quota Information');
    expect(lastItem.text).toContain('gemini-2.5-pro');
    expect(lastItem.text).toContain('80%');
    expect(lastItem.text).toContain('gemini-2.5-flash');
    expect(lastItem.text).toContain('95%');

    vi.restoreAllMocks();
  });

  it('should gracefully handle Gemini quota fetch failure', async () => {
    const oauthManager = {
      getAllAnthropicUsageInfo: vi
        .fn()
        .mockResolvedValue(new Map<string, Record<string, unknown>>()),
      getAllCodexUsageInfo: vi
        .fn()
        .mockResolvedValue(new Map<string, Record<string, unknown>>()),
      getAllGeminiUsageInfo: vi
        .fn()
        .mockRejectedValue(new Error('Network error')),
    };

    getCliOAuthManagerMock.mockReturnValue(oauthManager);

    const quotaSubCommand = statsCommand.subCommands?.find(
      (cmd) => cmd.name === 'quota',
    );
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (!quotaSubCommand?.action) throw new Error('No quota subcommand');

    await quotaSubCommand.action(mockContext, '');

    // Should not crash — graceful failure results in no quota section or "no quota available"
    const addItemCalls = vi.mocked(mockContext.ui.addItem).mock.calls;
    expect(addItemCalls.length).toBeGreaterThan(0);

    vi.restoreAllMocks();
  });

  // Tests for detection order priority and alias-loaded providers
  describe('API-key provider detection order', () => {
    beforeEach(() => {
      getActiveProviderNameMock.mockReset();
      getCliProviderManagerMock.mockReset();
    });

    it('should use ephemeral base-url over provider config (highest priority)', async () => {
      getCliOAuthManagerMock.mockReturnValue(null);

      // Set up ephemeral base-url pointing to Z.ai
      getEphemeralSettingMock.mockImplementation((key: string) => {
        if (key === 'base-url') return 'https://api.z.ai/v1';
        if (key === 'auth-key') return 'test-key';
        return undefined;
      });

      // Set up provider config with different URL (should be ignored)
      const mockProvider = {
        providerConfig: { 'base-url': 'https://api.synthetic.new/v2' },
      };
      getActiveProviderNameMock.mockReturnValue('kimi');
      getCliProviderManagerMock.mockReturnValue({
        getProviderByName: vi.fn().mockReturnValue(mockProvider),
      });

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
                number: 10,
                percentage: 20,
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
        (cmd) => cmd.name === 'quota',
      );
      // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
      if (!quotaSubCommand?.action) throw new Error('No quota subcommand');

      await quotaSubCommand.action(mockContext, '');

      const addItemCalls = vi.mocked(mockContext.ui.addItem).mock.calls;
      const lastItem = addItemCalls[addItemCalls.length - 1]?.[0] as {
        type: MessageType;
        text?: string;
      };

      // Should detect Z.ai from ephemeral base-url, not Synthetic from config
      expect(lastItem.text).toContain('Z.ai Quota Information');
      expect(lastItem.text).not.toContain('Synthetic');

      vi.restoreAllMocks();
    });

    it('should use provider config base URL when no ephemeral base-url', async () => {
      getCliOAuthManagerMock.mockReturnValue(null);

      // No ephemeral base-url
      getEphemeralSettingMock.mockImplementation((key: string) => {
        if (key === 'auth-key') return 'test-key';
        return undefined;
      });

      // Provider config has Synthetic base URL
      const mockProvider = {
        providerConfig: { 'base-url': 'https://api.synthetic.new/v2' },
      };
      getActiveProviderNameMock.mockReturnValue('kimi'); // Name suggests kimi, but config wins
      getCliProviderManagerMock.mockReturnValue({
        getProviderByName: vi.fn().mockReturnValue(mockProvider),
      });

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          subscription: { limit: 1000, requests: 100, renewsAt: null },
        }),
      } as Response);
      vi.stubGlobal('fetch', fetchMock);

      const quotaSubCommand = statsCommand.subCommands?.find(
        (cmd) => cmd.name === 'quota',
      );
      // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
      if (!quotaSubCommand?.action) throw new Error('No quota subcommand');

      await quotaSubCommand.action(mockContext, '');

      const addItemCalls = vi.mocked(mockContext.ui.addItem).mock.calls;
      const lastItem = addItemCalls[addItemCalls.length - 1]?.[0] as {
        type: MessageType;
        text?: string;
      };

      // Should detect Synthetic from provider config, not Kimi from name
      expect(lastItem.text).toContain('Synthetic Quota Information');
      expect(lastItem.text).not.toContain('Kimi');

      vi.restoreAllMocks();
    });

    it('should use baseProviderConfig when providerConfig has no base URL', async () => {
      getCliOAuthManagerMock.mockReturnValue(null);

      getEphemeralSettingMock.mockImplementation((key: string) => {
        if (key === 'auth-key') return 'test-key';
        return undefined;
      });

      // Provider has baseProviderConfig with Kimi URL
      const mockProvider = {
        providerConfig: {}, // No baseUrl here
        baseProviderConfig: { 'base-url': 'https://api.moonshot.cn/v1' },
      };
      getActiveProviderNameMock.mockReturnValue('synthetic'); // Name suggests synthetic, but config wins
      getCliProviderManagerMock.mockReturnValue({
        getProviderByName: vi.fn().mockReturnValue(mockProvider),
      });

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          available_balance: 100.0,
        }),
      } as Response);
      vi.stubGlobal('fetch', fetchMock);

      const quotaSubCommand = statsCommand.subCommands?.find(
        (cmd) => cmd.name === 'quota',
      );
      // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
      if (!quotaSubCommand?.action) throw new Error('No quota subcommand');

      await quotaSubCommand.action(mockContext, '');

      const addItemCalls = vi.mocked(mockContext.ui.addItem).mock.calls;
      const lastItem = addItemCalls[addItemCalls.length - 1]?.[0] as {
        type: MessageType;
        text?: string;
      };

      // Should detect Kimi from baseProviderConfig, not Synthetic from name
      expect(lastItem.text).toContain('Kimi Quota Information');
      expect(lastItem.text).not.toContain('Synthetic');

      vi.restoreAllMocks();
    });

    it('should fall back to provider name detection only when no config URLs', async () => {
      getCliOAuthManagerMock.mockReturnValue(null);

      getEphemeralSettingMock.mockImplementation((key: string) => {
        if (key === 'auth-key') return 'test-key';
        return undefined;
      });

      // Provider has no config URLs, name-based detection should work
      const mockProvider = {
        providerConfig: {},
        baseProviderConfig: {},
      };
      getActiveProviderNameMock.mockReturnValue('kimi'); // This should be used as fallback
      getCliProviderManagerMock.mockReturnValue({
        getProviderByName: vi.fn().mockReturnValue(mockProvider),
      });

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          available_balance: 50.0,
        }),
      } as Response);
      vi.stubGlobal('fetch', fetchMock);

      const quotaSubCommand = statsCommand.subCommands?.find(
        (cmd) => cmd.name === 'quota',
      );
      // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
      if (!quotaSubCommand?.action) throw new Error('No quota subcommand');

      await quotaSubCommand.action(mockContext, '');

      const addItemCalls = vi.mocked(mockContext.ui.addItem).mock.calls;
      const lastItem = addItemCalls[addItemCalls.length - 1]?.[0] as {
        type: MessageType;
        text?: string;
      };

      // Should detect Kimi from provider name (fallback)
      expect(lastItem.text).toContain('Kimi Quota Information');

      vi.restoreAllMocks();
    });

    it('should handle alias-loaded synthetic provider with baseProviderConfig', async () => {
      getCliOAuthManagerMock.mockReturnValue(null);

      getEphemeralSettingMock.mockImplementation((key: string) => {
        if (key === 'auth-key') return 'test-key';
        return undefined;
      });

      // Real-world scenario: alias "synthetic" pointing to baseProviderConfig
      const mockProvider = {
        providerConfig: { 'base-url': undefined },
        baseProviderConfig: { 'base-url': 'https://api.synthetic.new/v2' },
      };
      getActiveProviderNameMock.mockReturnValue('synthetic');
      getCliProviderManagerMock.mockReturnValue({
        getProviderByName: vi.fn().mockReturnValue(mockProvider),
      });

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          subscription: { limit: 2000, requests: 500, renewsAt: null },
        }),
      } as Response);
      vi.stubGlobal('fetch', fetchMock);

      const quotaSubCommand = statsCommand.subCommands?.find(
        (cmd) => cmd.name === 'quota',
      );
      // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
      if (!quotaSubCommand?.action) throw new Error('No quota subcommand');

      await quotaSubCommand.action(mockContext, '');

      const addItemCalls = vi.mocked(mockContext.ui.addItem).mock.calls;
      const lastItem = addItemCalls[addItemCalls.length - 1]?.[0] as {
        type: MessageType;
        text?: string;
      };

      // Should detect Synthetic from baseProviderConfig base URL
      expect(lastItem.text).toContain('Synthetic Quota Information');
      expect(lastItem.text).toContain('500/2000 used');

      vi.restoreAllMocks();
    });

    it('should handle alias-loaded kimi provider with baseProviderConfig', async () => {
      getCliOAuthManagerMock.mockReturnValue(null);

      getEphemeralSettingMock.mockImplementation((key: string) => {
        if (key === 'auth-key') return 'test-key';
        return undefined;
      });

      // Real-world scenario: alias "kimi" pointing to baseProviderConfig
      const mockProvider = {
        providerConfig: {},
        baseProviderConfig: { 'base-url': 'https://api.moonshot.cn/v1' },
      };
      getActiveProviderNameMock.mockReturnValue('kimi');
      getCliProviderManagerMock.mockReturnValue({
        getProviderByName: vi.fn().mockReturnValue(mockProvider),
      });

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          available_balance: 75.5,
        }),
      } as Response);
      vi.stubGlobal('fetch', fetchMock);

      const quotaSubCommand = statsCommand.subCommands?.find(
        (cmd) => cmd.name === 'quota',
      );
      // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
      if (!quotaSubCommand?.action) throw new Error('No quota subcommand');

      await quotaSubCommand.action(mockContext, '');

      const addItemCalls = vi.mocked(mockContext.ui.addItem).mock.calls;
      const lastItem = addItemCalls[addItemCalls.length - 1]?.[0] as {
        type: MessageType;
        text?: string;
      };

      // Should detect Kimi from baseProviderConfig base URL
      expect(lastItem.text).toContain('Kimi Quota Information');
      expect(lastItem.text).toContain('¥75.5');

      vi.restoreAllMocks();
    });

    it('should detect provider from kebab-case base-url in providerConfig (issue #1828)', async () => {
      getCliOAuthManagerMock.mockReturnValue(null);

      getEphemeralSettingMock.mockImplementation((key: string) => {
        if (key === 'auth-key') return 'test-key';
        return undefined;
      });

      // Use non-detectable provider name to ensure URL-based detection is tested
      const mockProvider = {
        providerConfig: { 'base-url': 'https://api.z.ai/v1' },
      };
      getActiveProviderNameMock.mockReturnValue('custom-zai-alias');
      getCliProviderManagerMock.mockReturnValue({
        getProviderByName: vi.fn().mockReturnValue(mockProvider),
      });

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
                number: 10,
                percentage: 20,
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
        (cmd) => cmd.name === 'quota',
      );
      // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
      if (!quotaSubCommand?.action) throw new Error('No quota subcommand');

      await quotaSubCommand.action(mockContext, '');

      const addItemCalls = vi.mocked(mockContext.ui.addItem).mock.calls;
      const lastItem = addItemCalls[addItemCalls.length - 1]?.[0] as {
        type: MessageType;
        text?: string;
      };

      // Should detect Z.ai from kebab-case base-url in providerConfig
      expect(lastItem.text).toContain('Z.ai Quota Information');

      vi.restoreAllMocks();
    });

    it('should detect provider from kebab-case base-url in baseProviderConfig (issue #1828)', async () => {
      getCliOAuthManagerMock.mockReturnValue(null);

      getEphemeralSettingMock.mockImplementation((key: string) => {
        if (key === 'auth-key') return 'test-key';
        return undefined;
      });

      // Use non-detectable provider name to ensure URL-based detection is tested
      const mockProvider = {
        providerConfig: {},
        baseProviderConfig: { 'base-url': 'https://api.synthetic.new/v2' },
      };
      getActiveProviderNameMock.mockReturnValue('my-synthetic-provider');
      getCliProviderManagerMock.mockReturnValue({
        getProviderByName: vi.fn().mockReturnValue(mockProvider),
      });

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          subscription: { limit: 1000, requests: 300, renewsAt: null },
        }),
      } as Response);
      vi.stubGlobal('fetch', fetchMock);

      const quotaSubCommand = statsCommand.subCommands?.find(
        (cmd) => cmd.name === 'quota',
      );
      // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
      if (!quotaSubCommand?.action) throw new Error('No quota subcommand');

      await quotaSubCommand.action(mockContext, '');

      const addItemCalls = vi.mocked(mockContext.ui.addItem).mock.calls;
      const lastItem = addItemCalls[addItemCalls.length - 1]?.[0] as {
        type: MessageType;
        text?: string;
      };

      // Should detect Synthetic from kebab-case base-url in baseProviderConfig
      expect(lastItem.text).toContain('Synthetic Quota Information');
      expect(lastItem.text).toContain('300/1000 used');

      vi.restoreAllMocks();
    });
  });
});
