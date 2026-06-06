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

describe('issue #1844 – Anthropic non-streaming stopReason propagation', () => {
  beforeAll(async () => {
    const mod = await import('./AnthropicResponseParser.js');
    parseAnthropicResponse = mod.parseAnthropicResponse;
  });

  it('should include stopReason in metadata when stop_reason is "end_turn"', () => {
    const message = createMockMessage('end_turn');
    const options = {
      isOAuth: false,
      tools: undefined,
      unprefixToolName: (name: string) => name,
      findToolSchema: () => undefined,
      cacheLogger: { debug: () => {} },
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
      isOAuth: false,
      tools: undefined,
      unprefixToolName: (name: string) => name,
      findToolSchema: () => undefined,
      cacheLogger: { debug: () => {} },
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
      isOAuth: false,
      tools: undefined,
      unprefixToolName: (name: string) => name,
      findToolSchema: () => undefined,
      cacheLogger: { debug: () => {} },
    };

    const result = parseAnthropicResponse(message, options);

    expect(result.metadata).toBeDefined();
    expect(result.metadata!.stopReason).toBe('max_tokens');
  });

  it('should still propagate usage alongside stopReason', () => {
    const message = createMockMessage('end_turn');
    const options = {
      isOAuth: false,
      tools: undefined,
      unprefixToolName: (name: string) => name,
      findToolSchema: () => undefined,
      cacheLogger: { debug: () => {} },
    };

    const result = parseAnthropicResponse(message, options);

    expect(result.metadata!.usage).toBeDefined();
    expect(result.metadata!.usage!.promptTokens).toBe(10);
    expect(result.metadata!.usage!.completionTokens).toBe(5);
    expect(result.metadata!.stopReason).toBe('end_turn');
  });
});
