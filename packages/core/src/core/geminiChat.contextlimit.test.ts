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
import { createGeminiChatRuntime } from '../test-utils/runtime.js';
import { AuthType } from './contentGenerator.js';
import {
  createAgentRuntimeState,
  type AgentRuntimeState,
} from '../runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '../runtime/createAgentRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapterFromConfig,
  createToolRegistryViewFromRegistry,
} from '../runtime/runtimeAdapters.js';
import { HistoryService } from '../services/history/HistoryService.js';
import * as providerRuntime from '../runtime/providerRuntimeContext.js';
import type { ProviderRuntimeContext } from '../runtime/providerRuntimeContext.js';

describe('GeminiChat Context Limit Enforcement', () => {
  let chat: GeminiChat;
  let mockConfig: Config;
  let runtimeState: AgentRuntimeState;
  let runtimeSetup: ReturnType<typeof createGeminiChatRuntime>;
  let providerRuntimeSnapshot: ProviderRuntimeContext;
  let mockContentGenerator: {
    generateContent: ReturnType<typeof vi.fn>;
    generateContentStream: ReturnType<typeof vi.fn>;
    countTokens: ReturnType<typeof vi.fn>;
    embedContent: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    const mockProvider = {
      name: 'test-provider',
      generateContent: vi.fn().mockResolvedValue({
        content: [
          {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'Test response' }],
          },
        ],
      }),
      generateContentStream: vi.fn(),
      generateChatCompletion: vi.fn().mockImplementation(() =>
        (async function* () {
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'Test response' }],
          };
        })(),
      ),
    };

    const providerManager = {
      getActiveProvider: vi.fn(() => mockProvider),
    };

    runtimeSetup = createGeminiChatRuntime({
      provider: mockProvider,
      providerManager,
      configOverrides: {
        getModel: vi.fn().mockReturnValue('hf:zai-org/GLM-4.6'),
        setModel: vi.fn(),
        getQuotaErrorOccurred: vi.fn().mockReturnValue(false),
        setQuotaErrorOccurred: vi.fn(),
        getEphemeralSettings: vi.fn().mockReturnValue({}),
        getEphemeralSetting: vi.fn().mockImplementation((key) => {
          if (key === 'context-limit') return 190000;
          return undefined;
        }),
        getProviderManager: vi.fn().mockReturnValue(providerManager),
      },
    });

    mockConfig = runtimeSetup.config;

    // Set up provider runtime context
    providerRuntimeSnapshot = {
      ...runtimeSetup.runtime,
      config: mockConfig,
    };
    providerRuntime.setActiveProviderRuntimeContext(providerRuntimeSnapshot);

    // Create mock ContentGenerator
    mockContentGenerator = {
      generateContent: vi.fn(),
      generateContentStream: vi.fn(),
      countTokens: vi.fn().mockReturnValue(100),
      embedContent: vi.fn(),
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
    runtimeState = createAgentRuntimeState({
      runtimeId: runtimeSetup.runtime.runtimeId,
      provider: runtimeSetup.provider.name,
      model: 'hf:zai-org/GLM-4.6',
      authType: AuthType.LOGIN_WITH_GOOGLE,
      sessionId: 'test-session-id',
    });

    const historyService = new HistoryService();
    vi.spyOn(historyService, 'getTotalTokens').mockReturnValue(40000);
    vi.spyOn(historyService, 'waitForTokenUpdates').mockResolvedValue(
      undefined,
    );

    const view = createAgentRuntimeContext({
      state: runtimeState,
      history: historyService,
      settings: {
        compressionThreshold: 0.8,
        contextLimit: 190000, // User-configured context limit
        preserveThreshold: 0.2,
        telemetry: {
          enabled: true,
          target: null,
        },
      },
      provider: createProviderAdapterFromManager(
        mockConfig.getProviderManager?.(),
      ),
      telemetry: createTelemetryAdapterFromConfig(mockConfig as Config),
      tools: createToolRegistryViewFromRegistry(mockConfig.getToolRegistry?.()),
      providerRuntime: providerRuntimeSnapshot,
    });

    chat = new GeminiChat(view, mockContentGenerator, {}, []);

    // Mock large pending tokens that would exceed the context-limit but not the default
    // Total projection: 40000 (history) + 50000 (pending) + 65536 (budget) = 155536
    // This is under the limit (190000 - 256 margin = 189744) but should still test enforcement
    const pendingTokens = 50000;

    // Act & Assert: enforceContextWindow should NOT trigger compression
    // Total: 40000 (history) + 50000 (pending) + 65536 (budget) = 155536
    // Limit: 190000 - 256 (safety margin) = 189744
    // 155536 < 189744, so should not throw
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
    runtimeState = createAgentRuntimeState({
      runtimeId: runtimeSetup.runtime.runtimeId,
      provider: runtimeSetup.provider.name,
      model: 'hf:zai-org/GLM-4.6',
      authType: AuthType.LOGIN_WITH_GOOGLE,
      sessionId: 'test-session-id',
    });

    const historyService = new HistoryService();
    vi.spyOn(historyService, 'getTotalTokens').mockReturnValue(40000);
    vi.spyOn(historyService, 'waitForTokenUpdates').mockResolvedValue(
      undefined,
    );

    const view = createAgentRuntimeContext({
      state: runtimeState,
      history: historyService,
      settings: {
        compressionThreshold: 0.8,
        contextLimit: 190000,
        preserveThreshold: 0.2,
        telemetry: {
          enabled: true,
          target: null,
        },
      },
      provider: createProviderAdapterFromManager(
        mockConfig.getProviderManager?.(),
      ),
      telemetry: createTelemetryAdapterFromConfig(mockConfig as Config),
      tools: createToolRegistryViewFromRegistry(mockConfig.getToolRegistry?.()),
      providerRuntime: providerRuntimeSnapshot,
    });

    chat = new GeminiChat(view, mockContentGenerator, {}, []);
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

    runtimeState = createAgentRuntimeState({
      runtimeId: runtimeSetup.runtime.runtimeId,
      provider: runtimeSetup.provider.name,
      model: 'hf:zai-org/GLM-4.6',
      authType: AuthType.LOGIN_WITH_GOOGLE,
      sessionId: 'test-session-id',
    });

    const historyService = new HistoryService();
    // Reduced token counts to account for completion budget
    // Using smaller completion budget (4096) to keep total reasonable
    // Total: 10000 (history) + 5000 (pending) + 4096 (budget) = 19096
    // This is well under DEFAULT_TOKEN_LIMIT (1,048,576) and demonstrates the fallback
    vi.spyOn(historyService, 'getTotalTokens').mockReturnValue(10000);
    vi.spyOn(historyService, 'waitForTokenUpdates').mockResolvedValue(
      undefined,
    );

    const view = createAgentRuntimeContext({
      state: runtimeState,
      history: historyService,
      settings: {
        compressionThreshold: 0.8,
        contextLimit: undefined, // No user-configured context limit
        preserveThreshold: 0.2,
        telemetry: {
          enabled: true,
          target: null,
        },
      },
      provider: createProviderAdapterFromManager(
        configWithoutLimit.getProviderManager?.(),
      ),
      telemetry: createTelemetryAdapterFromConfig(configWithoutLimit as Config),
      tools: createToolRegistryViewFromRegistry(
        configWithoutLimit.getToolRegistry?.(),
      ),
      providerRuntime: providerRuntimeSnapshot,
    });

    // Mock smaller completion budget to keep test scenario reasonable
    const contentGeneratorWithSmallBudget = {
      ...mockContentGenerator,
      countTokens: vi.fn().mockReturnValue(100),
    };

    chat = new GeminiChat(
      view,
      contentGeneratorWithSmallBudget,
      { maxOutputTokens: 4096 }, // Smaller budget instead of default 65536
      [],
    );
    const pendingTokens = 5000;

    // Act
    await expect(
      chat['enforceContextWindow'](pendingTokens, 'test-prompt-id'),
    ).resolves.not.toThrow();

    // Verify tokenLimit was called with a fallback (undefined) followed by provider default
    expect(tokenLimitsModule.tokenLimit).toHaveBeenNthCalledWith(
      1,
      configWithoutLimit.getModel(),
      undefined,
    );
    expect(tokenLimitsModule.tokenLimit).toHaveBeenNthCalledWith(
      2,
      configWithoutLimit.getModel(),
      DEFAULT_TOKEN_LIMIT,
    );
  });
});
