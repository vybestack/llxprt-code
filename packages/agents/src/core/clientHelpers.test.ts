/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  isThinkingSupported,
  findCompressSplitPoint,
  estimateRequestTokensStructured,
} from './clientHelpers.js';

describe('isThinkingSupported', () => {
  it('returns false for gemini-2.0 models', () => {
    expect(isThinkingSupported('gemini-2.0-flash')).toBe(false);
    expect(isThinkingSupported('gemini-2.0-pro')).toBe(false);
  });

  it('returns true for gemini-2.5 models', () => {
    expect(isThinkingSupported('gemini-2.5-flash')).toBe(true);
    expect(isThinkingSupported('gemini-2.5-pro')).toBe(true);
  });

  it('returns true for other model names', () => {
    expect(isThinkingSupported('some-other-model')).toBe(true);
    expect(isThinkingSupported('gpt-4')).toBe(true);
  });
});

describe('findCompressSplitPoint', () => {
  it('throws for fraction <= 0', () => {
    expect(() => findCompressSplitPoint([], 0)).toThrow(
      'Fraction must be between 0 and 1',
    );
    expect(() => findCompressSplitPoint([], -0.5)).toThrow(
      'Fraction must be between 0 and 1',
    );
  });

  it('throws for fraction >= 1', () => {
    expect(() => findCompressSplitPoint([], 1)).toThrow(
      'Fraction must be between 0 and 1',
    );
    expect(() => findCompressSplitPoint([], 1.5)).toThrow(
      'Fraction must be between 0 and 1',
    );
  });

  it('handles empty history', () => {
    expect(findCompressSplitPoint([], 0.5)).toBe(0);
  });

  it('handles single content item', () => {
    const history: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
    ];
    expect(findCompressSplitPoint(history, 0.5)).toBe(0);
  });

  it('returns correct index at threshold boundary', () => {
    const history: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'This is the first message.' }],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'This is the second message.' }],
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'This is the third message.' }],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'This is the fourth message.' }],
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'This is the fifth message.' }],
      },
    ];
    expect(findCompressSplitPoint(history, 0.5)).toBe(4);
  });

  it('falls back to tool call split when no valid user splits exist', () => {
    const history: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          { type: 'tool_call', id: 'toolA', name: 'toolA', parameters: {} },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'toolA',
            toolName: 'toolA',
            result: { ok: true },
          },
        ],
      },
      {
        speaker: 'ai',
        blocks: [
          { type: 'tool_call', id: 'toolB', name: 'toolB', parameters: {} },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'toolB',
            toolName: 'toolB',
            result: { ok: true },
          },
        ],
      },
    ];
    expect(findCompressSplitPoint(history, 0.6)).toBe(2);
  });

  it('returns earlier split point when no valid ones exist after threshold', () => {
    const history: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'This is the first message.' }],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'This is the second message.' }],
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'This is the third message.' }],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'tool_call', id: '', name: '', parameters: {} }],
      },
    ];
    expect(findCompressSplitPoint(history, 0.99)).toBe(2);
  });
});

describe('estimateRequestTokensStructured', () => {
  it('estimates string input from character length', () => {
    expect(estimateRequestTokensStructured('hello world')).toBe(2);
  });

  it('estimates text parts from text length', () => {
    expect(
      estimateRequestTokensStructured([
        { type: 'text', text: 'hello' },
        { type: 'text', text: ' world' },
      ]),
    ).toBe(2);
  });

  it('handles single-object text input', () => {
    expect(
      estimateRequestTokensStructured({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'hello world' }],
      }),
    ).toBe(2);
  });

  it('counts functionResponse JSON payloads', () => {
    const result = { result: 'x'.repeat(40) };

    expect(
      estimateRequestTokensStructured([
        {
          type: 'tool_response',
          callId: 'toolResult',
          toolName: 'toolResult',
          result,
        },
      ]),
    ).toBe(Math.floor(JSON.stringify(result).length / 4));
  });

  it('counts functionCall JSON payloads', () => {
    const parameters = { query: 'x'.repeat(40) };

    expect(
      estimateRequestTokensStructured([
        {
          type: 'tool_call',
          id: 'toolCall',
          name: 'toolCall',
          parameters,
        },
      ]),
    ).toBe(Math.floor(JSON.stringify(parameters).length / 4));
  });

  it('ignores inlineData and fileData payloads', () => {
    expect(
      estimateRequestTokensStructured([
        { type: 'text', text: 'abcd' },
        {
          type: 'media',
          mimeType: 'image/png',
          data: 'x'.repeat(10_000),
          encoding: 'base64',
        },
      ]),
    ).toBe(1);
  });

  it('sums mixed strings, text parts, and function payloads', () => {
    const result = { value: 'abcd' };
    const expectedChars =
      'hello'.length + 'world'.length + JSON.stringify(result).length;

    expect(
      estimateRequestTokensStructured([
        'hello',
        { type: 'text', text: 'world' },
        {
          type: 'tool_response',
          callId: 'tool',
          toolName: 'tool',
          result,
        },
      ]),
    ).toBe(Math.floor(expectedChars / 4));
  });
});
