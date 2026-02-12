/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiChat } from './geminiChat.js';
import { Config } from '../config/config.js';
import { createGeminiChatRuntime } from '../test-utils/runtime.js';
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

/**
 * Tests for Token Count Synchronization from API Usage Metadata
 *
 * These tests verify the BEHAVIOR that after receiving API responses with usage metadata,
 * the HistoryService's token count reflects the actual API count, not accumulated estimates.
 *
 * What we test: Observable outputs (getTotalTokens())
 * What we DON'T test: Internal method calls like syncTotalTokens()
 *
 * Expected Behavior:
 * 1. After streaming response completes, historyService.getTotalTokens() returns actual API count
 * 2. Works for Anthropic (input_tokens), Gemini (promptTokenCount), and OpenAI (prompt_tokens) formats
 * 3. Handles higher/lower counts than estimates
 * 4. Handles multiple consecutive API calls
 * 5. Handles edge cases (zero tokens, missing metadata)
 */
describe('GeminiChat Token Count Sync - API Usage Metadata', () => {
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
  let historyService: HistoryService;

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
        getModel: vi.fn().mockReturnValue('gemini-pro'),
        setModel: vi.fn(),
        getQuotaErrorOccurred: vi.fn().mockReturnValue(false),
        setQuotaErrorOccurred: vi.fn(),
        getEphemeralSettings: vi.fn().mockReturnValue({}),
        getEphemeralSetting: vi.fn().mockReturnValue(undefined),
        getProviderManager: vi.fn().mockReturnValue(providerManager),
      },
    });

    mockConfig = runtimeSetup.config;

    providerRuntimeSnapshot = {
      ...runtimeSetup.runtime,
      config: mockConfig,
    };
    providerRuntime.setActiveProviderRuntimeContext(providerRuntimeSnapshot);

    mockContentGenerator = {
      generateContent: vi.fn(),
      generateContentStream: vi.fn(),
      countTokens: vi.fn().mockReturnValue(100),
      embedContent: vi.fn(),
    };

    // Create a fresh HistoryService for each test
    historyService = new HistoryService();
  });

  describe('Anthropic Provider - input_tokens', () => {
    it('should include cached prompt tokens from API usage after streaming response', async () => {
      // Arrange
      runtimeState = createAgentRuntimeState({
        runtimeId: runtimeSetup.runtime.runtimeId,
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        sessionId: 'test-session-id',
      });

      // Add user message to history - creates estimated token count
      historyService.add(
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'What is 2+2?' }],
        },
        'claude-3-5-sonnet-20241022',
      );
      await historyService.waitForTokenUpdates();

      // Mock streaming response with usage metadata (Anthropic format)
      // Need to update the provider's generateChatCompletion, not the contentGenerator
      const mockProvider = {
        name: 'anthropic',
        generateChatCompletion: vi.fn().mockImplementation(async function* () {
          // Yield text chunk
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'The answer is 4.' }],
          };

          // Yield usage metadata chunk (Anthropic format: promptTokens)
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
          mockConfig.getProviderManager?.(),
        ),
        telemetry: createTelemetryAdapterFromConfig(mockConfig as Config),
        tools: createToolRegistryViewFromRegistry(
          mockConfig.getToolRegistry?.(),
        ),
        providerRuntime: providerRuntimeSnapshot,
      });

      chat = new GeminiChat(view, mockContentGenerator, {}, []);

      // Act: Send message which triggers streaming response
      const stream = await chat.sendMessageStream(
        { message: [{ text: 'What is 2+2?' }] },
        'test-prompt-id',
      );

      // Consume the stream
      const events = [];
      for await (const event of stream) {
        events.push(event);
      }

      // Wait for any token updates to complete
      await historyService.waitForTokenUpdates();

      // Assert: getTotalTokens() should now reflect the actual API prompt count (5000)
      const actualCount = historyService.getTotalTokens();
      expect(actualCount).toBe(19573);
    });

    it('should sync tokens when API reports higher count than estimate', async () => {
      // Arrange
      runtimeState = createAgentRuntimeState({
        runtimeId: runtimeSetup.runtime.runtimeId,
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        sessionId: 'test-session-id',
      });

      // Simulate history with small estimated count
      historyService.add(
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hi' }],
        },
        'claude-3-5-sonnet-20241022',
      );
      await historyService.waitForTokenUpdates();

      // API reports much higher count due to system prompts, tools, etc.
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
                promptTokens: 12500, // Much higher than estimate
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
          mockConfig.getProviderManager?.(),
        ),
        telemetry: createTelemetryAdapterFromConfig(mockConfig as Config),
        tools: createToolRegistryViewFromRegistry(
          mockConfig.getToolRegistry?.(),
        ),
        providerRuntime: providerRuntimeSnapshot,
      });

      chat = new GeminiChat(view, mockContentGenerator, {}, []);

      // Act
      const stream = await chat.sendMessageStream(
        { message: [{ text: 'Hi' }] },
        'test-prompt-id',
      );

      for await (const _event of stream) {
        // Consume stream
      }

      await historyService.waitForTokenUpdates();

      // Assert: Should use API's actual prompt token count
      const actualCount = historyService.getTotalTokens();
      expect(actualCount).toBe(12500);
    });

    it('should sync tokens with actual API count', async () => {
      // Arrange
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

      // API reports actual token count
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
          mockConfig.getProviderManager?.(),
        ),
        telemetry: createTelemetryAdapterFromConfig(mockConfig as Config),
        tools: createToolRegistryViewFromRegistry(
          mockConfig.getToolRegistry?.(),
        ),
        providerRuntime: providerRuntimeSnapshot,
      });

      chat = new GeminiChat(view, mockContentGenerator, {}, []);

      // Act
      const stream = await chat.sendMessageStream(
        { message: [{ text: 'Test' }] },
        'test-prompt-id',
      );

      for await (const _event of stream) {
        // Consume stream
      }

      await historyService.waitForTokenUpdates();

      // Assert: Should use API's actual prompt token count
      const actualCount = historyService.getTotalTokens();
      expect(actualCount).toBe(4500);
    });
  });

  describe('Gemini Provider - promptTokenCount', () => {
    it('should update total tokens from Gemini usage metadata', async () => {
      // Arrange
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

      // Mock OpenAI streaming response with usage metadata
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

          // OpenAI format: usage with promptTokens
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
          mockConfig.getProviderManager?.(),
        ),
        telemetry: createTelemetryAdapterFromConfig(mockConfig as Config),
        tools: createToolRegistryViewFromRegistry(
          mockConfig.getToolRegistry?.(),
        ),
        providerRuntime: providerRuntimeSnapshot,
      });

      chat = new GeminiChat(view, mockContentGenerator, {}, []);

      // Act
      const stream = await chat.sendMessageStream(
        { message: [{ text: 'What is the weather?' }] },
        'test-prompt-id',
      );

      for await (const _event of stream) {
        // Consume stream
      }

      await historyService.waitForTokenUpdates();

      // Assert: Should reflect OpenAI's actual prompt token count
      const actualCount = historyService.getTotalTokens();
      expect(actualCount).toBe(6500);
    });
  });

  describe('Edge Cases', () => {
    it('should handle API response with zero input tokens', async () => {
      // Arrange
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
          mockConfig.getProviderManager?.(),
        ),
        telemetry: createTelemetryAdapterFromConfig(mockConfig as Config),
        tools: createToolRegistryViewFromRegistry(
          mockConfig.getToolRegistry?.(),
        ),
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

      chat = new GeminiChat(view, mockContentGenerator, {}, []);

      // Act
      const stream = await chat.sendMessageStream(
        { message: [{ text: '' }] },
        'test-prompt-id',
      );

      for await (const _event of stream) {
        // Consume
      }

      await historyService.waitForTokenUpdates();

      // Assert: Zero prompt tokens are treated as missing usage; estimates remain
      const actualCount = historyService.getTotalTokens();
      expect(actualCount).toBeGreaterThan(0);
    });

    it('should retain estimated tokens if API response lacks usage metadata', async () => {
      // Arrange
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
          mockConfig.getProviderManager?.(),
        ),
        telemetry: createTelemetryAdapterFromConfig(mockConfig as Config),
        tools: createToolRegistryViewFromRegistry(
          mockConfig.getToolRegistry?.(),
        ),
        providerRuntime: providerRuntimeSnapshot,
      });

      // Response without usage metadata
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

      chat = new GeminiChat(view, mockContentGenerator, {}, []);

      // Act
      const stream = await chat.sendMessageStream(
        { message: [{ text: 'Test' }] },
        'test-prompt-id',
      );

      for await (const _event of stream) {
        // Consume
      }

      await historyService.waitForTokenUpdates();

      // Assert: Should have initial estimate plus AI response tokens (no sync occurred)
      const finalCount = historyService.getTotalTokens();
      expect(finalCount).toBeGreaterThan(estimatedCountBeforeAI);
    });
  });

  describe('Non-streaming responses', () => {
    describe('Gemini Provider - usageMetadata', () => {
      it('should update total tokens from Gemini non-streaming response', async () => {
        // Arrange
        runtimeState = createAgentRuntimeState({
          runtimeId: runtimeSetup.runtime.runtimeId,
          provider: 'gemini',
          model: 'gemini-pro',
          sessionId: 'test-session-id',
        });

        historyService.add(
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'What is quantum computing?' }],
          },
          'gemini-pro',
        );
        await historyService.waitForTokenUpdates();

        const estimatedCount = historyService.getTotalTokens();
        expect(estimatedCount).toBeGreaterThan(0);

        // Mock Gemini non-streaming response with usageMetadata
        const mockProvider = {
          name: 'gemini',
          generateChatCompletion: vi
            .fn()
            .mockImplementation(async function* () {
              // Yield the final IContent with usage metadata from Gemini format
              yield {
                speaker: 'ai',
                blocks: [
                  {
                    type: 'text',
                    text: 'Quantum computing uses quantum mechanics...',
                  },
                ],
                metadata: {
                  usage: {
                    promptTokens: 5000,
                    completionTokens: 100,
                    totalTokens: 5100,
                  },
                },
              };
            }),
        };

        const providerManager = {
          getActiveProvider: vi.fn(() => mockProvider),
        };

        // Update config to use our mock provider
        mockConfig.getProviderManager = vi
          .fn()
          .mockReturnValue(providerManager);

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
            mockConfig.getProviderManager?.(),
          ),
          telemetry: createTelemetryAdapterFromConfig(mockConfig as Config),
          tools: createToolRegistryViewFromRegistry(
            mockConfig.getToolRegistry?.(),
          ),
          providerRuntime: providerRuntimeSnapshot,
        });

        chat = new GeminiChat(view, mockContentGenerator, {}, []);

        // Act: Send non-streaming message
        await chat.sendMessage(
          { message: [{ text: 'What is quantum computing?' }] },
          'test-prompt-id',
        );

        // Wait for history updates
        await historyService.waitForTokenUpdates();

        // Assert: getTotalTokens() should return the actual promptTokenCount (5000)
        const actualCount = historyService.getTotalTokens();
        expect(actualCount).toBe(5000);
      });
    });

    describe('Anthropic Provider - promptTokens from metadata', () => {
      it('should update total tokens from Anthropic non-streaming response', async () => {
        // Arrange
        runtimeState = createAgentRuntimeState({
          runtimeId: runtimeSetup.runtime.runtimeId,
          provider: 'anthropic',
          model: 'claude-3-5-sonnet-20241022',
          sessionId: 'test-session-id',
        });

        historyService.add(
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Explain AI safety' }],
          },
          'claude-3-5-sonnet-20241022',
        );
        await historyService.waitForTokenUpdates();

        const estimatedCount = historyService.getTotalTokens();
        expect(estimatedCount).toBeGreaterThan(0);

        // Mock Anthropic non-streaming response with usage in metadata
        const mockProvider = {
          name: 'anthropic',
          generateChatCompletion: vi
            .fn()
            .mockImplementation(async function* () {
              // Yield final IContent with Anthropic usage format
              yield {
                speaker: 'ai',
                blocks: [
                  {
                    type: 'text',
                    text: 'AI safety involves...',
                  },
                ],
                metadata: {
                  usage: {
                    promptTokens: 5000,
                    completionTokens: 80,
                    totalTokens: 5080,
                  },
                },
              };
            }),
        };

        const providerManager = {
          getActiveProvider: vi.fn(() => mockProvider),
        };

        mockConfig.getProviderManager = vi
          .fn()
          .mockReturnValue(providerManager);

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
            mockConfig.getProviderManager?.(),
          ),
          telemetry: createTelemetryAdapterFromConfig(mockConfig as Config),
          tools: createToolRegistryViewFromRegistry(
            mockConfig.getToolRegistry?.(),
          ),
          providerRuntime: providerRuntimeSnapshot,
        });

        chat = new GeminiChat(view, mockContentGenerator, {}, []);

        // Act: Send non-streaming message
        await chat.sendMessage(
          { message: [{ text: 'Explain AI safety' }] },
          'test-prompt-id',
        );

        // Wait for history updates
        await historyService.waitForTokenUpdates();

        // Assert: getTotalTokens() should return the actual promptTokens (5000)
        const actualCount = historyService.getTotalTokens();
        expect(actualCount).toBe(5000);
      });
    });

    describe('OpenAI Provider - promptTokens from metadata', () => {
      it('should update total tokens from OpenAI non-streaming response', async () => {
        // Arrange
        runtimeState = createAgentRuntimeState({
          runtimeId: runtimeSetup.runtime.runtimeId,
          provider: 'openai',
          model: 'gpt-4',
          sessionId: 'test-session-id',
        });

        historyService.add(
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'What is machine learning?' }],
          },
          'gpt-4',
        );
        await historyService.waitForTokenUpdates();

        const estimatedCount = historyService.getTotalTokens();
        expect(estimatedCount).toBeGreaterThan(0);

        // Mock OpenAI non-streaming response with usage in metadata
        const mockProvider = {
          name: 'openai',
          generateChatCompletion: vi
            .fn()
            .mockImplementation(async function* () {
              // Yield final IContent with OpenAI usage format
              yield {
                speaker: 'ai',
                blocks: [
                  {
                    type: 'text',
                    text: 'Machine learning is...',
                  },
                ],
                metadata: {
                  usage: {
                    promptTokens: 5000,
                    completionTokens: 90,
                    totalTokens: 5090,
                  },
                },
              };
            }),
        };

        const providerManager = {
          getActiveProvider: vi.fn(() => mockProvider),
        };

        mockConfig.getProviderManager = vi
          .fn()
          .mockReturnValue(providerManager);

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
            mockConfig.getProviderManager?.(),
          ),
          telemetry: createTelemetryAdapterFromConfig(mockConfig as Config),
          tools: createToolRegistryViewFromRegistry(
            mockConfig.getToolRegistry?.(),
          ),
          providerRuntime: providerRuntimeSnapshot,
        });

        chat = new GeminiChat(view, mockContentGenerator, {}, []);

        // Act: Send non-streaming message
        await chat.sendMessage(
          { message: [{ text: 'What is machine learning?' }] },
          'test-prompt-id',
        );

        // Wait for history updates
        await historyService.waitForTokenUpdates();

        // Assert: getTotalTokens() should return the actual promptTokens (5000)
        const actualCount = historyService.getTotalTokens();
        expect(actualCount).toBe(5000);
      });
    });

    describe('Edge Cases - Non-streaming', () => {
      it('should retain estimated tokens if non-streaming response lacks usage metadata', async () => {
        // Arrange
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
            mockConfig.getProviderManager?.(),
          ),
          telemetry: createTelemetryAdapterFromConfig(mockConfig as Config),
          tools: createToolRegistryViewFromRegistry(
            mockConfig.getToolRegistry?.(),
          ),
          providerRuntime: providerRuntimeSnapshot,
        });

        // Mock non-streaming response WITHOUT usage metadata
        const mockProvider = {
          name: 'anthropic',
          generateChatCompletion: vi
            .fn()
            .mockImplementation(async function* () {
              yield {
                speaker: 'ai',
                blocks: [{ type: 'text', text: 'Response text' }],
                // No metadata.usage field
              };
            }),
        };

        const providerManager = {
          getActiveProvider: vi.fn(() => mockProvider),
        };

        mockConfig.getProviderManager = vi
          .fn()
          .mockReturnValue(providerManager);

        chat = new GeminiChat(view, mockContentGenerator, {}, []);

        // Act
        await chat.sendMessage(
          { message: [{ text: 'Test' }] },
          'test-prompt-id',
        );

        await historyService.waitForTokenUpdates();

        // Assert: Should have initial estimate plus AI response tokens (no sync occurred)
        const finalCount = historyService.getTotalTokens();
        expect(finalCount).toBeGreaterThan(estimatedCountBeforeAI);
      });

      it('should handle non-streaming response with zero prompt tokens', async () => {
        // Arrange
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
            mockConfig.getProviderManager?.(),
          ),
          telemetry: createTelemetryAdapterFromConfig(mockConfig as Config),
          tools: createToolRegistryViewFromRegistry(
            mockConfig.getToolRegistry?.(),
          ),
          providerRuntime: providerRuntimeSnapshot,
        });

        // Mock non-streaming response WITH zero promptTokens
        const mockProvider = {
          name: 'anthropic',
          generateChatCompletion: vi
            .fn()
            .mockImplementation(async function* () {
              yield {
                speaker: 'ai',
                blocks: [{ type: 'text', text: 'Empty response' }],
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

        mockConfig.getProviderManager = vi
          .fn()
          .mockReturnValue(providerManager);

        chat = new GeminiChat(view, mockContentGenerator, {}, []);

        // Act
        await chat.sendMessage({ message: [{ text: '' }] }, 'test-prompt-id');

        await historyService.waitForTokenUpdates();

        // Assert: Zero prompt tokens are treated as missing usage; estimates remain
        const actualCount = historyService.getTotalTokens();
        expect(actualCount).toBeGreaterThan(0);
      });
    });
  });
});
