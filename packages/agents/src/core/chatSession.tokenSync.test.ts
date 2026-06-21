/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for Token Count Synchronization from API Usage Metadata (streaming).
 * Non-streaming scenarios live in chatSession.tokenSync.nonstream.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatSession } from './chatSession.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  createAgentRuntimeState,
  type AgentRuntimeState,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapterFromConfig,
  createToolRegistryViewFromRegistry,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { createTokenSyncTestFixture } from './chatSession-tokenSync-helpers.js';

describe('ChatSession Token Count Sync - Streaming API Usage Metadata', () => {
  let chat: ChatSession;
  let mockConfig: Config;
  let runtimeState: AgentRuntimeState;
  let runtimeSetup: ReturnType<
    typeof createTokenSyncTestFixture
  >['runtimeSetup'];
  let providerRuntimeSnapshot: ReturnType<
    typeof createTokenSyncTestFixture
  >['providerRuntimeSnapshot'];
  let mockContentGenerator: ReturnType<
    typeof createTokenSyncTestFixture
  >['mockContentGenerator'];
  let historyService: ReturnType<
    typeof createTokenSyncTestFixture
  >['historyService'];

  beforeEach(() => {
    vi.clearAllMocks();
    const fixture = createTokenSyncTestFixture();
    mockConfig = fixture.mockConfig;
    runtimeSetup = fixture.runtimeSetup;
    providerRuntimeSnapshot = fixture.providerRuntimeSnapshot;
    mockContentGenerator = fixture.mockContentGenerator;
    historyService = fixture.historyService;
  });

  describe('Anthropic Provider - input_tokens', () => {
    it('should include cached prompt tokens from API usage after streaming response', async () => {
      runtimeState = createAgentRuntimeState({
        runtimeId: runtimeSetup.runtime.runtimeId,
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        sessionId: 'test-session-id',
      });

      historyService.add(
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'What is 2+2?' }],
        },
        'claude-3-5-sonnet-20241022',
      );
      await historyService.waitForTokenUpdates();

      const mockProvider = {
        name: 'anthropic',
        generateChatCompletion: vi.fn().mockImplementation(async function* () {
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'The answer is 4.' }],
          };

          yield {
            speaker: 'ai',
            blocks: [],
            metadata: {
              usage: {
                promptTokens: 5000,
                completionTokens: 15,
                totalTokens: 5015,
                cache_read_input_tokens: 14573,
              },
            },
            usageMetadata: {
              promptTokenCount: 5000,
              candidatesTokenCount: 15,
              totalTokenCount: 5015,
              cache_read_input_tokens: 14573,
            },
          };
        }),
      };

      const providerManager = {
        getActiveProvider: vi.fn(() => mockProvider),
      };

      mockConfig.getProviderManager = vi.fn().mockReturnValue(providerManager);

      const view = createAgentRuntimeContext({
        state: runtimeState,
        history: historyService,
        settings: {
          compressionThreshold: 0.8,
          contextLimit: 200000,
          preserveThreshold: 0.2,
          telemetry: { enabled: true, target: null },
        },
        provider: createProviderAdapterFromManager(
          mockConfig.getProviderManager(),
        ),
        telemetry: createTelemetryAdapterFromConfig(mockConfig),
        tools: createToolRegistryViewFromRegistry(),
        providerRuntime: providerRuntimeSnapshot,
      });

      chat = new ChatSession(view, mockContentGenerator, {}, []);

      const stream = await chat.sendMessageStream(
        { message: [{ text: 'What is 2+2?' }] },
        'test-prompt-id',
      );

      for await (const _event of stream) {
        // Consume stream
      }

      await historyService.waitForTokenUpdates();

      const actualCount = historyService.getTotalTokens();
      expect(actualCount).toBe(19573);
    });

    it('should sync tokens when API reports higher count than estimate', async () => {
      runtimeState = createAgentRuntimeState({
        runtimeId: runtimeSetup.runtime.runtimeId,
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        sessionId: 'test-session-id',
      });

      historyService.add(
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hi' }],
        },
        'claude-3-5-sonnet-20241022',
      );
      await historyService.waitForTokenUpdates();

      const mockProvider = {
        name: 'anthropic',
        generateChatCompletion: vi.fn().mockImplementation(async function* () {
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'Hello!' }],
          };

          yield {
            speaker: 'ai',
            blocks: [],
            metadata: {
              usage: {
                promptTokens: 12500,
                completionTokens: 10,
                totalTokens: 12510,
              },
            },
          };
        }),
      };

      const providerManager = {
        getActiveProvider: vi.fn(() => mockProvider),
      };

      mockConfig.getProviderManager = vi.fn().mockReturnValue(providerManager);

      const view = createAgentRuntimeContext({
        state: runtimeState,
        history: historyService,
        settings: {
          compressionThreshold: 0.8,
          contextLimit: 200000,
          preserveThreshold: 0.2,
          telemetry: { enabled: true, target: null },
        },
        provider: createProviderAdapterFromManager(
          mockConfig.getProviderManager(),
        ),
        telemetry: createTelemetryAdapterFromConfig(mockConfig),
        tools: createToolRegistryViewFromRegistry(),
        providerRuntime: providerRuntimeSnapshot,
      });

      chat = new ChatSession(view, mockContentGenerator, {}, []);

      const stream = await chat.sendMessageStream(
        { message: [{ text: 'Hi' }] },
        'test-prompt-id',
      );

      for await (const _event of stream) {
        // Consume stream
      }

      await historyService.waitForTokenUpdates();

      const actualCount = historyService.getTotalTokens();
      expect(actualCount).toBe(12500);
    });

    it('should sync tokens with actual API count', async () => {
      runtimeState = createAgentRuntimeState({
        runtimeId: runtimeSetup.runtime.runtimeId,
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        sessionId: 'test-session-id',
      });

      historyService.add(
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
        'claude-3-5-sonnet-20241022',
      );
      await historyService.waitForTokenUpdates();

      const mockProvider = {
        name: 'anthropic',
        generateChatCompletion: vi.fn().mockImplementation(async function* () {
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'Response' }],
          };

          yield {
            speaker: 'ai',
            blocks: [],
            metadata: {
              usage: {
                promptTokens: 4500,
                completionTokens: 20,
                totalTokens: 4520,
              },
            },
          };
        }),
      };

      const providerManager = {
        getActiveProvider: vi.fn(() => mockProvider),
      };

      mockConfig.getProviderManager = vi.fn().mockReturnValue(providerManager);

      const view = createAgentRuntimeContext({
        state: runtimeState,
        history: historyService,
        settings: {
          compressionThreshold: 0.8,
          contextLimit: 200000,
          preserveThreshold: 0.2,
          telemetry: { enabled: true, target: null },
        },
        provider: createProviderAdapterFromManager(
          mockConfig.getProviderManager(),
        ),
        telemetry: createTelemetryAdapterFromConfig(mockConfig),
        tools: createToolRegistryViewFromRegistry(),
        providerRuntime: providerRuntimeSnapshot,
      });

      chat = new ChatSession(view, mockContentGenerator, {}, []);

      const stream = await chat.sendMessageStream(
        { message: [{ text: 'Test' }] },
        'test-prompt-id',
      );

      for await (const _event of stream) {
        // Consume stream
      }

      await historyService.waitForTokenUpdates();

      const actualCount = historyService.getTotalTokens();
      expect(actualCount).toBe(4500);
    });
  });

  describe('Gemini Provider - promptTokenCount', () => {
    it('should update total tokens from Gemini usage metadata', async () => {
      runtimeState = createAgentRuntimeState({
        runtimeId: runtimeSetup.runtime.runtimeId,
        provider: 'gemini',
        model: 'gemini-pro',
        sessionId: 'test-session-id',
      });

      historyService.add(
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Explain quantum computing' }],
        },
        'gemini-pro',
      );
      await historyService.waitForTokenUpdates();

      const mockProvider = {
        name: 'openai',
        generateChatCompletion: vi.fn().mockImplementation(async function* () {
          yield {
            speaker: 'ai',
            blocks: [
              {
                type: 'text',
                text: 'The weather is sunny today.',
              },
            ],
          };

          yield {
            speaker: 'ai',
            blocks: [],
            metadata: {
              usage: {
                promptTokens: 6500,
                completionTokens: 25,
                totalTokens: 6525,
              },
            },
          };
        }),
      };

      const providerManager = {
        getActiveProvider: vi.fn(() => mockProvider),
      };

      mockConfig.getProviderManager = vi.fn().mockReturnValue(providerManager);

      const view = createAgentRuntimeContext({
        state: runtimeState,
        history: historyService,
        settings: {
          compressionThreshold: 0.8,
          contextLimit: 200000,
          preserveThreshold: 0.2,
          telemetry: { enabled: true, target: null },
        },
        provider: createProviderAdapterFromManager(
          mockConfig.getProviderManager(),
        ),
        telemetry: createTelemetryAdapterFromConfig(mockConfig),
        tools: createToolRegistryViewFromRegistry(),
        providerRuntime: providerRuntimeSnapshot,
      });

      chat = new ChatSession(view, mockContentGenerator, {}, []);

      const stream = await chat.sendMessageStream(
        { message: [{ text: 'What is the weather?' }] },
        'test-prompt-id',
      );

      for await (const _event of stream) {
        // Consume stream
      }

      await historyService.waitForTokenUpdates();

      const actualCount = historyService.getTotalTokens();
      expect(actualCount).toBe(6500);
    });
  });

  describe('Edge Cases', () => {
    it('should handle API response with zero input tokens', async () => {
      runtimeState = createAgentRuntimeState({
        runtimeId: runtimeSetup.runtime.runtimeId,
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        sessionId: 'test-session-id',
      });

      const view = createAgentRuntimeContext({
        state: runtimeState,
        history: historyService,
        settings: {
          compressionThreshold: 0.8,
          contextLimit: 200000,
          preserveThreshold: 0.2,
          telemetry: { enabled: true, target: null },
        },
        provider: createProviderAdapterFromManager(
          mockConfig.getProviderManager(),
        ),
        telemetry: createTelemetryAdapterFromConfig(mockConfig),
        tools: createToolRegistryViewFromRegistry(),
        providerRuntime: providerRuntimeSnapshot,
      });

      const mockProvider = {
        name: 'anthropic',
        generateChatCompletion: vi.fn().mockImplementation(async function* () {
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'Empty response' }],
          };
          yield {
            speaker: 'ai',
            blocks: [],
            metadata: {
              usage: {
                promptTokens: 0,
                completionTokens: 10,
                totalTokens: 10,
              },
            },
          };
        }),
      };

      const providerManager = {
        getActiveProvider: vi.fn(() => mockProvider),
      };

      mockConfig.getProviderManager = vi.fn().mockReturnValue(providerManager);

      chat = new ChatSession(view, mockContentGenerator, {}, []);

      const stream = await chat.sendMessageStream(
        { message: [{ text: '' }] },
        'test-prompt-id',
      );

      for await (const _event of stream) {
        // Consume
      }

      await historyService.waitForTokenUpdates();

      // Zero prompt tokens are treated as missing usage; estimates remain
      const actualCount = historyService.getTotalTokens();
      expect(actualCount).toBeGreaterThan(0);
    });

    it('should retain estimated tokens if API response lacks usage metadata', async () => {
      runtimeState = createAgentRuntimeState({
        runtimeId: runtimeSetup.runtime.runtimeId,
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        sessionId: 'test-session-id',
      });

      historyService.add(
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Test' }],
        },
        'claude-3-5-sonnet-20241022',
      );
      await historyService.waitForTokenUpdates();

      const estimatedCountBeforeAI = historyService.getTotalTokens();
      expect(estimatedCountBeforeAI).toBeGreaterThan(0);

      const view = createAgentRuntimeContext({
        state: runtimeState,
        history: historyService,
        settings: {
          compressionThreshold: 0.8,
          contextLimit: 200000,
          preserveThreshold: 0.2,
          telemetry: { enabled: true, target: null },
        },
        provider: createProviderAdapterFromManager(
          mockConfig.getProviderManager(),
        ),
        telemetry: createTelemetryAdapterFromConfig(mockConfig),
        tools: createToolRegistryViewFromRegistry(),
        providerRuntime: providerRuntimeSnapshot,
      });

      const mockProvider = {
        name: 'anthropic',
        generateChatCompletion: vi.fn().mockImplementation(async function* () {
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'Response text' }],
          };
          // No usage metadata chunk
        }),
      };

      const providerManager = {
        getActiveProvider: vi.fn(() => mockProvider),
      };

      mockConfig.getProviderManager = vi.fn().mockReturnValue(providerManager);

      chat = new ChatSession(view, mockContentGenerator, {}, []);

      const stream = await chat.sendMessageStream(
        { message: [{ text: 'Test' }] },
        'test-prompt-id',
      );

      for await (const _event of stream) {
        // Consume
      }

      await historyService.waitForTokenUpdates();

      const finalCount = historyService.getTotalTokens();
      expect(finalCount).toBeGreaterThan(estimatedCountBeforeAI);
    });
  });
});
