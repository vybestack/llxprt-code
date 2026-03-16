import { describe, it, expect, beforeEach } from 'vitest';
import type { IContent } from '../services/history/IContent.js';
import type { ThinkingBlock } from '../services/history/blocks/ThinkingBlock.js';
import { GeminiChat } from './geminiChat.js';
import { HistoryService } from '../services/history/HistoryService.js';
import { Config } from '../config/config.js';
import { SettingsService } from '../settings/SettingsService.js';
import { ProviderManager } from '../providers/ProviderManager.js';
import { createProviderRuntimeContext } from '../runtime/providerRuntimeContext.js';
import { createAgentRuntimeState } from '../runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '../runtime/createAgentRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapterFromConfig,
  createToolRegistryViewFromRegistry,
} from '../runtime/runtimeAdapters.js';
import type { ContentGenerator } from './contentGenerator.js';

describe('Issue 1729: Claude stopping after thinking block', () => {
  let geminiChat: GeminiChat;

  beforeEach(() => {
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
      metadata: { source: 'geminiChat.issue1729.test' },
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
        telemetry: {
          enabled: true,
          target: null,
        },
        'reasoning.includeInContext': true,
      },
      provider: createProviderAdapterFromManager(config.getProviderManager()),
      telemetry: createTelemetryAdapterFromConfig(config),
      tools: createToolRegistryViewFromRegistry(config.getToolRegistry()),
      providerRuntime: { ...providerRuntime },
    });

    geminiChat = new GeminiChat(
      view,
      {} as unknown as ContentGenerator,
      {},
      [],
    );
  });

  describe('Phase 1: finishReason propagation from Anthropic', () => {
    it('should set finishReason on candidate from IContent metadata stopReason end_turn', () => {
      const thinkingBlock: ThinkingBlock = {
        type: 'thinking',
        thought: 'Let me analyze this problem...',
      };

      const icontent: IContent = {
        speaker: 'ai',
        blocks: [thinkingBlock],
        metadata: {
          stopReason: 'end_turn',
        },
      };

      const response = geminiChat.convertIContentToResponse(icontent);

      expect(response.candidates).toBeDefined();
      expect(response.candidates.length).toBe(1);
      expect(response.candidates[0].finishReason).toBe('STOP');
    });

    it('should set finishReason MAX_TOKENS for max_tokens stopReason', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Some text' }],
        metadata: {
          stopReason: 'max_tokens',
        },
      };

      const response = geminiChat.convertIContentToResponse(icontent);
      expect(response.candidates[0].finishReason).toBe('MAX_TOKENS');
    });

    it('should set finishReason STOP for stop_sequence stopReason', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Some text' }],
        metadata: {
          stopReason: 'stop_sequence',
        },
      };

      const response = geminiChat.convertIContentToResponse(icontent);
      expect(response.candidates[0].finishReason).toBe('STOP');
    });

    it('should set finishReason STOP for tool_use stopReason', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Some text' }],
        metadata: {
          stopReason: 'tool_use',
        },
      };

      const response = geminiChat.convertIContentToResponse(icontent);
      expect(response.candidates[0].finishReason).toBe('STOP');
    });

    it('should not set finishReason when metadata has no stopReason', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Some text' }],
        metadata: {},
      };

      const response = geminiChat.convertIContentToResponse(icontent);
      expect(response.candidates[0].finishReason).toBeUndefined();
    });
  });

  describe('Phase 2: Fix thought-text contamination', () => {
    it('should return empty string from text getter for thinking-only IContent', () => {
      const thinkingBlock: ThinkingBlock = {
        type: 'thinking',
        thought: 'Let me think about this...',
      };

      const icontent: IContent = {
        speaker: 'ai',
        blocks: [thinkingBlock],
        metadata: {},
      };

      const response = geminiChat.convertIContentToResponse(icontent);
      expect(response.text).toBe('');
    });

    it('should return actual text, not thinking text, for mixed content', () => {
      const thinkingBlock: ThinkingBlock = {
        type: 'thinking',
        thought: 'Let me think about this...',
      };

      const icontent: IContent = {
        speaker: 'ai',
        blocks: [
          thinkingBlock,
          { type: 'text', text: 'Ok now I will proceed.' },
        ],
        metadata: {},
      };

      const response = geminiChat.convertIContentToResponse(icontent);
      expect(response.text).toBe('Ok now I will proceed.');
    });

    it('should return text for text-only content without thinking', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Hello world' }],
        metadata: {},
      };

      const response = geminiChat.convertIContentToResponse(icontent);
      expect(response.text).toBe('Hello world');
    });

    it('should concatenate multiple visible text blocks', () => {
      const thinkingBlock: ThinkingBlock = {
        type: 'thinking',
        thought: 'Let me think...',
      };

      const icontent: IContent = {
        speaker: 'ai',
        blocks: [
          thinkingBlock,
          { type: 'text', text: 'First part. ' },
          { type: 'text', text: 'Second part.' },
        ],
        metadata: {},
      };

      const response = geminiChat.convertIContentToResponse(icontent);
      expect(response.text).toBe('First part. Second part.');
    });
  });

  describe('stopReason mapping completeness', () => {
    it('should map model_context_window_exceeded to MAX_TOKENS', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'truncated' }],
        metadata: { stopReason: 'model_context_window_exceeded' },
      };

      const response = geminiChat.convertIContentToResponse(icontent);
      expect(response.candidates[0].finishReason).toBe('MAX_TOKENS');
    });

    it('should map pause_turn to STOP', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'paused' }],
        metadata: { stopReason: 'pause_turn' },
      };

      const response = geminiChat.convertIContentToResponse(icontent);
      expect(response.candidates[0].finishReason).toBe('STOP');
    });

    it('should map refusal to STOP', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'refused' }],
        metadata: { stopReason: 'refusal' },
      };

      const response = geminiChat.convertIContentToResponse(icontent);
      expect(response.candidates[0].finishReason).toBe('STOP');
    });

    it('should not set finishReason for unknown stop reasons', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'text' }],
        metadata: { stopReason: 'some_future_reason' },
      };

      const response = geminiChat.convertIContentToResponse(icontent);
      expect(response.candidates[0].finishReason).toBeUndefined();
    });
  });
});
