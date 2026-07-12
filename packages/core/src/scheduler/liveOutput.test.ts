/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { accumulateLiveOutput } from './liveOutput.js';
import type { AnsiOutput, AnsiToken } from '../utils/terminalSerializer.js';

/** Builds a minimal valid AnsiToken for test fixtures. */
function makeToken(text: string): AnsiToken {
  return {
    text,
    bold: false,
    italic: false,
    underline: false,
    dim: false,
    inverse: false,
    fg: '',
    bg: '',
  };
}

const ansiSnapshot: AnsiOutput = [[makeToken('full')]];

describe('accumulateLiveOutput', () => {
  it('appends a string delta to an existing string', () => {
    expect(accumulateLiveOutput('Hello ', 'world')).toBe('Hello world');
  });

  it('returns the chunk when existing is undefined', () => {
    expect(accumulateLiveOutput(undefined, 'first')).toBe('first');
  });

  it('returns the chunk when existing is null or other non-string type', () => {
    expect(accumulateLiveOutput(null, 'delta')).toBe('delta');
    expect(accumulateLiveOutput(42, 'delta')).toBe('delta');
  });

  it('preserves existing output when the delta is an empty string', () => {
    expect(accumulateLiveOutput('Hello ', '')).toBe('Hello ');
  });

  it('accumulates multiple string deltas in sequence', () => {
    let acc: string | AnsiOutput | undefined = undefined;
    acc = accumulateLiveOutput(acc, 'one ');
    acc = accumulateLiveOutput(acc, 'two ');
    acc = accumulateLiveOutput(acc, 'three');
    expect(acc).toBe('one two three');
  });

  it('replaces with the latest AnsiOutput snapshot', () => {
    const first: AnsiOutput = [[makeToken('snap-1')]];
    const second: AnsiOutput = [[makeToken('snap-2')]];
    expect(accumulateLiveOutput(first, second)).toBe(second);
  });

  it('does not append when the chunk is AnsiOutput even if existing is a string', () => {
    expect(accumulateLiveOutput('partial', ansiSnapshot)).toBe(ansiSnapshot);
  });

  it('does not append when the existing is AnsiOutput even if the chunk is a string', () => {
    expect(accumulateLiveOutput(ansiSnapshot, 'delta')).toBe('delta');
  });
});
