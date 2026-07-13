/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import type { Content } from '@google/genai';
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
    const history: Content[] = [{ role: 'user', parts: [{ text: 'Hello' }] }];
    expect(findCompressSplitPoint(history, 0.5)).toBe(0);
  });

  it('returns correct index at threshold boundary', () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'This is the first message.' }] },
      { role: 'model', parts: [{ text: 'This is the second message.' }] },
      { role: 'user', parts: [{ text: 'This is the third message.' }] },
      { role: 'model', parts: [{ text: 'This is the fourth message.' }] },
      { role: 'user', parts: [{ text: 'This is the fifth message.' }] },
    ];
    expect(findCompressSplitPoint(history, 0.5)).toBe(4);
  });

  it('falls back to tool call split when no valid user splits exist', () => {
    const history: Content[] = [
      { role: 'model', parts: [{ functionCall: { name: 'toolA' } }] },
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'toolA',
              response: { ok: true },
              id: 'toolA',
            },
          },
        ],
      },
      { role: 'model', parts: [{ functionCall: { name: 'toolB' } }] },
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'toolB',
              response: { ok: true },
              id: 'toolB',
            },
          },
        ],
      },
    ];
    expect(findCompressSplitPoint(history, 0.6)).toBe(2);
  });

  it('returns earlier split point when no valid ones exist after threshold', () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'This is the first message.' }] },
      { role: 'model', parts: [{ text: 'This is the second message.' }] },
      { role: 'user', parts: [{ text: 'This is the third message.' }] },
      { role: 'model', parts: [{ functionCall: {} }] },
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
      estimateRequestTokensStructured([{ text: 'hello' }, { text: ' world' }]),
    ).toBe(2);
  });

  it('handles single-object text input', () => {
    expect(estimateRequestTokensStructured({ text: 'hello world' })).toBe(2);
  });

  it('counts functionResponse JSON payloads', () => {
    const payload = {
      name: 'toolResult',
      response: { result: 'x'.repeat(40) },
    };

    expect(estimateRequestTokensStructured({ functionResponse: payload })).toBe(
      Math.floor(JSON.stringify(payload).length / 4),
    );
  });

  it('counts functionCall JSON payloads', () => {
    const payload = {
      name: 'toolCall',
      args: { query: 'x'.repeat(40) },
    };

    expect(estimateRequestTokensStructured({ functionCall: payload })).toBe(
      Math.floor(JSON.stringify(payload).length / 4),
    );
  });

  it('ignores inlineData and fileData payloads', () => {
    expect(
      estimateRequestTokensStructured([
        { text: 'abcd' },
        { inlineData: { mimeType: 'image/png', data: 'x'.repeat(10_000) } },
        { fileData: { fileUri: 'gs://bucket/file' } },
      ]),
    ).toBe(1);
  });

  it('sums mixed strings, text parts, and function payloads', () => {
    const response = { name: 'tool', response: { value: 'abcd' } };
    const expectedChars =
      'hello'.length + 'world'.length + JSON.stringify(response).length;

    expect(
      estimateRequestTokensStructured([
        'hello',
        { text: 'world' },
        { functionResponse: response },
      ]),
    ).toBe(Math.floor(expectedChars / 4));
  });
});
