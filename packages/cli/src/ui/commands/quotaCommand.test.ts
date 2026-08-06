/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach } from 'bun:test';
import { quotaCommand } from './quotaCommand.js';
import { type CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { MessageType } from '../types.js';

const { mockConsumeCodexRateLimitResetCredit } = {
  mockConsumeCodexRateLimitResetCredit: vi.fn(),
};

const getCliOAuthManagerMock = vi.fn();
const maybeGetCliOAuthManagerMock = vi.fn();
const getEphemeralSettingMock = vi.fn();
// These runtime-API mocks intentionally return undefined for the API-key
// provider path (getActiveProviderName / getCliProviderManager) so that only
// the OAuth quota path is exercised here; the API-key path is covered
// elsewhere (statsQuota tests).
const getActiveProviderNameMock = vi.fn();
const getCliProviderManagerMock = vi.fn();

vi.mock('../contexts/RuntimeContext.js', () => ({
  getRuntimeApi: () => ({
    getCliOAuthManager: getCliOAuthManagerMock,
    maybeGetCliOAuthManager: maybeGetCliOAuthManagerMock,
    getEphemeralSetting: getEphemeralSettingMock,
    getActiveProviderName: getActiveProviderNameMock,
    getCliProviderManager: getCliProviderManagerMock,
  }),
}));

vi.mock('@vybestack/llxprt-code-providers', async () => {
  const actual = await vi.importActual<
    typeof import('@vybestack/llxprt-code-providers')
  >('@vybestack/llxprt-code-providers');
  return {
    ...actual,
    consumeCodexRateLimitResetCredit: mockConsumeCodexRateLimitResetCredit,
  };
});

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Get the last informational or error item added to the UI.
 */
function getLastUiItem(ctx: CommandContext): {
  type: 'info' | 'error';
  text?: string;
} {
  const calls = vi.mocked(ctx.ui.addItem).mock.calls;
  const lastItem = calls.at(-1)?.[0];
  if (lastItem?.type === 'info') {
    return { type: 'info', text: lastItem.text };
  }
  if (lastItem?.type === 'error') {
    return { type: 'error', text: lastItem.text };
  }
  throw new Error('Expected an informational or error UI item to be added');
}

function makeCodexCreditsMap(
  entries: Array<{
    bucket: string;
    availableCount: number;
    credits: Array<{ id: string }>;
  }>,
): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const entry of entries) {
    map.set(entry.bucket, {
      rate_limit_reset_credits: {
        available_count: entry.availableCount,
        credits: entry.credits,
      },
    });
  }
  return map;
}

function makeCodexToken(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    access_token: 'codex-access',
    token_type: 'Bearer',
    expiry: Math.floor(Date.now() / 1000) + 3600,
    account_id: 'acct-123',
    ...overrides,
  };
}

function makeCodexResetOauthManager(
  overrides: Record<string, ReturnType<typeof vi.fn>> = {},
): Record<string, ReturnType<typeof vi.fn>> {
  const futureResetAt = Math.floor(Date.now() / 1000) + 3600;
  return {
    getAllCodexRateLimitResetCredits: vi.fn().mockResolvedValue(
      makeCodexCreditsMap([
        {
          bucket: 'default',
          availableCount: 1,
          credits: [{ id: 'credit-1' }],
        },
      ]),
    ),
    getAllAnthropicUsageInfo: vi.fn().mockResolvedValue(new Map()),
    getAllCodexUsageInfo: vi.fn().mockResolvedValue(
      new Map([
        [
          'default',
          {
            plan_type: 'plus',
            rate_limit: {
              allowed: true,
              limit_reached: false,
              primary_window: {
                used_percent: 10,
                limit_window_seconds: 18000,
                reset_after_seconds: 3600,
                reset_at: futureResetAt,
              },
            },
          },
        ],
      ]),
    ),
    getToken: vi.fn().mockResolvedValue('codex-access'),
    listBuckets: vi.fn().mockResolvedValue(['default']),
    getTokenStore: vi.fn().mockReturnValue({
      getToken: vi.fn().mockResolvedValue(makeCodexToken()),
    }),
    ...overrides,
  };
}

