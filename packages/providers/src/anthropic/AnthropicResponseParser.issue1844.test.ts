/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression tests for issue #1844:
 * Anthropic non-streaming response parser must propagate stopReason
 * into IContent.metadata so downstream turn handling and telemetry work.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';

import type { ResponseParserOptions } from './AnthropicResponseParser.js';
let parseAnthropicResponse: typeof import('./AnthropicResponseParser.js').parseAnthropicResponse;

function createMockMessage(
  stopReason: string,
  content: Array<Record<string, unknown>> = [{ type: 'text', text: 'Hello' }],
): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    content: content as Anthropic.Message['content'],
    model: 'claude-3-sonnet-20240229',
    stop_reason: stopReason as Anthropic.Message['stop_reason'],
    stop_sequence: null,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
    },
  } as Anthropic.Message;
}

function createBaseParserOptions(
  overrides: Partial<ResponseParserOptions> = {},
): ResponseParserOptions {
  return {
    isOAuth: false,
    tools: undefined,
    unprefixToolName: (name: string) => name,
    findToolSchema: () => undefined,
    cacheLogger: { debug: (fn: () => string) => fn() },
    includeThinkingInResponse: true,
    ...overrides,
  };
}

describe('issue #1723 – Anthropic non-streaming includeThinkingInResponse visibility', () => {
  const parserOptions = createBaseParserOptions();

  beforeAll(async () => {
    const mod = await import('./AnthropicResponseParser.js');
    parseAnthropicResponse = mod.parseAnthropicResponse;
  });

  it('marks thinking blocks hidden when includeThinkingInResponse is false without discarding context', () => {
    const result = parseAnthropicResponse(
      createMockMessage('end_turn', [
        {
          type: 'thinking',
          thinking: 'private context',
          signature: 'sig-private',
        },
        { type: 'text', text: 'visible answer' },
      ]),
      { ...parserOptions, includeThinkingInResponse: false },
    );

    expect(result.blocks).toStrictEqual([
      {
        type: 'thinking',
        thought: 'private context',
        sourceField: 'thinking',
        signature: 'sig-private',
        isHidden: true,
      },
      { type: 'text', text: 'visible answer' },
    ]);
  });

  it('keeps thinking blocks visible when includeThinkingInResponse is true', () => {
    const result = parseAnthropicResponse(
      createMockMessage('end_turn', [
        {
          type: 'thinking',
          thinking: 'visible context',
          signature: 'sig-visible',
        },
      ]),
      { ...parserOptions, includeThinkingInResponse: true },
    );

    expect(result.blocks[0]).toStrictEqual({
      type: 'thinking',
      thought: 'visible context',
      sourceField: 'thinking',
      signature: 'sig-visible',
      isHidden: false,
    });
  });

  it('marks redacted thinking blocks hidden when includeThinkingInResponse is false', () => {
    const result = parseAnthropicResponse(
      createMockMessage('end_turn', [
        {
          type: 'redacted_thinking',
          data: 'redacted-data',
        },
      ]),
      { ...parserOptions, includeThinkingInResponse: false },
    );

    expect(result.blocks[0]).toStrictEqual({
      type: 'thinking',
      thought: '[redacted]',
      sourceField: 'thinking',
      signature: 'redacted-data',
      isHidden: true,
    });
  });

  it('keeps redacted thinking blocks visible when includeThinkingInResponse is true', () => {
    const result = parseAnthropicResponse(
      createMockMessage('end_turn', [
        {
          type: 'redacted_thinking',
          data: 'redacted-data',
        },
      ]),
      { ...parserOptions, includeThinkingInResponse: true },
    );

    expect(result.blocks[0]).toStrictEqual({
      type: 'thinking',
      thought: '[redacted]',
      sourceField: 'thinking',
      signature: 'redacted-data',
      isHidden: false,
    });
  });

  it('handles redacted thinking blocks with empty signature data', () => {
    const result = parseAnthropicResponse(
      createMockMessage('end_turn', [{ type: 'redacted_thinking', data: '' }]),
      { ...parserOptions, includeThinkingInResponse: false },
    );

    expect(result.blocks[0]).toStrictEqual({
      type: 'thinking',
      thought: '[redacted]',
      sourceField: 'thinking',
      signature: '',
      isHidden: true,
    });
  });
});

describe('issue #1844 – Anthropic non-streaming stopReason propagation', () => {
  beforeAll(async () => {
    const mod = await import('./AnthropicResponseParser.js');
    parseAnthropicResponse = mod.parseAnthropicResponse;
  });

  it('should include stopReason in metadata when stop_reason is "end_turn"', () => {
    const message = createMockMessage('end_turn');
    const options = {
      ...createBaseParserOptions(),
      includeThinkingInResponse: true,
    };

    const result = parseAnthropicResponse(message, options);

    expect(result.metadata).toBeDefined();
    expect(result.metadata!.stopReason).toBe('end_turn');
  });

  it('should include stopReason in metadata when stop_reason is "tool_use"', () => {
    const message = createMockMessage('tool_use', [
      {
        type: 'tool_use',
        id: 'toolu_123',
        name: 'search',
        input: { query: 'test' },
      },
    ]);
    const options = {
      ...createBaseParserOptions(),
      includeThinkingInResponse: true,
    };

    const result = parseAnthropicResponse(message, options);

    expect(result.metadata).toBeDefined();
    expect(result.metadata!.stopReason).toBe('tool_use');
  });

  it('should include stopReason in metadata when stop_reason is "max_tokens"', () => {
    const message = createMockMessage('max_tokens', [
      { type: 'text', text: 'Truncated response...' },
    ]);
    const options = {
      ...createBaseParserOptions(),
      includeThinkingInResponse: true,
    };

    const result = parseAnthropicResponse(message, options);

    expect(result.metadata).toBeDefined();
    expect(result.metadata!.stopReason).toBe('max_tokens');
  });

  it('should still propagate usage alongside stopReason', () => {
    const message = createMockMessage('end_turn');
    const options = {
      ...createBaseParserOptions(),
      includeThinkingInResponse: true,
    };

    const result = parseAnthropicResponse(message, options);

    expect(result.metadata!.usage).toBeDefined();
    expect(result.metadata!.usage!.promptTokens).toBe(10);
    expect(result.metadata!.usage!.completionTokens).toBe(5);
    expect(result.metadata!.stopReason).toBe('end_turn');
  });

  // Fable 5 returns refusals as a successful HTTP 200 with stop_reason:
  // 'refusal' (not an error). This only verifies the parser propagates the
  // value into metadata.stopReason without throwing — it does NOT verify any
  // user-visible refusal notice. Surfacing a notice (and optional fallback) is
  // tracked separately in #2329.
  it('should propagate stopReason "refusal" without throwing @issue:2329', () => {
    const message = createMockMessage('refusal');
    const options = {
      ...createBaseParserOptions(),
      includeThinkingInResponse: true,
    };

    const result = parseAnthropicResponse(message, options);

    expect(result.metadata).toBeDefined();
    expect(result.metadata!.stopReason).toBe('refusal');
  });
});
