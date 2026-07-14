/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for extractSystemInstructionText (issue #2410).
 *
 * This helper normalizes the various Gemini ContentUnion shapes that
 * generationConfig.systemInstruction can hold (string, Content, Part[],
 * single Part) into a plain-text string for forwarding to providers.
 */

import { describe, it, expect } from 'vitest';
import { extractSystemInstructionText } from './streamRequestHelpers.js';

describe('issue #2410 – extractSystemInstructionText', () => {
  it('returns undefined for undefined input', () => {
    expect(extractSystemInstructionText(undefined)).toBeUndefined();
  });

  it('returns undefined for null input', () => {
    expect(extractSystemInstructionText(null as unknown)).toBeUndefined();
  });

  it('returns trimmed string for string input', () => {
    expect(extractSystemInstructionText('  hello world  ')).toBe('hello world');
  });

  it('returns undefined for empty/whitespace string', () => {
    expect(extractSystemInstructionText('   ')).toBeUndefined();
    expect(extractSystemInstructionText('')).toBeUndefined();
  });

  it('extracts text from a Content shape { role, parts }', () => {
    const content = {
      role: 'system',
      parts: [{ text: 'You are a subagent.' }],
    };
    expect(extractSystemInstructionText(content as unknown)).toBe(
      'You are a subagent.',
    );
  });

  it('returns undefined for Content with empty parts', () => {
    const content = { role: 'system', parts: [] };
    expect(extractSystemInstructionText(content as unknown)).toBeUndefined();
  });

  it('extracts text from a Part[] shape', () => {
    const parts = [{ text: 'part one' }, { text: 'part two' }];
    expect(extractSystemInstructionText(parts as unknown)).toBe(
      ['part one', 'part two'].join('\n'),
    );
  });

  it('trims whitespace-only parts before joining', () => {
    const parts = [{ text: '  real content  ' }, { text: '   ' }];
    expect(extractSystemInstructionText(parts as unknown)).toBe('real content');
  });

  it('extracts text from a single Part shape { text }', () => {
    const part = { text: 'single part text' };
    expect(extractSystemInstructionText(part as unknown)).toBe(
      'single part text',
    );
  });

  it('does not treat a Content object as a single Part', () => {
    // A Content has 'parts' — the single Part branch must not match it.
    const content = {
      role: 'system',
      parts: [{ text: 'content text' }],
      text: 'wrong',
    };
    expect(extractSystemInstructionText(content as unknown)).toBe(
      'content text',
    );
  });

  it('returns undefined for unrecognized shapes', () => {
    expect(extractSystemInstructionText(42 as unknown)).toBeUndefined();
    expect(
      extractSystemInstructionText({ foo: 'bar' } as unknown),
    ).toBeUndefined();
  });

  it('drops non-text parts and joins only text parts in a Part[]', () => {
    const parts = [{ inlineData: { data: 'binary' } }, { text: 'hello' }];
    expect(extractSystemInstructionText(parts as unknown)).toBe('hello');
  });

  it('joins multiple text parts in a Content shape the same as Part[]', () => {
    const content = {
      role: 'system',
      parts: [{ text: 'a' }, { text: 'b' }],
    };
    expect(extractSystemInstructionText(content as unknown)).toBe(
      ['a', 'b'].join('\n'),
    );
  });
});