describe('quotaCommand', () => {
  let mockContext: CommandContext;

  beforeEach(() => {
    mockContext = createMockCommandContext();

    getCliOAuthManagerMock.mockReset();
    maybeGetCliOAuthManagerMock.mockReset();
    getEphemeralSettingMock.mockReset();
    getActiveProviderNameMock.mockReset();
    getCliProviderManagerMock.mockReset();
    mockConsumeCodexRateLimitResetCredit.mockReset();

    getEphemeralSettingMock.mockReturnValue(undefined);
    maybeGetCliOAuthManagerMock.mockReturnValue(null);
  });

  describe('command structure', () => {
    it('has name quota and BUILT_IN kind', () => {
      expect(quotaCommand.name).toBe('quota');
      expect(quotaCommand.kind).toBe('built-in');
    });

    it('has status, credits, and reset subcommands', () => {
      const subNames = quotaCommand.subCommands?.map((sc) => sc.name);
      expect(subNames).toContain('status');
      expect(subNames).toContain('credits');
      expect(subNames).toContain('reset');
    });

    it('status subcommand is autoExecute', () => {
      const status = quotaCommand.subCommands?.find(
        (sc) => sc.name === 'status',
      );
      expect(status?.autoExecute).toBe(true);
    });

    it('credits subcommand is autoExecute', () => {
      const credits = quotaCommand.subCommands?.find(
        (sc) => sc.name === 'credits',
      );
      expect(credits?.autoExecute).toBe(true);
    });

    it('reset subcommand is NOT autoExecute', () => {
      const reset = quotaCommand.subCommands?.find((sc) => sc.name === 'reset');
      expect(reset?.autoExecute).toBeFalsy();
    });

    it('reset subcommand has a schema with codex option', () => {
      const reset = quotaCommand.subCommands?.find((sc) => sc.name === 'reset');
      expect(reset?.schema).toBeDefined();
      const firstNode = reset?.schema?.[0];
      expect(firstNode?.kind).toBe('value');
      const valueNode = firstNode as {
        kind: string;
        options?: Array<{ value: string }>;
      };
      const values = valueNode.options?.map((o) => o.value);
      expect(values).toContain('codex');
    });
  });

  describe('default action (status)', () => {
    it('shows no quota message when no quota available', async () => {
      maybeGetCliOAuthManagerMock.mockReturnValue(null);
      getEphemeralSettingMock.mockReturnValue(undefined);

      await quotaCommand.action!(mockContext, '');

      const lastItem = getLastUiItem(mockContext);
      expect(lastItem.type).toBe(MessageType.INFO);
      expect(lastItem.text).toContain('No quota information available');
    });

    it('shows quota lines when quota available', async () => {
      const oauthManager = {
        getAllAnthropicUsageInfo: vi
          .fn()
          .mockResolvedValue(
            new Map([
              [
                'default',
                { five_hour: { utilization: 10, resets_at: '2030-01-01' } },
              ],
            ]),
          ),
        getAllCodexUsageInfo: vi
          .fn()
          .mockResolvedValue(new Map<string, Record<string, unknown>>()),
      };
      maybeGetCliOAuthManagerMock.mockReturnValue(oauthManager);

      await quotaCommand.action!(mockContext, '');

      const lastItem = getLastUiItem(mockContext);
      expect(lastItem.type).toBe(MessageType.INFO);
      expect(lastItem.text).toContain('Claude Code Quota Information');
    });
  });

  describe('credits subcommand', () => {
    it('shows info when no OAuth manager available', async () => {
      maybeGetCliOAuthManagerMock.mockReturnValue(null);
      getCliOAuthManagerMock.mockImplementation(() => {
        throw new Error('not registered');
      });

      const credits = quotaCommand.subCommands?.find(
        (sc) => sc.name === 'credits',
      );
      await credits!.action!(mockContext, '');

      const lastItem = getLastUiItem(mockContext);
      expect(lastItem.type).toBe(MessageType.INFO);
      expect(lastItem.text).toContain('No Codex reset credits available');
    });

    it('shows no credits message when map is empty', async () => {
      const oauthManager = {
        getAllCodexRateLimitResetCredits: vi
          .fn()
          .mockResolvedValue(new Map<string, Record<string, unknown>>()),
      };
      maybeGetCliOAuthManagerMock.mockReturnValue(oauthManager);
      getCliOAuthManagerMock.mockReturnValue(oauthManager);

      const credits = quotaCommand.subCommands?.find(
        (sc) => sc.name === 'credits',
      );
      await credits!.action!(mockContext, '');

      const lastItem = getLastUiItem(mockContext);
      expect(lastItem.type).toBe(MessageType.INFO);
      expect(lastItem.text).toContain('No Codex reset credits available');
    });

    it('shows available credits count when credits present', async () => {
      const oauthManager = {
        getAllCodexRateLimitResetCredits: vi.fn().mockResolvedValue(
          makeCodexCreditsMap([
            {
              bucket: 'default',
              availableCount: 2,
              credits: [{ id: 'credit-1' }, { id: 'credit-2' }],
            },
          ]),
        ),
      };
      maybeGetCliOAuthManagerMock.mockReturnValue(oauthManager);
      getCliOAuthManagerMock.mockReturnValue(oauthManager);

      const credits = quotaCommand.subCommands?.find(
        (sc) => sc.name === 'credits',
      );
      await credits!.action!(mockContext, '');

      const lastItem = getLastUiItem(mockContext);
      expect(lastItem.type).toBe(MessageType.INFO);
      expect(lastItem.text).toContain('Available reset credits: 2');
    });

    it('shows error when getAllCodexRateLimitResetCredits rejects', async () => {
      const oauthManager = {
        getAllCodexRateLimitResetCredits: vi
          .fn()
          .mockRejectedValue(new Error('upstream down')),
      };
      maybeGetCliOAuthManagerMock.mockReturnValue(oauthManager);
      getCliOAuthManagerMock.mockReturnValue(oauthManager);

      const credits = quotaCommand.subCommands?.find(
        (sc) => sc.name === 'credits',
      );
      await credits!.action!(mockContext, '');

      const lastItem = getLastUiItem(mockContext);
      expect(lastItem.type).toBe(MessageType.ERROR);
      expect(lastItem.text).toContain('Failed to retrieve reset credits:');
    });

    it('shows bucket headers for multiple buckets with available credits', async () => {
      const oauthManager = {
        getAllCodexRateLimitResetCredits: vi.fn().mockResolvedValue(
          makeCodexCreditsMap([
            {
              bucket: 'bucket-a',
              availableCount: 1,
              credits: [{ id: 'credit-a' }],
            },
            {
              bucket: 'bucket-b',
              availableCount: 2,
              credits: [{ id: 'credit-b1' }, { id: 'credit-b2' }],
            },
          ]),
        ),
      };
      maybeGetCliOAuthManagerMock.mockReturnValue(oauthManager);
      getCliOAuthManagerMock.mockReturnValue(oauthManager);

      const credits = quotaCommand.subCommands?.find(
        (sc) => sc.name === 'credits',
      );
      await credits!.action!(mockContext, '');

      const lastItem = getLastUiItem(mockContext);
      expect(lastItem.type).toBe(MessageType.INFO);
      expect(lastItem.text).toContain('### Bucket: bucket-a');
      expect(lastItem.text).toContain('### Bucket: bucket-b');
    });

    it('shows no-credits message when map is non-empty but all buckets have zero available', async () => {
      const oauthManager = {
        getAllCodexRateLimitResetCredits: vi.fn().mockResolvedValue(
          makeCodexCreditsMap([
            {
              bucket: 'bucket-a',
              availableCount: 0,
              credits: [],
            },
          ]),
        ),
      };
      maybeGetCliOAuthManagerMock.mockReturnValue(oauthManager);
      getCliOAuthManagerMock.mockReturnValue(oauthManager);

      const credits = quotaCommand.subCommands?.find(
        (sc) => sc.name === 'credits',
      );
      await credits!.action!(mockContext, '');

      const lastItem = getLastUiItem(mockContext);
      expect(lastItem.type).toBe(MessageType.INFO);
      expect(lastItem.text).toContain('No Codex reset credits available');
    });
  });

  describe('reset subcommand', () => {
    it('shows error when provider arg is not codex', async () => {
      const reset = quotaCommand.subCommands?.find((sc) => sc.name === 'reset');
      await reset!.action!(mockContext, 'anthropic');

      const lastItem = getLastUiItem(mockContext);
      expect(lastItem.type).toBe(MessageType.ERROR);
      expect(lastItem.text).toContain("Only 'codex' supports reset");
    });

    it('shows /auth codex hint when not authenticated', async () => {
      const oauthManager = {
        getAllCodexRateLimitResetCredits: vi
          .fn()
          .mockResolvedValue(new Map<string, Record<string, unknown>>()),
        getToken: vi.fn().mockResolvedValue(null),
        listBuckets: vi.fn().mockResolvedValue([]),
      };
      maybeGetCliOAuthManagerMock.mockReturnValue(oauthManager);
      getCliOAuthManagerMock.mockReturnValue(oauthManager);

      const reset = quotaCommand.subCommands?.find((sc) => sc.name === 'reset');
      await reset!.action!(mockContext, '');

      const lastItem = getLastUiItem(mockContext);
      expect(lastItem.type).toBe(MessageType.INFO);
      expect(lastItem.text).toContain('/auth codex');
    });

    it('shows no-credits message when authed but zero credits', async () => {
      const oauthManager = {
        getAllCodexRateLimitResetCredits: vi
          .fn()
          .mockResolvedValue(new Map<string, Record<string, unknown>>()),
        getToken: vi.fn().mockResolvedValue('codex-token'),
        listBuckets: vi.fn().mockResolvedValue(['default']),
      };
      maybeGetCliOAuthManagerMock.mockReturnValue(oauthManager);
      getCliOAuthManagerMock.mockReturnValue(oauthManager);

      const reset = quotaCommand.subCommands?.find((sc) => sc.name === 'reset');
      await reset!.action!(mockContext, '');

      const lastItem = getLastUiItem(mockContext);
      expect(lastItem.type).toBe(MessageType.INFO);
      expect(lastItem.text).toContain('No reset credits available');
    });

    it('shows no-redeemable message when map non-empty but all buckets have zero available', async () => {
      const oauthManager = {
        getAllCodexRateLimitResetCredits: vi.fn().mockResolvedValue(
          makeCodexCreditsMap([
            {
              bucket: 'default',
              availableCount: 0,
              credits: [],
            },
          ]),
        ),
        getToken: vi.fn().mockResolvedValue('codex-token'),
        listBuckets: vi.fn().mockResolvedValue(['default']),
      };
      maybeGetCliOAuthManagerMock.mockReturnValue(oauthManager);
      getCliOAuthManagerMock.mockReturnValue(oauthManager);

      const reset = quotaCommand.subCommands?.find((sc) => sc.name === 'reset');
      await reset!.action!(mockContext, '');

      const lastItem = getLastUiItem(mockContext);
      expect(lastItem.type).toBe(MessageType.INFO);
      expect(lastItem.text).toContain('No reset credits available to redeem');
    });

    it('successfully redeems a credit and shows success + refreshed quota', async () => {
      const oauthManager = makeCodexResetOauthManager();
      maybeGetCliOAuthManagerMock.mockReturnValue(oauthManager);
      getCliOAuthManagerMock.mockReturnValue(oauthManager);
      mockContext = createMockCommandContext({ overwriteConfirmed: true });

      mockConsumeCodexRateLimitResetCredit.mockResolvedValue({
        code: 'reset',
        credit: { id: 'credit-1' },
      });

      const reset = quotaCommand.subCommands?.find((sc) => sc.name === 'reset');
      await reset!.action!(mockContext, '');

      expect(mockConsumeCodexRateLimitResetCredit).toHaveBeenCalledTimes(1);
      const callArgs = mockConsumeCodexRateLimitResetCredit.mock.calls[0];
      expect(callArgs[0]).toBe('codex-access');
      expect(callArgs[1]).toBe('acct-123');
      expect(callArgs[2]).toBe('credit-1');
      expect(callArgs[3]).toMatch(UUID_REGEX);
      expect(callArgs[4]).toBeUndefined();

      const calls = vi.mocked(mockContext.ui.addItem).mock.calls;
      const successItem = calls.find((call) => {
        const item = call[0] as { text: string; type: MessageType };
        return (
          item.text.includes('reset successfully') &&
          item.type === MessageType.INFO
        );
      });
      expect(successItem).toBeDefined();

      const quotaItem = calls.find((call) => {
        const item = call[0] as { text: string; type: MessageType };
        return (
          item.text.includes('Codex Quota Information') &&
          item.type === MessageType.INFO
        );
      });
      expect(quotaItem).toBeDefined();
    });

    it('shows already_redeemed message', async () => {
      const oauthManager = makeCodexResetOauthManager();
      maybeGetCliOAuthManagerMock.mockReturnValue(oauthManager);
      getCliOAuthManagerMock.mockReturnValue(oauthManager);
      mockContext = createMockCommandContext({ overwriteConfirmed: true });

      mockConsumeCodexRateLimitResetCredit.mockResolvedValue({
        code: 'already_redeemed',
      });

      const reset = quotaCommand.subCommands?.find((sc) => sc.name === 'reset');
      await reset!.action!(mockContext, '');

      expect(mockConsumeCodexRateLimitResetCredit).toHaveBeenCalledTimes(1);

      const calls = vi.mocked(mockContext.ui.addItem).mock.calls;
      const alreadyItem = calls.find((call) => {
        const item = call[0] as { text: string; type: MessageType };
        return (
          item.text.includes('already redeemed') &&
          item.type === MessageType.INFO
        );
      });
      expect(alreadyItem).toBeDefined();

      const quotaItem = calls.find((call) => {
        const item = call[0] as { text: string; type: MessageType };
        return (
          item.text.includes('Codex Quota Information') &&
          item.type === MessageType.INFO
        );
      });
      expect(quotaItem).toBeDefined();
    });

    it('shows error when consume returns null', async () => {
      const oauthManager = makeCodexResetOauthManager();
      maybeGetCliOAuthManagerMock.mockReturnValue(oauthManager);
      getCliOAuthManagerMock.mockReturnValue(oauthManager);
      mockContext = createMockCommandContext({ overwriteConfirmed: true });

      mockConsumeCodexRateLimitResetCredit.mockResolvedValue(null);

      const reset = quotaCommand.subCommands?.find((sc) => sc.name === 'reset');
      await reset!.action!(mockContext, '');

      const lastItem = getLastUiItem(mockContext);
      expect(lastItem.type).toBe(MessageType.ERROR);
      expect(lastItem.text).toContain('Failed to reset');
    });

    it('shows error when consume throws an exception', async () => {
      const oauthManager = makeCodexResetOauthManager();
      maybeGetCliOAuthManagerMock.mockReturnValue(oauthManager);
      getCliOAuthManagerMock.mockReturnValue(oauthManager);
      mockContext = createMockCommandContext({ overwriteConfirmed: true });

      mockConsumeCodexRateLimitResetCredit.mockRejectedValue(
        new Error('Network timeout'),
      );

      const reset = quotaCommand.subCommands?.find((sc) => sc.name === 'reset');
      await reset!.action!(mockContext, '');

      const lastItem = getLastUiItem(mockContext);
      expect(lastItem.type).toBe(MessageType.ERROR);
      expect(lastItem.text).toContain('Failed to reset rate-limit window');
    });

    it('shows error when token store returns token without access_token', async () => {
      const oauthManager = makeCodexResetOauthManager({
        getTokenStore: vi.fn().mockReturnValue({
          getToken: vi.fn().mockResolvedValue({ account_id: 'acct-123' }),
        }),
      });
      maybeGetCliOAuthManagerMock.mockReturnValue(oauthManager);
      getCliOAuthManagerMock.mockReturnValue(oauthManager);

      const reset = quotaCommand.subCommands?.find((sc) => sc.name === 'reset');
      await reset!.action!(mockContext, '');

      const lastItem = getLastUiItem(mockContext);
      expect(lastItem.type).toBe(MessageType.ERROR);
      expect(lastItem.text).toContain('unavailable or expired');
    });

    it('redeems from a later bucket when the first credit-bearing bucket has expired credentials', async () => {
      const oauthManager = makeCodexResetOauthManager({
        getAllCodexRateLimitResetCredits: vi.fn().mockResolvedValue(
          makeCodexCreditsMap([
            {
              bucket: 'expired-bucket',
              availableCount: 1,
              credits: [{ id: 'expired-credit' }],
            },
            {
              bucket: 'valid-bucket',
              availableCount: 1,
              credits: [{ id: 'valid-credit' }],
            },
          ]),
        ),
        getTokenStore: vi.fn().mockReturnValue({
          getToken: vi
            .fn()
            .mockResolvedValueOnce(
              makeCodexToken({ expiry: Math.floor(Date.now() / 1000) - 1 }),
            )
            .mockResolvedValueOnce(makeCodexToken()),
        }),
      });
      getCliOAuthManagerMock.mockReturnValue(oauthManager);
      mockContext = createMockCommandContext({ overwriteConfirmed: true });
      mockConsumeCodexRateLimitResetCredit.mockResolvedValue({ code: 'reset' });

      const reset = quotaCommand.subCommands?.find((sc) => sc.name === 'reset');
      await reset!.action!(mockContext, '');

      expect(mockConsumeCodexRateLimitResetCredit).toHaveBeenCalledWith(
        'codex-access',
        'acct-123',
        'valid-credit',
        expect.any(String),
        undefined,
      );
    });

    it('shows error when getAllCodexRateLimitResetCredits rejects during reset flow', async () => {
      const oauthManager = makeCodexResetOauthManager({
        getAllCodexRateLimitResetCredits: vi
          .fn()
          .mockRejectedValue(new Error('reset fetch failed')),
      });
      maybeGetCliOAuthManagerMock.mockReturnValue(oauthManager);
      getCliOAuthManagerMock.mockReturnValue(oauthManager);

      const reset = quotaCommand.subCommands?.find((sc) => sc.name === 'reset');
      await reset!.action!(mockContext, '');

      const lastItem = getLastUiItem(mockContext);
      expect(lastItem.type).toBe(MessageType.ERROR);
      expect(lastItem.text).toContain('Failed to reset rate-limit window:');
    });

    it('shows /auth codex info when getCliOAuthManager throws', async () => {
      maybeGetCliOAuthManagerMock.mockReturnValue(null);
      getCliOAuthManagerMock.mockImplementation(() => {
        throw new Error('not registered');
      });

      const reset = quotaCommand.subCommands?.find((sc) => sc.name === 'reset');
      await reset!.action!(mockContext, '');

      const lastItem = getLastUiItem(mockContext);
      expect(lastItem.type).toBe(MessageType.INFO);
      expect(lastItem.text).toContain('/auth codex');
      expect(lastItem.text).toContain('Not authenticated with Codex');
    });

    it('prompts for confirmation before redeeming when not yet confirmed', async () => {
      const oauthManager = makeCodexResetOauthManager();
      maybeGetCliOAuthManagerMock.mockReturnValue(oauthManager);
      getCliOAuthManagerMock.mockReturnValue(oauthManager);
      // mockContext has NO overwriteConfirmed — first invocation.

      const reset = quotaCommand.subCommands?.find((sc) => sc.name === 'reset');
      const result = await reset!.action!(mockContext, '');

      expect(result).toBeDefined();
      expect(result).not.toBeNull();
      const confirmResult = result as {
        type: string;
        prompt: string;
        originalInvocation: { raw: string };
      };
      expect(confirmResult.type).toBe('confirm_action');
      expect(typeof confirmResult.prompt).toBe('string');
      expect(confirmResult.prompt.length).toBeGreaterThan(0);
      expect(confirmResult.originalInvocation.raw).toContain('quota reset');
      expect(mockConsumeCodexRateLimitResetCredit).not.toHaveBeenCalled();
    });

    it('shows too-many-arguments error for /quota reset codex extra and does not consume', async () => {
      const reset = quotaCommand.subCommands?.find((sc) => sc.name === 'reset');
      await reset!.action!(mockContext, 'codex extra');

      const lastItem = getLastUiItem(mockContext);
      expect(lastItem.type).toBe(MessageType.ERROR);
      expect(lastItem.text).toContain('Too many arguments');
      expect(mockConsumeCodexRateLimitResetCredit).not.toHaveBeenCalled();
    });

    it('succeeds when provider arg is explicitly codex', async () => {
      const oauthManager = makeCodexResetOauthManager();
      maybeGetCliOAuthManagerMock.mockReturnValue(oauthManager);
      getCliOAuthManagerMock.mockReturnValue(oauthManager);
      mockContext = createMockCommandContext({ overwriteConfirmed: true });

      mockConsumeCodexRateLimitResetCredit.mockResolvedValue({
        code: 'reset',
        credit: { id: 'credit-1' },
      });

      const reset = quotaCommand.subCommands?.find((sc) => sc.name === 'reset');
      await reset!.action!(mockContext, 'codex');

      expect(mockConsumeCodexRateLimitResetCredit).toHaveBeenCalledTimes(1);

      const calls = vi.mocked(mockContext.ui.addItem).mock.calls;
      const successItem = calls.find((call) => {
        const item = call[0] as { text: string; type: MessageType };
        return (
          item.text.includes('reset successfully') &&
          item.type === MessageType.INFO
        );
      });
      expect(successItem).toBeDefined();
    });

    it('forwards the custom base-url as the 5th arg to consumeCodexRateLimitResetCredit', async () => {
      const oauthManager = makeCodexResetOauthManager();
      maybeGetCliOAuthManagerMock.mockReturnValue(oauthManager);
      getCliOAuthManagerMock.mockReturnValue(oauthManager);
      getEphemeralSettingMock.mockReturnValue(
        'https://example.test/backend-api',
      );
      mockContext = createMockCommandContext({ overwriteConfirmed: true });

      mockConsumeCodexRateLimitResetCredit.mockResolvedValue({
        code: 'reset',
        credit: { id: 'credit-1' },
      });

      const reset = quotaCommand.subCommands?.find((sc) => sc.name === 'reset');
      await reset!.action!(mockContext, '');

      expect(mockConsumeCodexRateLimitResetCredit).toHaveBeenCalledTimes(1);
      expect(
        vi.mocked(mockConsumeCodexRateLimitResetCredit).mock.calls[0][4],
      ).toBe('https://example.test/backend-api');
    });

    it('forwards undefined as base-url when the setting is whitespace-only', async () => {
      const oauthManager = makeCodexResetOauthManager();
      maybeGetCliOAuthManagerMock.mockReturnValue(oauthManager);
      getCliOAuthManagerMock.mockReturnValue(oauthManager);
      getEphemeralSettingMock.mockReturnValue('   ');
      mockContext = createMockCommandContext({ overwriteConfirmed: true });

      mockConsumeCodexRateLimitResetCredit.mockResolvedValue({
        code: 'reset',
        credit: { id: 'credit-1' },
      });

      const reset = quotaCommand.subCommands?.find((sc) => sc.name === 'reset');
      await reset!.action!(mockContext, '');

      expect(mockConsumeCodexRateLimitResetCredit).toHaveBeenCalledTimes(1);
      expect(
        vi.mocked(mockConsumeCodexRateLimitResetCredit).mock.calls[0][4],
      ).toBeUndefined();
    });
  });
});
