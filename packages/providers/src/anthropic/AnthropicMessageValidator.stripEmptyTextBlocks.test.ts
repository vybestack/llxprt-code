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
import type { AnthropicMessage } from './AnthropicMessageNormalizer.js';
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

    expect(result[0].content).toStrictEqual([
      {
        type: 'tool_result',
        tool_use_id: 'toolu_1',
        content: 'file contents here',
      },
    ]);
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
    expect(result[0].content).toStrictEqual([
      { type: 'text', text: 'real question' },
    ]);
  });

  it('removes Unicode-whitespace-only text blocks (NBSP, em space)', () => {
    const messages: AnthropicMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'real question' },
          { type: 'text', text: '\u00A0\u2003\u00A0' },
        ],
      },
    ];

    const result = stripEmptyTextBlocks(messages, noopLogger);
    expect(result[0].content).toStrictEqual([
      { type: 'text', text: 'real question' },
    ]);
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
    expect(result.map((message) => message.content)).toStrictEqual([
      [{ type: 'text', text: 'keep me' }],
      [{ type: 'text', text: 'answer' }],
    ]);
  });

  it('replaces empty content array (content: []) with the role placeholder', () => {
    const messages: AnthropicMessage[] = [
      { role: 'user', content: [] },
      { role: 'assistant', content: [] },
    ];

    const result = stripEmptyTextBlocks(messages, noopLogger);

    expect(result[0].content).toBe('[Empty message]');
    expect(result[1].content).toBe('[No content generated]');
  });

  it('leaves non-text-only content arrays unchanged (e.g. tool_use only)', () => {
    const original: AnthropicMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: {} },
        ],
      },
    ];

    const result = stripEmptyTextBlocks(original, noopLogger);

    expect(result[0].content).toBe(original[0].content);
  });

  it('leaves arrays with a mix of tool_result and non-text blocks unchanged', () => {
    const original: AnthropicMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_1',
            content: 'result data',
          },
        ],
      },
    ];

    const result = stripEmptyTextBlocks(original, noopLogger);

    expect(result[0].content).toBe(original[0].content);
  });

  it('preserves a thinking block when it is the only block', () => {
    const original: AnthropicMessage[] = [
      {
        role: 'assistant',
        content: [
          {
            type: 'thinking',
            thinking: 'internal thought',
            signature: 'sig',
          },
        ],
      },
    ];

    const result = stripEmptyTextBlocks(original, noopLogger);

    expect(result[0].content).toBe(original[0].content);
  });
});
