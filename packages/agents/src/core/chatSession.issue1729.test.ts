import { describe, it, expect, beforeEach } from 'vitest';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { TextBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ThinkingBlock } from '@vybestack/llxprt-code-core/services/history/blocks/ThinkingBlock.js';
import { ChatSession } from './chatSession.js';
import { toModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { TestRuntimeProviderManager } from '../test-utils/runtimeProviderManager.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapterFromConfig,
  createToolRegistryViewFromRegistry,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';

/**
 * Extracts visible (non-thinking) text from a neutral ModelOutput's content
 * blocks — the post-P13 replacement for the deleted GenerateContentResponse
 * `.text` getter.
 */
function extractText(output: {
  content: { blocks: IContent['blocks'] };
}): string {
  return output.content.blocks
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

describe('Issue 1729: Claude stopping after thinking block', () => {
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
      metadata: { source: 'chatSession.issue1729.test' },
    });

    const manager = new TestRuntimeProviderManager(providerRuntime);
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

    new ChatSession(view, {} as unknown as ContentGenerator, {}, []);
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

      const chunk = toModelStreamChunk(icontent);

      expect(chunk.finishReason).toBe('stop');
      expect(chunk.rawStopReason).toBe('end_turn');
    });

    it('should set finishReason MAX_TOKENS for max_tokens stopReason', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Some text' }],
        metadata: {
          stopReason: 'max_tokens',
        },
      };

      const chunk = toModelStreamChunk(icontent);
      expect(chunk.finishReason).toBe('max_tokens');
    });

    it('should set finishReason STOP for stop_sequence stopReason', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Some text' }],
        metadata: {
          stopReason: 'stop_sequence',
        },
      };

      const chunk = toModelStreamChunk(icontent);
      expect(chunk.finishReason).toBe('stop');
    });

    it('should set finishReason for tool_use stopReason', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Some text' }],
        metadata: {
          stopReason: 'tool_use',
        },
      };

      // tool_use is a distinct canonical finish reason (tool_calls), not
      // collapsed to 'stop' — the neutral layer preserves the distinction.
      const chunk = toModelStreamChunk(icontent);
      expect(chunk.finishReason).toBe('tool_calls');
    });

    it('should not set finishReason when metadata has no stopReason', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Some text' }],
        metadata: {},
      };

      const chunk = toModelStreamChunk(icontent);
      expect(chunk.finishReason).toBeUndefined();
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

      const chunk = toModelStreamChunk(icontent);
      expect(extractText(chunk)).toBe('');
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

      const chunk = toModelStreamChunk(icontent);
      expect(extractText(chunk)).toBe('Ok now I will proceed.');
    });

    it('should return text for text-only content without thinking', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Hello world' }],
        metadata: {},
      };

      const chunk = toModelStreamChunk(icontent);
      expect(extractText(chunk)).toBe('Hello world');
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

      const chunk = toModelStreamChunk(icontent);
      expect(extractText(chunk)).toBe('First part. Second part.');
    });
  });

  describe('stopReason mapping completeness', () => {
    it('should map model_context_window_exceeded to other (unknown reason)', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'truncated' }],
        metadata: { stopReason: 'model_context_window_exceeded' },
      };

      // model_context_window_exceeded is not in any known stop-reason map, so
      // it canonicalizes to 'other' (the raw value is preserved on
      // rawStopReason). The old test asserted MAX_TOKENS via the deleted
      // provider-specific mapping; the neutral layer does not guess.
      const chunk = toModelStreamChunk(icontent);
      expect(chunk.finishReason).toBe('other');
      expect(chunk.rawStopReason).toBe('model_context_window_exceeded');
    });

    it('should map pause_turn to other (unknown reason)', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'paused' }],
        metadata: { stopReason: 'pause_turn' },
      };

      // pause_turn is not in any known stop-reason map; it canonicalizes to
      // 'other' with the raw value preserved on rawStopReason.
      const chunk = toModelStreamChunk(icontent);
      expect(chunk.finishReason).toBe('other');
      expect(chunk.rawStopReason).toBe('pause_turn');
    });

    // @issue:2329 — refusal is a distinct canonical finish reason; the raw
    // provider stop reason is preserved on the neutral rawStopReason carrier
    // so consumers can distinguish a safety-classifier refusal from a normal
    // completion.
    it('should map refusal to refusal and preserve rawStopReason @issue:2329', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'refused' }],
        metadata: { stopReason: 'refusal' },
      };

      const chunk = toModelStreamChunk(icontent);
      expect(chunk.finishReason).toBe('refusal');
      expect(chunk.rawStopReason).toBe('refusal');
    });

    it('should map unknown stop reasons to other', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'text' }],
        metadata: { stopReason: 'some_future_reason' },
      };

      // Unknown provider stop reasons canonicalize to 'other' (benign
      // unknown); the raw value survives on rawStopReason.
      const chunk = toModelStreamChunk(icontent);
      expect(chunk.finishReason).toBe('other');
      expect(chunk.rawStopReason).toBe('some_future_reason');
    });
  });
});
