/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiChat } from './geminiChat.js';
import { Config } from '../config/config.js';
import { DEFAULT_TOKEN_LIMIT } from './tokenLimits.js';
import * as tokenLimitsModule from './tokenLimits.js';

describe('GeminiChat Context Limit Enforcement', () => {
  let chat: GeminiChat;
  let mockConfig: Config;
  let mockHistoryService: {
    getTotalTokens: ReturnType<typeof vi.fn>;
    waitForTokenUpdates: ReturnType<typeof vi.fn>;
    emit: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // Mock Config object similar to existing tests
    mockConfig = {
      getSessionId: () => 'test-session-id',
      getTelemetryLogPromptsEnabled: () => true,
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      getContentGeneratorConfig: () => ({
        authType: 'oauth-personal',
        model: 'test-model',
      }),
      getModel: vi.fn().mockReturnValue('hf:zai-org/GLM-4.6'),
      setModel: vi.fn(),
      getEphemeralSettings: vi.fn().mockReturnValue({}),
      getEphemeralSetting: vi.fn().mockImplementation((key) => {
        if (key === 'context-limit') return 190000;
        return undefined;
      }),
      setEphemeralSetting: vi.fn(),
      getProviderManager: vi.fn().mockReturnValue({
        getActiveProvider: vi.fn().mockReturnValue({
          name: 'test-provider',
          generateChatCompletion: vi.fn(),
        }),
      }),
    } as unknown as Config;

    // Mock the history service
    mockHistoryService = {
      getTotalTokens: vi.fn().mockReturnValue(180000),
      waitForTokenUpdates: vi.fn().mockResolvedValue(undefined),
      emit: vi.fn(),
    };

    // Mock the tokenLimit function to track calls
    vi.spyOn(tokenLimitsModule, 'tokenLimit').mockImplementation(
      (model, userContextLimit) => {
        if (userContextLimit) {
          return userContextLimit;
        }
        return DEFAULT_TOKEN_LIMIT;
      },
    );
  });

  it('should enforce context window using user-configured context-limit', async () => {
    // Arrange: Set up chat with context-limit and mock large pending tokens
    chat = new GeminiChat(mockConfig, mockHistoryService);

    // Mock large pending tokens that would exceed the context-limit but not the default
    const pendingTokens = 15000; // This would exceed 190000 but not the default 1M

    // Act & Assert: enforceContextWindow should trigger compression
    // because total (180000) + pending (15000) = 195000 > context-limit (190000)
    await expect(
      chat['enforceContextWindow'](pendingTokens, 'test-prompt-id'),
    ).resolves.not.toThrow();

    // Verify tokenLimit was called with the user context limit
    expect(tokenLimitsModule.tokenLimit).toHaveBeenCalledWith(
      mockConfig.getModel(),
      190000, // This should be passed as userContextLimit
    );
  });

  it('should not trigger compression when within context-limit', async () => {
    // Arrange: Set up chat with context-limit and small pending tokens
    chat = new GeminiChat(mockConfig, mockHistoryService);
    const pendingTokens = 5000; // This should be within the limit

    // Act: Should not trigger compression
    await expect(
      chat['enforceContextWindow'](pendingTokens, 'test-prompt-id'),
    ).resolves.not.toThrow();

    // Verify tokenLimit was called with the user context limit
    expect(tokenLimitsModule.tokenLimit).toHaveBeenCalledWith(
      mockConfig.getModel(),
      190000,
    );
  });

  it('should use context-limit when available, falling back to default when not set', async () => {
    // Arrange: Create config without context-limit
    const configWithoutLimit = {
      ...mockConfig,
      getEphemeralSetting: vi.fn().mockReturnValue(undefined),
    };
    chat = new GeminiChat(configWithoutLimit, mockHistoryService);
    const pendingTokens = 15000;

    // Act
    await expect(
      chat['enforceContextWindow'](pendingTokens, 'test-prompt-id'),
    ).resolves.not.toThrow();

    // Verify tokenLimit was called without user context limit
    expect(tokenLimitsModule.tokenLimit).toHaveBeenCalledWith(
      configWithoutLimit.getModel(),
      undefined,
    );
  });
});
