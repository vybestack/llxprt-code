/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { accumulateLiveOutput } from '../../liveOutput.js';
import type {
  AnsiOutput,
  AnsiToken,
  LiveOutputUpdate,
} from '../../../utils/terminalSerializer.js';

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

/** Builds an AnsiOutput snapshot from a single token text. */
function snapshot(text: string): AnsiOutput {
  return [[makeToken(text)]];
}

/** Drives a sequence of updates through the accumulator and returns the result. */
function replay(updates: LiveOutputUpdate[]): string | AnsiOutput {
  return updates.reduce<string | AnsiOutput | undefined>((acc, update) => {
    const next = accumulateLiveOutput(acc, update);
    return next;
  }, undefined) as string | AnsiOutput;
}

describe('Live-output accumulation behavioral scenarios', () => {
  it('interleaved append (text) and replace (AnsiOutput) updates accumulate correctly', () => {
    const result = replay([
      { mode: 'append', data: 'first ' },
      { mode: 'append', data: 'second ' },
      { mode: 'replace', data: snapshot('terminal-snap') },
      { mode: 'append', data: ' after' },
    ]);
    // The replace wipes prior text; the append discards the AnsiOutput
    // (existing is non-string) and returns just the new string data.
    expect(result).toBe(' after');
  });

  it('append streams contain no inserted separators between consecutive appends', () => {
    const result = replay([
      { mode: 'append', data: 'a' },
      { mode: 'append', data: 'b' },
      { mode: 'append', data: 'c' },
    ]);
    expect(result).toBe('abc');
  });

  it('final accumulated result shape is string after only appends', () => {
    const result = replay([
      { mode: 'append', data: 'one ' },
      { mode: 'append', data: 'two' },
    ]);
    expect(typeof result).toBe('string');
    expect(result).toBe('one two');
  });

  it('final accumulated result shape is AnsiOutput after a final replace', () => {
    const snap = snapshot('final');
    const result = replay([
      { mode: 'append', data: 'text' },
      { mode: 'replace', data: snap },
    ]);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toBe(snap);
  });

  it('mixed transition: append, append, replace, append wipes prior text then starts fresh', () => {
    const result = replay([
      { mode: 'append', data: 'hello ' },
      { mode: 'append', data: 'world' },
      { mode: 'replace', data: snapshot('buffer') },
      { mode: 'append', data: 'fresh' },
    ]);
    // After replace the accumulated value is AnsiOutput; the next append
    // discards it and returns just the new string data.
    expect(result).toBe('fresh');
  });
});
