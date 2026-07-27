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
  describe('append mode', () => {
    it('appends a string delta to an existing string', () => {
      expect(
        accumulateLiveOutput('Hello ', { mode: 'append', data: 'world' }),
      ).toBe('Hello world');
    });

    it('returns the data when existing is undefined', () => {
      expect(
        accumulateLiveOutput(undefined, { mode: 'append', data: 'first' }),
      ).toBe('first');
    });

    it('returns the data when existing is null or other non-string type', () => {
      expect(
        accumulateLiveOutput(null, { mode: 'append', data: 'delta' }),
      ).toBe('delta');
      expect(accumulateLiveOutput(42, { mode: 'append', data: 'delta' })).toBe(
        'delta',
      );
    });

    it('preserves existing output when the data is an empty string', () => {
      expect(accumulateLiveOutput('Hello ', { mode: 'append', data: '' })).toBe(
        'Hello ',
      );
    });

    it('accumulates multiple string deltas in sequence', () => {
      let acc: string | AnsiOutput | undefined = undefined;
      acc = accumulateLiveOutput(acc, { mode: 'append', data: 'one ' });
      acc = accumulateLiveOutput(acc, { mode: 'append', data: 'two ' });
      acc = accumulateLiveOutput(acc, { mode: 'append', data: 'three' });
      expect(acc).toBe('one two three');
    });
  });

  describe('replace mode', () => {
    it('replaces with the latest AnsiOutput snapshot', () => {
      const first: AnsiOutput = [[makeToken('snap-1')]];
      const second: AnsiOutput = [[makeToken('snap-2')]];
      expect(
        accumulateLiveOutput(first, { mode: 'replace', data: second }),
      ).toBe(second);
    });

    it('supersedes an existing AnsiOutput snapshot', () => {
      expect(
        accumulateLiveOutput(ansiSnapshot, {
          mode: 'replace',
          data: ansiSnapshot,
        }),
      ).toBe(ansiSnapshot);
    });
  });

  describe('mode transitions', () => {
    it('replace after append transitions correctly', () => {
      let acc: string | AnsiOutput | undefined = undefined;
      acc = accumulateLiveOutput(acc, { mode: 'append', data: 'partial' });
      acc = accumulateLiveOutput(acc, { mode: 'replace', data: ansiSnapshot });
      expect(acc).toBe(ansiSnapshot);
    });

    it('append after replace drops the AnsiOutput and starts fresh with the string data', () => {
      let acc: string | AnsiOutput = ansiSnapshot;
      acc = accumulateLiveOutput(acc, { mode: 'append', data: 'delta' });
      expect(acc).toBe('delta');
    });

    it('multiple sequential appends concatenate exactly', () => {
      let acc: string | AnsiOutput | undefined = undefined;
      acc = accumulateLiveOutput(acc, { mode: 'append', data: 'a' });
      acc = accumulateLiveOutput(acc, { mode: 'append', data: 'b' });
      acc = accumulateLiveOutput(acc, { mode: 'append', data: 'c' });
      acc = accumulateLiveOutput(acc, { mode: 'append', data: 'd' });
      expect(acc).toBe('abcd');
    });

    it('multiple sequential replaces keep only the last snapshot', () => {
      const first: AnsiOutput = [[makeToken('1')]];
      const second: AnsiOutput = [[makeToken('2')]];
      const third: AnsiOutput = [[makeToken('3')]];
      let acc: string | AnsiOutput | undefined = undefined;
      acc = accumulateLiveOutput(acc, { mode: 'replace', data: first });
      acc = accumulateLiveOutput(acc, { mode: 'replace', data: second });
      acc = accumulateLiveOutput(acc, { mode: 'replace', data: third });
      expect(acc).toBe(third);
    });
  });
});
