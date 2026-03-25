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
  estimateTextOnlyLength,
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

describe('estimateTextOnlyLength', () => {
  it('returns string length for string input', () => {
    expect(estimateTextOnlyLength('hello world')).toBe(11);
  });

  it('returns 0 for empty string', () => {
    expect(estimateTextOnlyLength('')).toBe(0);
  });

  it('returns 0 for a single non-text Part object (not array)', () => {
    expect(
      estimateTextOnlyLength({
        inlineData: { mimeType: 'image/png', data: 'abc' },
      }),
    ).toBe(0);
  });

  it('returns 0 for empty array', () => {
    expect(estimateTextOnlyLength([])).toBe(0);
  });

  it('sums text lengths from Part array', () => {
    expect(
      estimateTextOnlyLength([{ text: 'hello' }, { text: ' world' }]),
    ).toBe(11);
  });

  it('handles string elements within array', () => {
    expect(estimateTextOnlyLength(['hello', ' ', 'world'])).toBe(11);
  });

  it('handles mixed text Parts and string elements', () => {
    expect(estimateTextOnlyLength(['hello', { text: ' world' }])).toBe(11);
  });

  it('ignores non-text Parts such as inlineData', () => {
    expect(
      estimateTextOnlyLength([
        { text: 'hi' },
        { inlineData: { mimeType: 'image/png', data: 'binary-data' } },
      ]),
    ).toBe(2);
  });

  it('ignores functionCall parts', () => {
    expect(
      estimateTextOnlyLength([
        { text: 'result: ' },
        { functionCall: { name: 'myFn', args: {} } },
      ]),
    ).toBe(8);
  });

  it('ignores fileData parts', () => {
    expect(
      estimateTextOnlyLength([
        { text: 'check this: ' },
        { fileData: { fileUri: 'gs://bucket/file' } },
      ]),
    ).toBe(12);
  });

  it('handles array with only non-text parts', () => {
    expect(
      estimateTextOnlyLength([
        { inlineData: { mimeType: 'image/jpeg', data: 'data' } },
        { functionCall: { name: 'fn', args: {} } },
      ]),
    ).toBe(0);
  });

  it('handles singular {text} object (non-array)', () => {
    expect(estimateTextOnlyLength({ text: 'hello world' })).toBe(11);
  });

  it('returns 0 for singular non-text object', () => {
    expect(
      estimateTextOnlyLength({
        inlineData: { mimeType: 'image/png', data: 'binary' },
      }),
    ).toBe(0);
  });
});
