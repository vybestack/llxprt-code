/**
 * @issue #1837
 * Behavioral tests for stopReason propagation in OpenAI streaming and non-streaming responses.
 *
 * The OpenAI provider must set stopReason in IContent metadata so that
 * MessageConverter.convertIContentToResponse() can map it to finishReason,
 * which turn.ts uses to yield the Finished event that ends a turn.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { IContent } from '../../services/history/IContent.js';
import { GeminiChat } from '../../core/geminiChat.js';
import { HistoryService } from '../../services/history/HistoryService.js';
import { Config } from '../../config/config.js';
import { SettingsService } from '../../settings/SettingsService.js';
import { ProviderManager } from '../ProviderManager.js';
import {
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '../../runtime/providerRuntimeContext.js';
import { createAgentRuntimeState } from '../../runtime/AgentRuntimeState.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapterFromConfig,
  createToolRegistryViewFromRegistry,
} from '../../runtime/runtimeAdapters.js';
import { createAgentRuntimeContext } from '../../runtime/createAgentRuntimeContext.js';
import type { ContentGenerator } from '../../core/contentGenerator.js';

function createGeminiChat(): GeminiChat {
  const settingsService = new SettingsService();
  const config = new Config({
    cwd: '/tmp',
    targetDir: '/tmp/project',
    debugMode: false,
    question: undefined,
    userMemory: '',
    embeddingModel: 'gemini-embedding',
    sandbox: undefined,
    sessionId: 'test-session',
    model: 'gemini-1.5-pro',
    settingsService,
  });

  const providerRuntime = createProviderRuntimeContext({
    settingsService,
    config,
    runtimeId: 'test.runtime',
    metadata: { source: 'OpenAIStreamProcessor.stopReason.test' },
  });

  const manager = new ProviderManager(providerRuntime);
  manager.setConfig(config);
  config.setProviderManager(manager);

  const runtimeState = createAgentRuntimeState({
    runtimeId: 'runtime-test',
    provider: 'stub',
    model: config.getModel(),
    sessionId: config.getSessionId(),
  });

  const historyService = new HistoryService();
  const view = createAgentRuntimeContext({
    state: runtimeState,
    history: historyService,
    settings: {
      compressionThreshold: 0.8,
      contextLimit: 128000,
      preserveThreshold: 0.2,
      telemetry: { enabled: true, target: null },
      'reasoning.includeInContext': true,
    },
    provider: createProviderAdapterFromManager(config.getProviderManager()),
    telemetry: createTelemetryAdapterFromConfig(config),
    tools: createToolRegistryViewFromRegistry(config.getToolRegistry()),
    providerRuntime: { ...providerRuntime },
  });

  return new GeminiChat(view, {} as unknown as ContentGenerator, {}, []);
}

describe('Issue #1837: OpenAI provider stopReason propagation', () => {
  let geminiChat: GeminiChat;

  beforeEach(() => {
    setActiveProviderRuntimeContext(
      createProviderRuntimeContext({
        settingsService: new SettingsService(),
        runtimeId: 'openai-stopreason-test',
      }),
    );
    geminiChat = createGeminiChat();
  });

  describe('Streaming: OpenAI stopReason mapped from finish_reason', () => {
    it('should propagate stop (mapped to end_turn) through to finishReason STOP', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Hello world' }],
        metadata: {
          usage: {
            promptTokens: 10,
            completionTokens: 5,
            totalTokens: 15,
          },
          stopReason: 'end_turn',
        },
      };

      const response = geminiChat.convertIContentToResponse(icontent);
      expect(response.candidates).toBeDefined();
      expect(response.candidates.length).toBe(1);
      expect(response.candidates[0].finishReason).toBe('STOP');
    });

    it('should propagate length (mapped to max_tokens) through to finishReason MAX_TOKENS', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Truncated response...' }],
        metadata: {
          usage: {
            promptTokens: 10,
            completionTokens: 100,
            totalTokens: 110,
          },
          stopReason: 'max_tokens',
        },
      };

      const response = geminiChat.convertIContentToResponse(icontent);
      expect(response.candidates[0].finishReason).toBe('MAX_TOKENS');
    });

    it('should propagate tool_calls (mapped to tool_use) through to finishReason STOP', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call_123',
            name: 'read_file',
            parameters: { path: '/tmp/test.txt' },
          },
        ],
        metadata: {
          usage: {
            promptTokens: 10,
            completionTokens: 20,
            totalTokens: 30,
          },
          stopReason: 'tool_use',
        },
      };

      const response = geminiChat.convertIContentToResponse(icontent);
      expect(response.candidates[0].finishReason).toBe('STOP');
    });

    it('should propagate end_turn stopReason through to finishReason STOP (no usage)', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Filtered content' }],
        metadata: {
          stopReason: 'end_turn',
        },
      };

      const response = geminiChat.convertIContentToResponse(icontent);
      expect(response.candidates[0].finishReason).toBe('STOP');
    });
  });

  describe('Non-streaming: stopReason from finish_reason', () => {
    it('should include stopReason in metadata for non-streaming stop response', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Complete response' }],
        metadata: {
          usage: {
            promptTokens: 5,
            completionTokens: 10,
            totalTokens: 15,
          },
          stopReason: 'end_turn',
        },
      };

      const response = geminiChat.convertIContentToResponse(icontent);
      expect(response.candidates[0].finishReason).toBe('STOP');
      expect(response.usageMetadata?.totalTokenCount).toBe(15);
    });

    it('should set finishReason for length-truncated non-streaming response', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Truncated' }],
        metadata: {
          stopReason: 'max_tokens',
        },
      };

      const response = geminiChat.convertIContentToResponse(icontent);
      expect(response.candidates[0].finishReason).toBe('MAX_TOKENS');
    });
  });

  describe('Thinking + text: stopReason still propagates', () => {
    it('should propagate stopReason when response has thinking blocks', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'Let me think about this...',
            sourceField: 'reasoning_content',
            isHidden: false,
          },
          { type: 'text', text: 'Here is my answer.' },
        ],
        metadata: {
          usage: {
            promptTokens: 50,
            completionTokens: 100,
            totalTokens: 150,
          },
          stopReason: 'end_turn',
        },
      };

      const response = geminiChat.convertIContentToResponse(icontent);
      expect(response.candidates[0].finishReason).toBe('STOP');
      expect(response.text).toBe('Here is my answer.');
    });

    it('should propagate stopReason for thinking-only response', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'Deep reasoning here...',
            sourceField: 'reasoning_content',
            isHidden: false,
          },
        ],
        metadata: {
          stopReason: 'end_turn',
        },
      };

      const response = geminiChat.convertIContentToResponse(icontent);
      expect(response.candidates[0].finishReason).toBe('STOP');
    });
  });

  describe('Edge cases', () => {
    it('should not set finishReason when no stopReason in metadata', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'No stop reason' }],
        metadata: {
          usage: {
            promptTokens: 5,
            completionTokens: 5,
            totalTokens: 10,
          },
        },
      };

      const response = geminiChat.convertIContentToResponse(icontent);
      expect(response.candidates[0].finishReason).toBeUndefined();
    });

    it('should not set finishReason when metadata is empty', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Empty metadata' }],
        metadata: {},
      };

      const response = geminiChat.convertIContentToResponse(icontent);
      expect(response.candidates[0].finishReason).toBeUndefined();
    });

    it('should not set finishReason when metadata is undefined', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'No metadata at all' }],
      };

      const response = geminiChat.convertIContentToResponse(icontent);
      expect(response.candidates[0].finishReason).toBeUndefined();
    });
  });

  describe('OpenAI native finish_reason values in MessageConverter', () => {
    it('should map raw "stop" finish_reason to STOP', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Done' }],
        metadata: { stopReason: 'stop' },
      };

      const response = geminiChat.convertIContentToResponse(icontent);
      expect(response.candidates[0].finishReason).toBe('STOP');
    });

    it('should map raw "length" finish_reason to MAX_TOKENS', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Too long' }],
        metadata: { stopReason: 'length' },
      };

      const response = geminiChat.convertIContentToResponse(icontent);
      expect(response.candidates[0].finishReason).toBe('MAX_TOKENS');
    });

    it('should map raw "tool_calls" finish_reason to STOP', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call_abc',
            name: 'some_tool',
            parameters: {},
          },
        ],
        metadata: { stopReason: 'tool_calls' },
      };

      const response = geminiChat.convertIContentToResponse(icontent);
      expect(response.candidates[0].finishReason).toBe('STOP');
    });

    it('should map raw "content_filter" finish_reason to SAFETY', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Filtered' }],
        metadata: { stopReason: 'content_filter' },
      };

      const response = geminiChat.convertIContentToResponse(icontent);
      expect(response.candidates[0].finishReason).toBe('SAFETY');
    });
  });
});
