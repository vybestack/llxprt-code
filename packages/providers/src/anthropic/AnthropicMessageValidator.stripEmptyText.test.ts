/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral regression test for Issue #2410 (Mode 1).
 *
 * Strict Anthropic-compatible endpoints (e.g. z.ai) reject a request when a
 * message content array contains a zero-length text block — z.ai returns 400
 * code 1213 "The prompt parameter was not received normally". Empty text blocks
 * can appear alongside a tool_result block in a subagent's user turn.
 * stripEmptyTextBlocks removes those empty text blocks while preserving all
 * other content.
 */

import { describe, expect, it } from 'vitest';
import type {
  AnthropicMessage,
  AnthropicMessageBlock,
} from './AnthropicMessageNormalizer.js';
import { stripEmptyTextBlocks } from './AnthropicMessageValidator.js';

const noopLogger = { debug: (_fn: () => string) => {} };

describe('stripEmptyTextBlocks (Issue #2410)', () => {
  it('removes an empty text block that follows a tool_result in a user turn', () => {
    const messages: AnthropicMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_1',
            content: 'file contents here',
          },
          { type: 'text', text: '' },
        ],
      },
    ];

    const result = stripEmptyTextBlocks(messages, noopLogger);

    expect(Array.isArray(result[0].content)).toBe(true);
    const content = result[0].content as AnthropicMessageBlock[];
    expect(content).toHaveLength(1);
    expect(content[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'toolu_1',
      content: 'file contents here',
    });
  });

  it('removes whitespace-only text blocks', () => {
    const messages: AnthropicMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'real question' },
          { type: 'text', text: '   \n  ' },
        ],
      },
    ];

    const result = stripEmptyTextBlocks(messages, noopLogger);
    const content = result[0].content as AnthropicMessageBlock[];
    expect(content).toHaveLength(1);
    expect(content[0]).toMatchObject({ type: 'text', text: 'real question' });
  });

  it('preserves non-empty text blocks unchanged', () => {
    const messages: AnthropicMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'hello' },
          { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: {} },
        ],
      },
    ];

    const result = stripEmptyTextBlocks(messages, noopLogger);
    expect(result[0]).toBe(messages[0]);
  });

  it('replaces empty string content with a role placeholder', () => {
    const messages: AnthropicMessage[] = [
      { role: 'user', content: '' },
      { role: 'assistant', content: '  \n ' },
    ];

    const result = stripEmptyTextBlocks(messages, noopLogger);

    expect(result[0].content).toBe('[Empty message]');
    expect(result[1].content).toBe('[No content generated]');
  });

  it('preserves non-empty string content unchanged', () => {
    const messages: AnthropicMessage[] = [{ role: 'user', content: 'hello' }];
    const result = stripEmptyTextBlocks(messages, noopLogger);
    expect(result[0]).toBe(messages[0]);
  });

  it('replaces fully empty text-only content arrays with a placeholder message', () => {
    const messages: AnthropicMessage[] = [
      { role: 'user', content: [{ type: 'text', text: '' }] },
      { role: 'assistant', content: [{ type: 'text', text: '   ' }] },
    ];

    const result = stripEmptyTextBlocks(messages, noopLogger);

    expect(result[0].content).toBe('[Empty message]');
    expect(result[1].content).toBe('[No content generated]');
  });

  it('strips empty blocks across multiple messages independently', () => {
    const messages: AnthropicMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'keep me' },
          { type: 'text', text: '' },
        ],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'answer' }],
      },
    ];

    const result = stripEmptyTextBlocks(messages, noopLogger);
    expect((result[0].content as AnthropicMessageBlock[]).length).toBe(1);
    expect((result[1].content as AnthropicMessageBlock[]).length).toBe(1);
  });
});
