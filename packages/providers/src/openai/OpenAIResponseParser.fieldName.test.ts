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
 *
 * @issue #2505 — Configurable reasoning field name for the classic openai
 *   provider (Ollama emits reasoning under delta.reasoning).
 */

import { describe, it, expect, vi } from 'vitest';
import { parseStreamingReasoningDelta } from './OpenAIResponseParser.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type OpenAI from 'openai';

const mockLogger: DebugLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  log: vi.fn(),
  enabled: false,
} as unknown as DebugLogger;

type Delta = OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta;

describe('parseStreamingReasoningDelta — configurable field name (#2505)', () => {
  it('reads reasoning_content by default and reports sourceField provenance', () => {
    const delta = {
      reasoning_content: 'thinking via standard field',
    } as unknown as Delta;

    const result = parseStreamingReasoningDelta(delta, mockLogger);

    expect(result.thinking).not.toBeNull();
    expect(result.thinking?.thought).toBe('thinking via standard field');
    expect(result.thinking?.sourceField).toBe('reasoning_content');
  });

  it('auto-falls-back to delta.reasoning when field name is unset (Ollama)', () => {
    const delta = {
      reasoning: 'ollama reasoning trace',
    } as unknown as Delta;

    const result = parseStreamingReasoningDelta(delta, mockLogger);

    expect(result.thinking).not.toBeNull();
    expect(result.thinking?.thought).toBe('ollama reasoning trace');
    expect(result.thinking?.sourceField).toBe('reasoning');
  });

  it('prefers reasoning_content over reasoning when both present and unset', () => {
    const delta = {
      reasoning_content: 'standard',
      reasoning: 'fallback',
    } as unknown as Delta;

    const result = parseStreamingReasoningDelta(delta, mockLogger);

    expect(result.thinking?.thought).toBe('standard');
    expect(result.thinking?.sourceField).toBe('reasoning_content');
  });

  it('reads only the explicitly configured field name', () => {
    const delta = {
      reasoning: 'ollama trace',
    } as unknown as Delta;

    const result = parseStreamingReasoningDelta(delta, mockLogger, 'reasoning');

    expect(result.thinking?.thought).toBe('ollama trace');
    expect(result.thinking?.sourceField).toBe('reasoning');
  });

  it('ignores reasoning_content when field name is explicitly "reasoning"', () => {
    const delta = {
      reasoning_content: 'should be ignored',
    } as unknown as Delta;

    const result = parseStreamingReasoningDelta(delta, mockLogger, 'reasoning');

    expect(result.thinking).toBeNull();
  });

  it('ignores delta.reasoning when field name is explicitly "reasoning_content"', () => {
    const delta = {
      reasoning: 'should be ignored',
    } as unknown as Delta;

    const result = parseStreamingReasoningDelta(
      delta,
      mockLogger,
      'reasoning_content',
    );

    expect(result.thinking).toBeNull();
  });

  it('preserves whitespace-only reasoning from the fallback field (issue #721)', () => {
    const delta = {
      reasoning: '  \n\t  ',
    } as unknown as Delta;

    const result = parseStreamingReasoningDelta(delta, mockLogger);

    expect(result.thinking?.thought).toBe('  \n\t  ');
    expect(result.thinking?.sourceField).toBe('reasoning');
  });

  it('returns null when no reasoning is present on either field', () => {
    const delta = {
      content: 'just content',
    } as unknown as Delta;

    const result = parseStreamingReasoningDelta(delta, mockLogger);

    expect(result.thinking).toBeNull();
  });

  it('falls back to delta.reasoning when reasoning_content is an empty string', () => {
    const delta = {
      reasoning_content: '',
      reasoning: 'ollama reasoning',
    } as unknown as Delta;

    const result = parseStreamingReasoningDelta(delta, mockLogger);

    expect(result.thinking?.thought).toBe('ollama reasoning');
    expect(result.thinking?.sourceField).toBe('reasoning');
  });

  it('falls back to delta.reasoning when reasoning_content is a non-string value', () => {
    const delta = {
      reasoning_content: { malformed: true },
      reasoning: 'ollama reasoning',
    } as unknown as Delta;

    const result = parseStreamingReasoningDelta(delta, mockLogger);

    expect(result.thinking?.thought).toBe('ollama reasoning');
    expect(result.thinking?.sourceField).toBe('reasoning');
  });

  it('falls back to delta.reasoning when reasoning_content is null', () => {
    const delta = {
      reasoning_content: null,
      reasoning: 'ollama reasoning',
    } as unknown as Delta;

    const result = parseStreamingReasoningDelta(delta, mockLogger);

    expect(result.thinking?.thought).toBe('ollama reasoning');
    expect(result.thinking?.sourceField).toBe('reasoning');
  });

  it('treats an empty-string field name as unset and auto-falls-back (issue #2505)', () => {
    const delta = {
      reasoning: 'ollama reasoning',
    } as unknown as Delta;

    const result = parseStreamingReasoningDelta(delta, mockLogger, '');

    expect(result.thinking?.thought).toBe('ollama reasoning');
    expect(result.thinking?.sourceField).toBe('reasoning');
  });

  it('treats a whitespace-only field name as unset and auto-falls-back (issue #2505)', () => {
    const delta = {
      reasoning_content: 'standard reasoning',
    } as unknown as Delta;

    const result = parseStreamingReasoningDelta(delta, mockLogger, '   ');

    expect(result.thinking?.thought).toBe('standard reasoning');
    expect(result.thinking?.sourceField).toBe('reasoning_content');
  });

  it('trims a whitespace-padded field name before using it as the delta key (issue #2505)', () => {
    const delta = {
      reasoning: 'ollama reasoning',
    } as unknown as Delta;

    const result = parseStreamingReasoningDelta(
      delta,
      mockLogger,
      '  reasoning  ',
    );

    expect(result.thinking?.thought).toBe('ollama reasoning');
    expect(result.thinking?.sourceField).toBe('reasoning');
  });

  it('returns null when an explicit field name is set but its value is non-usable', () => {
    const delta = {
      custom_field: { malformed: true },
      reasoning: 'ollama reasoning',
    } as unknown as Delta;

    const result = parseStreamingReasoningDelta(
      delta,
      mockLogger,
      'custom_field',
    );

    expect(result.thinking).toBeNull();
  });
});
