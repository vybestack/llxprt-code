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

/**
 * Drives a sequence of updates through the accumulator and returns the result.
 * These behavioral scenarios exercise end-to-end mode transitions that mirror
 * real producer sequences (shell PTY replace after task append, etc.) rather
 * than the isolated single-step unit assertions in liveOutput.test.ts.
 */
function replay(updates: LiveOutputUpdate[]): string | AnsiOutput {
  return updates.reduce<string | AnsiOutput | undefined>((acc, update) => {
    const next = accumulateLiveOutput(acc, update);
    return next;
  }, undefined) as string | AnsiOutput;
}

describe('Live-output accumulation behavioral scenarios', () => {
  it('interleaved append (text) and replace (AnsiOutput) updates accumulate correctly', () => {
    // Mirrors a shell PTY snapshot arriving mid-stream of subagent text.
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
    // Producer contract: append must not invent newlines or separators.
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

  it('empty string append preserves prior accumulated text', () => {
    // An empty string is a valid append delta (e.g. a whitespace-only normalized
    // to empty); it must not wipe prior content.
    const result = replay([
      { mode: 'append', data: 'prior' },
      { mode: 'append', data: '' },
    ]);
    expect(result).toBe('prior');
  });

  it('empty AnsiOutput replace clears any prior accumulated state', () => {
    // An empty snapshot is a valid replace that should reset the accumulator.
    const empty: AnsiOutput = [];
    const result = replay([
      { mode: 'append', data: 'prior text' },
      { mode: 'replace', data: empty },
    ]);
    expect(result).toBe(empty);
  });

  it('consecutive replace operations keep only the latest snapshot', () => {
    const first = snapshot('snap-1');
    const second = snapshot('snap-2');
    const third = snapshot('snap-3');
    const result = replay([
      { mode: 'replace', data: first },
      { mode: 'replace', data: second },
      { mode: 'replace', data: third },
    ]);
    expect(result).toBe(third);
  });

  it('replace as the very first update (no prior state) returns the snapshot', () => {
    // When no prior append has occurred, a replace from undefined must
    // return the AnsiOutput snapshot directly.
    const snap = snapshot('initial');
    const result = replay([{ mode: 'replace', data: snap }]);
    expect(result).toBe(snap);
  });
});
