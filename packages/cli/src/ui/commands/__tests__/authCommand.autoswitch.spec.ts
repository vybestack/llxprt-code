/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AuthCommandExecutor } from '../authCommand.js';
import { OAuthManager } from '../../../auth/oauth-manager.js';
import { CommandContext } from '../types.js';

// Mock the runtime settings module (partial mock)
vi.mock('../../../runtime/runtimeSettings.js', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../../runtime/runtimeSettings.js')
    >();
  return {
    ...actual,
    switchActiveProvider: vi.fn(),
    getEphemeralSetting: vi.fn(),
  };
});

import {
  switchActiveProvider,
  getEphemeralSetting,
} from '../../../runtime/runtimeSettings.js';

const mockSwitchActiveProvider = switchActiveProvider as ReturnType<
  typeof vi.fn
>;
const mockGetEphemeralSetting = getEphemeralSetting as ReturnType<typeof vi.fn>;

describe('Auth Command Auto-Switch Integration', () => {
  let executor: AuthCommandExecutor;
  let mockOAuthManager: OAuthManager;
  let mockContext: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();

    mockOAuthManager = {
      authenticate: vi.fn().mockResolvedValue(undefined),
      getSupportedProviders: vi
        .fn()
        .mockReturnValue(['gemini', 'qwen', 'anthropic', 'codex']),
    } as unknown as OAuthManager;

    executor = new AuthCommandExecutor(mockOAuthManager);

    mockContext = {
      services: {
        config: null,
        settings: {} as never,
        git: undefined,
        logger: {} as never,
      },
      ui: {} as never,
      session: {} as never,
    };

    // Default: auto-switch enabled
    mockGetEphemeralSetting.mockReturnValue(true);
    mockSwitchActiveProvider.mockResolvedValue({
      changed: true,
      previousProvider: 'gemini',
      nextProvider: 'anthropic',
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('@requirement REQ-001: Auto-switch after auth', () => {
    it('switches provider after successful OAuth login', async () => {
      const result = await executor.execute(mockContext, 'anthropic login');

      expect(mockOAuthManager.authenticate).toHaveBeenCalledWith(
        'anthropic',
        undefined,
      );
      expect(mockSwitchActiveProvider).toHaveBeenCalledWith('anthropic');
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: '[OK] Authenticated with anthropic and set as active provider',
      });
    });

    it('includes bucket info in success message', async () => {
      const result = await executor.execute(
        mockContext,
        'anthropic login work',
      );

      expect(mockOAuthManager.authenticate).toHaveBeenCalledWith(
        'anthropic',
        'work',
      );
      expect(mockSwitchActiveProvider).toHaveBeenCalledWith('anthropic');
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content:
          '[OK] Authenticated with anthropic (bucket: work) and set as active provider',
      });
    });
  });

  describe('@requirement REQ-008: Configurable auto-switch', () => {
    it('skips auto-switch when setting is disabled', async () => {
      mockGetEphemeralSetting.mockReturnValue(false);

      const result = await executor.execute(mockContext, 'anthropic login');

      expect(mockOAuthManager.authenticate).toHaveBeenCalledWith(
        'anthropic',
        undefined,
      );
      expect(mockSwitchActiveProvider).not.toHaveBeenCalled();
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: 'Successfully authenticated anthropic',
      });
    });

    it('defaults to enabled when setting is undefined', async () => {
      mockGetEphemeralSetting.mockReturnValue(undefined);

      await executor.execute(mockContext, 'anthropic login');

      expect(mockSwitchActiveProvider).toHaveBeenCalledWith('anthropic');
    });
  });

  describe('@requirement REQ-010: Graceful error handling', () => {
    it('succeeds auth even when switch fails', async () => {
      mockSwitchActiveProvider.mockRejectedValue(
        new Error('Provider not found'),
      );

      const result = await executor.execute(mockContext, 'anthropic login');

      expect(mockOAuthManager.authenticate).toHaveBeenCalled();
      expect(result.type).toBe('message');
      expect((result as { messageType: string }).messageType).toBe('info');
      expect((result as { content: string }).content).toContain(
        'Successfully authenticated',
      );
      expect((result as { content: string }).content).toContain(
        'auto-switch to provider failed',
      );
    });
  });

  describe('@requirement REQ-004.2: Override existing provider', () => {
    it('switches even when provider already set', async () => {
      mockSwitchActiveProvider.mockResolvedValue({
        changed: true,
        previousProvider: 'openai',
        nextProvider: 'anthropic',
      });

      const result = await executor.execute(mockContext, 'anthropic login');

      expect(mockSwitchActiveProvider).toHaveBeenCalledWith('anthropic');
      expect((result as { content: string }).content).toContain(
        'set as active provider',
      );
    });

    it('shows simple message when already on same provider', async () => {
      mockSwitchActiveProvider.mockResolvedValue({
        changed: false,
        previousProvider: 'anthropic',
        nextProvider: 'anthropic',
      });

      const result = await executor.execute(mockContext, 'anthropic login');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: 'Successfully authenticated anthropic',
      });
    });
  });
});
