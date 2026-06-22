/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for Token Count Synchronization from API Usage Metadata
 * (non-streaming responses). Sibling to chatSession.tokenSync.test.ts.
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

describe('ChatSession Token Count Sync - Non-streaming responses', () => {
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

  describe('Gemini Provider - usageMetadata', () => {
    it('should update total tokens from Gemini non-streaming response', async () => {
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

      const mockProvider = {
        name: 'gemini',
        generateChatCompletion: vi.fn().mockImplementation(async function* () {
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

      await chat.sendMessage(
        { message: [{ text: 'What is quantum computing?' }] },
        'test-prompt-id',
      );

      await historyService.waitForTokenUpdates();

      const actualCount = historyService.getTotalTokens();
      expect(actualCount).toBe(5000);
    });
  });

  describe('Anthropic Provider - promptTokens from metadata', () => {
    it('should update total tokens from Anthropic non-streaming response', async () => {
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

      const mockProvider = {
        name: 'anthropic',
        generateChatCompletion: vi.fn().mockImplementation(async function* () {
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

      await chat.sendMessage(
        { message: [{ text: 'Explain AI safety' }] },
        'test-prompt-id',
      );

      await historyService.waitForTokenUpdates();

      const actualCount = historyService.getTotalTokens();
      expect(actualCount).toBe(5000);
    });
  });

  describe('OpenAI Provider - promptTokens from metadata', () => {
    it('should update total tokens from OpenAI non-streaming response', async () => {
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

      const mockProvider = {
        name: 'openai',
        generateChatCompletion: vi.fn().mockImplementation(async function* () {
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

      await chat.sendMessage(
        { message: [{ text: 'What is machine learning?' }] },
        'test-prompt-id',
      );

      await historyService.waitForTokenUpdates();

      const actualCount = historyService.getTotalTokens();
      expect(actualCount).toBe(5000);
    });
  });

  describe('Edge Cases - Non-streaming', () => {
    it('should retain estimated tokens if non-streaming response lacks usage metadata', async () => {
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

      // Mock non-streaming response WITHOUT usage metadata
      const mockProvider = {
        name: 'anthropic',
        generateChatCompletion: vi.fn().mockImplementation(async function* () {
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

      mockConfig.getProviderManager = vi.fn().mockReturnValue(providerManager);

      chat = new ChatSession(view, mockContentGenerator, {}, []);

      await chat.sendMessage({ message: [{ text: 'Test' }] }, 'test-prompt-id');

      await historyService.waitForTokenUpdates();

      const finalCount = historyService.getTotalTokens();
      expect(finalCount).toBeGreaterThan(estimatedCountBeforeAI);
    });

    it('should handle non-streaming response with zero prompt tokens', async () => {
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

      // Mock non-streaming response WITH zero promptTokens
      const mockProvider = {
        name: 'anthropic',
        generateChatCompletion: vi.fn().mockImplementation(async function* () {
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

      mockConfig.getProviderManager = vi.fn().mockReturnValue(providerManager);

      chat = new ChatSession(view, mockContentGenerator, {}, []);

      await chat.sendMessage({ message: [{ text: '' }] }, 'test-prompt-id');

      await historyService.waitForTokenUpdates();

      // Zero prompt tokens are treated as missing usage; estimates remain
      const actualCount = historyService.getTotalTokens();
      expect(actualCount).toBeGreaterThan(0);
    });
  });
});
