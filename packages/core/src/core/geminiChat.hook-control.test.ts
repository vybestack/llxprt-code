/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiChat, StreamEventType } from './geminiChat.js';
import type { HookSystem } from '../hooks/HookSystem.js';
import type { IProvider } from '@vybestack/llxprt-code-providers';
import { createGeminiChatRuntime } from '../test-utils/runtime.js';
import { createAgentRuntimeState } from '../runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '../runtime/createAgentRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapterFromConfig,
  createToolRegistryViewFromRegistry,
} from '../runtime/runtimeAdapters.js';
import { HistoryService } from '../services/history/HistoryService.js';
import * as providerRuntime from '../runtime/providerRuntimeContext.js';

describe('GeminiChat hook execution control', () => {
  let mockHookSystem: HookSystem;
  let mockProvider: IProvider;
  let chat: GeminiChat;
  let mockContentGenerator: {
    generateContent: ReturnType<typeof vi.fn>;
    generateContentStream: ReturnType<typeof vi.fn>;
    countTokens: ReturnType<typeof vi.fn>;
    embedContent: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockHookSystem = {
      trigger: vi.fn(),
      initialize: vi.fn().mockResolvedValue(undefined),
      fireBeforeModelEvent: vi.fn().mockResolvedValue({ finalOutput: {} }),
      fireAfterModelEvent: vi.fn().mockResolvedValue({ finalOutput: {} }),
      fireBeforeToolSelectionEvent: vi
        .fn()
        .mockResolvedValue({ finalOutput: {} }),
    } as unknown as HookSystem;

    mockProvider = {
      name: 'test-provider',
      generateChatCompletion: vi.fn().mockImplementation(async function* () {
        yield {
          role: 'model',
          blocks: [{ type: 'text', text: 'Model response' }],
        };
      }),
      supportsIContent: () => true,
      getDefaultModel: () => 'test-model',
    } as unknown as IProvider;

    const providerManager = {
      getActiveProvider: vi.fn(() => mockProvider),
    };

    const runtimeSetup = createGeminiChatRuntime({
      provider: mockProvider,
      providerManager,
      configOverrides: {
        getHookSystem: vi.fn(() => mockHookSystem),
        getEnableHooks: vi.fn(() => true),
        getModel: vi.fn().mockReturnValue('test-model'),
        setModel: vi.fn(),
        getQuotaErrorOccurred: vi.fn().mockReturnValue(false),
        setQuotaErrorOccurred: vi.fn(),
        getEphemeralSettings: vi.fn().mockReturnValue({}),
        getEphemeralSetting: vi.fn(),
        getProviderManager: vi.fn().mockReturnValue(providerManager),
      },
    });

    const mockConfig = runtimeSetup.config;

    // Set up provider runtime context
    const providerRuntimeSnapshot = {
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

    // Create runtime state and context
    const runtimeState = createAgentRuntimeState({
      runtimeId: runtimeSetup.runtime.runtimeId,
      provider: runtimeSetup.provider.name,
      model: 'test-model',
      sessionId: 'test-session',
    });

    const historyService = new HistoryService();
    const view = createAgentRuntimeContext({
      state: runtimeState,
      history: historyService,
      settings: {
        compressionThreshold: 0.8,
        contextLimit: undefined,
        preserveThreshold: 0.2,
        telemetry: {
          enabled: true,
          target: null,
        },
      },
      provider: createProviderAdapterFromManager(
        mockConfig.getProviderManager?.(),
      ),
      telemetry: createTelemetryAdapterFromConfig(mockConfig),
      tools: createToolRegistryViewFromRegistry(mockConfig.getToolRegistry?.()),
      providerRuntime: providerRuntimeSnapshot,
    });

    chat = new GeminiChat(view, mockContentGenerator, {}, []);
  });

  describe('BeforeModel hook stop', () => {
    it('should emit stopped event and terminate when BeforeModel hook stops execution', async () => {
      // Mock BeforeModel hook to return stop
      (
        mockHookSystem.fireBeforeModelEvent as ReturnType<typeof vi.fn>
      ).mockResolvedValueOnce({
        finalOutput: {
          continue: false,
          stopReason: 'BeforeModel stopped execution',
        },
      });

      const events: Array<{ type: string; reason?: string }> = [];
      const stream = await chat.sendMessageStream(
        { message: 'test message' },
        'test-prompt',
      );

      for await (const event of stream) {
        events.push({
          type: event.type,
          reason: 'reason' in event ? event.reason : undefined,
        });
      }

      expect(events).toHaveLength(1);
      expect(events[0]).toStrictEqual({
        type: StreamEventType.AGENT_EXECUTION_STOPPED,
        reason: 'BeforeModel stopped execution',
      });
    });
  });

  describe('BeforeModel hook block', () => {
    it('should emit blocked event then chunk when BeforeModel hook blocks with synthetic response', async () => {
      (
        mockHookSystem.fireBeforeModelEvent as ReturnType<typeof vi.fn>
      ).mockResolvedValueOnce({
        finalOutput: {
          decision: 'block',
          reason: 'BeforeModel blocked execution',
          hookSpecificOutput: {
            llm_response: {
              candidates: [
                {
                  content: {
                    role: 'model' as const,
                    parts: [{ text: 'Synthetic blocked response' }],
                  },
                  finishReason: 'STOP' as const,
                },
              ],
            },
          },
        },
      });

      const events: Array<{ type: string; reason?: string; value?: unknown }> =
        [];
      const stream = await chat.sendMessageStream(
        { message: 'test message' },
        'test-prompt',
      );

      for await (const event of stream) {
        events.push({
          type: event.type,
          reason: 'reason' in event ? event.reason : undefined,
          value: 'value' in event ? event.value : undefined,
        });
      }

      expect(events).toHaveLength(2);
      expect(events[0]).toStrictEqual({
        type: StreamEventType.AGENT_EXECUTION_BLOCKED,
        reason: 'BeforeModel blocked execution',
        value: undefined,
      });
      expect(events[1].type).toBe(StreamEventType.CHUNK);
      expect(events[1].value).toBeDefined();
    });
  });

  describe('AfterModel hook stop', () => {
    it('should emit stopped event when AfterModel hook stops execution', async () => {
      // Mock provider to return a simple response
      (
        mockProvider.generateChatCompletion as ReturnType<typeof vi.fn>
      ).mockImplementation(async function* () {
        yield {
          role: 'model',
          blocks: [{ type: 'text', text: 'Model response' }],
        };
      });

      // Mock AfterModel hook to return stop
      (
        mockHookSystem.fireAfterModelEvent as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        finalOutput: {
          continue: false,
          stopReason: 'AfterModel stopped execution',
        },
      });

      const events: Array<{ type: string; reason?: string }> = [];
      const stream = await chat.sendMessageStream(
        { message: 'test message' },
        'test-prompt',
      );

      for await (const event of stream) {
        events.push({
          type: event.type,
          reason: 'reason' in event ? event.reason : undefined,
        });
      }

      expect(events).toContainEqual({
        type: StreamEventType.AGENT_EXECUTION_STOPPED,
        reason: 'AfterModel stopped execution',
      });
    });
  });

  describe('AfterModel hook block', () => {
    it('should emit blocked event then chunk when AfterModel hook blocks execution', async () => {
      // Mock provider to return a simple response
      (
        mockProvider.generateChatCompletion as ReturnType<typeof vi.fn>
      ).mockImplementation(async function* () {
        yield {
          role: 'model',
          blocks: [{ type: 'text', text: 'Model response' }],
        };
      });

      // Mock AfterModel hook to return block
      (
        mockHookSystem.fireAfterModelEvent as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        finalOutput: {
          decision: 'block',
          reason: 'AfterModel blocked execution',
        },
      });

      const events: Array<{ type: string; reason?: string; value?: unknown }> =
        [];
      const stream = await chat.sendMessageStream(
        { message: 'test message' },
        'test-prompt',
      );

      for await (const event of stream) {
        events.push({
          type: event.type,
          reason: 'reason' in event ? event.reason : undefined,
          value: 'value' in event ? event.value : undefined,
        });
      }

      // Should have blocked event followed by chunk (current converted response)
      const blockedEvent = events.find(
        (e) => e.type === StreamEventType.AGENT_EXECUTION_BLOCKED,
      );
      expect(blockedEvent).toBeDefined();
      expect(blockedEvent?.reason).toBe('AfterModel blocked execution');

      const chunkEvent = events.find((e) => e.type === StreamEventType.CHUNK);
      expect(chunkEvent).toBeDefined();
    });
  });

  describe('Hook control does not enter retry loop', () => {
    it('should not retry when BeforeModel hook stops execution', async () => {
      let triggerCount = 0;
      (
        mockHookSystem.fireBeforeModelEvent as ReturnType<typeof vi.fn>
      ).mockImplementation(async () => {
        triggerCount++;
        return {
          finalOutput: {
            continue: false,
            stopReason: 'Stop on first attempt',
          },
        };
      });

      const events: Array<{ type: string }> = [];
      const stream = await chat.sendMessageStream(
        { message: 'test message' },
        'test-prompt',
      );

      for await (const event of stream) {
        events.push({ type: event.type });
      }

      // Should only trigger once, no retries
      expect(triggerCount).toBe(1);
      // Should not see RETRY events
      expect(
        events.find((e) => e.type === StreamEventType.RETRY),
      ).toBeUndefined();
    });
  });
});
