/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiChat, StreamEventType } from './geminiChat.js';
import { Config } from '../config/config.js';
import { HookSystem } from '../hooks/HookSystem.js';
import type { IProvider } from '@vybestack/llxprt-code-providers';

describe('GeminiChat hook execution control', () => {
  let mockConfig: Config;
  let mockHookSystem: HookSystem;
  let mockProvider: IProvider;
  let chat: GeminiChat;

  beforeEach(() => {
    mockHookSystem = {
      trigger: vi.fn(),
    } as unknown as HookSystem;

    mockProvider = {
      name: 'test-provider',
      generateChatCompletion: vi.fn(),
      supportsIContent: () => true,
      getDefaultModel: () => 'test-model',
    } as unknown as IProvider;

    mockConfig = {
      getHookSystem: vi.fn(() => mockHookSystem),
      getProviderRegistry: vi.fn(() => ({
        getActiveProvider: vi.fn(() => mockProvider),
      })),
      getModel: vi.fn(() => 'test-model'),
      getSessionId: vi.fn(() => 'test-session'),
      getMaxSessionTurns: vi.fn(() => 100),
      getSettingsService: vi.fn(() => ({
        get: vi.fn(),
      })),
    } as unknown as Config;

    chat = new GeminiChat(mockConfig);
  });

  describe('BeforeModel hook stop', () => {
    it('should emit stopped event and terminate when BeforeModel hook stops execution', async () => {
      // Mock BeforeModel hook to return stop
      mockHookSystem.trigger = vi.fn(async (event) => {
        if (event.event === 'BeforeModel') {
          return {
            stopExecution: true,
            reason: 'BeforeModel stopped execution',
          };
        }
        return {};
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
      expect(events[0]).toEqual({
        type: StreamEventType.AGENT_EXECUTION_STOPPED,
        reason: 'BeforeModel stopped execution',
      });
    });
  });

  describe('BeforeModel hook block', () => {
    it('should emit blocked event then chunk when BeforeModel hook blocks with synthetic response', async () => {
      const syntheticResponse = {
        candidates: [
          {
            content: {
              role: 'model' as const,
              parts: [{ text: 'Synthetic blocked response' }],
            },
            finishReason: 'STOP' as const,
          },
        ],
      };

      mockHookSystem.trigger = vi.fn(async (event) => {
        if (event.event === 'BeforeModel') {
          return {
            blockDecision: true,
            reason: 'BeforeModel blocked execution',
            synthetic_response: syntheticResponse,
          };
        }
        return {};
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
      expect(events[0]).toEqual({
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
      mockHookSystem.trigger = vi.fn(async (event) => {
        if (event.event === 'AfterModel') {
          return {
            stopExecution: true,
            reason: 'AfterModel stopped execution',
          };
        }
        return {};
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
      mockHookSystem.trigger = vi.fn(async (event) => {
        if (event.event === 'AfterModel') {
          return {
            blockDecision: true,
            reason: 'AfterModel blocked execution',
          };
        }
        return {};
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
      mockHookSystem.trigger = vi.fn(async (event) => {
        if (event.event === 'BeforeModel') {
          triggerCount++;
          return {
            stopExecution: true,
            reason: 'Stop on first attempt',
          };
        }
        return {};
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
