/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { joinThinkingDelta } from './thinkingTextJoiner.js';

describe('joinThinkingDelta', () => {
  it('appends first delta as-is when previous is empty', () => {
    expect(joinThinkingDelta('', 'Hello')).toBe('Hello');
  });

  it('keeps provider whitespace when next delta starts with space', () => {
    expect(joinThinkingDelta('Hello', ' world')).toBe('Hello world');
  });

  it('keeps provider whitespace when previous ends with whitespace', () => {
    expect(joinThinkingDelta('Hello ', 'world')).toBe('Hello world');
  });

  it('inserts one space between adjacent alnum boundaries', () => {
    expect(joinThinkingDelta('Now', 'Ihaveagoodunderstanding')).toBe(
      'Now Ihaveagoodunderstanding',
    );
  });

  it('does not insert extra space before punctuation', () => {
    expect(joinThinkingDelta('word', '.')).toBe('word.');
    expect(joinThinkingDelta('word', ', next')).toBe('word, next');
  });

  it('preserves markdown newlines and paragraph boundaries', () => {
    expect(joinThinkingDelta('Line 1\n', 'Line 2')).toBe('Line 1\nLine 2');
    expect(joinThinkingDelta('Para 1\n\n', 'Para 2')).toBe('Para 1\n\nPara 2');
  });
});
