/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  coerceMessageContentToString,
  sanitizeToolArgumentsString,
  extractKimiToolCallsFromText,
  cleanThinkingContent,
  parseStreamingReasoningDelta,
} from './OpenAIResponseParser.js';
import type { DebugLogger } from '../../debug/index.js';
import type OpenAI from 'openai';

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  isEnabled: vi.fn().mockReturnValue(false),
  getPrefix: vi.fn().mockReturnValue(''),
  child: vi.fn(),
} as unknown as DebugLogger;

describe('coerceMessageContentToString', () => {
  it('returns string content as-is', () => {
    expect(coerceMessageContentToString('hello')).toBe('hello');
  });

  it('returns undefined for null', () => {
    expect(coerceMessageContentToString(null)).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(coerceMessageContentToString(undefined)).toBeUndefined();
  });

  it('joins text parts from array content', () => {
    const parts = [
      { type: 'text', text: 'hello ' },
      { type: 'text', text: 'world' },
    ];
    expect(coerceMessageContentToString(parts)).toBe('hello world');
  });

  it('returns undefined for empty array', () => {
    expect(coerceMessageContentToString([])).toBeUndefined();
  });

  it('handles mixed string and object parts', () => {
    const parts = ['hello', { type: 'text', text: ' world' }];
    expect(coerceMessageContentToString(parts)).toBe('hello world');
  });

  it('returns undefined for number input', () => {
    expect(coerceMessageContentToString(42)).toBeUndefined();
  });

  it('skips null entries in array', () => {
    const parts = [null, { type: 'text', text: 'only' }];
    expect(coerceMessageContentToString(parts)).toBe('only');
  });
});

describe('sanitizeToolArgumentsString', () => {
  it('returns empty object for null', () => {
    expect(sanitizeToolArgumentsString(null, mockLogger)).toBe('{}');
  });

  it('returns empty object for undefined', () => {
    expect(sanitizeToolArgumentsString(undefined, mockLogger)).toBe('{}');
  });

  it('preserves valid JSON object', () => {
    const result = sanitizeToolArgumentsString('{"key":"value"}', mockLogger);
    expect(JSON.parse(result)).toStrictEqual({ key: 'value' });
  });

  it('strips markdown code fences wrapping JSON', () => {
    const input = '```json\n{"key":"value"}\n```';
    const result = sanitizeToolArgumentsString(input, mockLogger);
    expect(JSON.parse(result)).toStrictEqual({ key: 'value' });
  });

  it('isolates JSON object from surrounding prose', () => {
    const input = 'Here is the result: {"file": "test.ts"} as requested';
    const result = sanitizeToolArgumentsString(input, mockLogger);
    expect(JSON.parse(result)).toStrictEqual({ file: 'test.ts' });
  });

  it('returns empty object for empty string', () => {
    expect(sanitizeToolArgumentsString('', mockLogger)).toBe('{}');
  });

  it('serializes non-string input to JSON', () => {
    const result = sanitizeToolArgumentsString({ nested: true }, mockLogger);
    expect(JSON.parse(result)).toStrictEqual({ nested: true });
  });
});

describe('extractKimiToolCallsFromText', () => {
  it('returns empty tool calls for plain text', () => {
    const result = extractKimiToolCallsFromText('just normal text', mockLogger);
    expect(result.toolCalls).toHaveLength(0);
    expect(result.cleanedText).toBe('just normal text');
  });

  it('extracts tool calls from Kimi section markers', () => {
    const input =
      'prefix<|tool_calls_section_begin|>' +
      '<|tool_call_begin|>functions.read_file:0<|tool_call_argument_begin|>' +
      '{"path":"test.ts"}' +
      '<|tool_call_end|>' +
      '<|tool_calls_section_end|>suffix';
    const result = extractKimiToolCallsFromText(input, mockLogger);
    expect(result.toolCalls.length).toBeGreaterThanOrEqual(1);
    expect(result.toolCalls[0].name).toBe('read_file');
    expect(result.cleanedText).not.toContain('<|tool_calls_section_begin|>');
    expect(result.cleanedText).not.toContain('<|tool_calls_section_end|>');
  });

  it('returns empty result for empty string', () => {
    const result = extractKimiToolCallsFromText('', mockLogger);
    expect(result.toolCalls).toHaveLength(0);
  });

  it('cleans text outside tool call sections', () => {
    const input =
      'Hello world<|tool_calls_section_begin|>' +
      '<|tool_call_begin|>functions.test:0<|tool_call_argument_begin|>' +
      '{}' +
      '<|tool_call_end|>' +
      '<|tool_calls_section_end|>';
    const result = extractKimiToolCallsFromText(input, mockLogger);
    expect(result.cleanedText.trim()).toBe('Hello world');
  });
});

describe('cleanThinkingContent', () => {
  it('preserves content without Kimi markers', () => {
    const result = cleanThinkingContent('clean thought', mockLogger);
    expect(result).toBe('clean thought');
  });

  it('returns empty string for empty input', () => {
    const result = cleanThinkingContent('', mockLogger);
    expect(result).toBe('');
  });
});

describe('parseStreamingReasoningDelta', () => {
  it('extracts reasoning_content into thinking block', () => {
    const delta = {
      reasoning_content: 'I think...',
    } as unknown as OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta;
    const result = parseStreamingReasoningDelta(delta, mockLogger);
    expect(result.thinking).not.toBeNull();
    expect(result.thinking!.thought).toBe('I think...');
    expect(result.thinking!.sourceField).toBe('reasoning_content');
  });

  it('returns null thinking for delta without reasoning fields', () => {
    const delta = {
      content: 'regular content',
    } as unknown as OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta;
    const result = parseStreamingReasoningDelta(delta, mockLogger);
    expect(result.thinking).toBeNull();
  });

  it('returns null thinking for undefined delta', () => {
    const result = parseStreamingReasoningDelta(undefined, mockLogger);
    expect(result.thinking).toBeNull();
    expect(result.toolCalls).toHaveLength(0);
  });

  it('returns empty tool calls array when no tool calls in delta', () => {
    const delta = {
      reasoning_content: 'thought',
    } as unknown as OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta;
    const result = parseStreamingReasoningDelta(delta, mockLogger);
    expect(result.toolCalls).toHaveLength(0);
  });
});
