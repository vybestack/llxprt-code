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

const TRIM_MARKER =
  '[... earlier live output trimmed ...]' + String.fromCharCode(10);

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

  describe('retention bound (issue #2852)', () => {
    it('keeps the newest output bounded across many appends', () => {
      let acc: string | AnsiOutput | undefined;
      for (let index = 0; index < 2_000; index += 1) {
        acc = accumulateLiveOutput(acc, {
          mode: 'append',
          data: `${index.toString().padStart(4, '0')}:${'x'.repeat(1024)}`,
        });
      }

      expect({
        isString: typeof acc === 'string',
        withinBudget: (acc as string).length <= 256 * 1024,
        keepsNewest: (acc as string).includes('1999:'),
        marksTrim: (acc as string).startsWith(
          '[... earlier live output trimmed ...]',
        ),
      }).toStrictEqual({
        isString: true,
        withinBudget: true,
        keepsNewest: true,
        marksTrim: true,
      });
    });

    it('is not confused by tool output containing the truncation marker', () => {
      // The accumulator must not recover its state by searching content for a
      // magic string, or a tool that prints that string corrupts the preview.
      const marker = TRIM_MARKER;
      let acc: string | AnsiOutput | undefined;
      acc = accumulateLiveOutput(acc, { mode: 'append', data: 'start ' });
      acc = accumulateLiveOutput(acc, { mode: 'append', data: marker });
      acc = accumulateLiveOutput(acc, { mode: 'append', data: 'end' });

      expect(acc).toBe(`start ${marker}end`);
    });

    it('never splits a surrogate pair when trimming', () => {
      let acc: string | AnsiOutput | undefined;
      for (let index = 0; index < 400; index += 1) {
        acc = accumulateLiveOutput(acc, {
          mode: 'append',
          data: '𝔘'.repeat(1024),
        });
      }
      const text = acc as string;
      const body = text.slice(TRIM_MARKER.length);
      expect([...body].every((char) => char === '𝔘')).toBe(true);
    });

    it('bounds a single oversized append', () => {
      const acc = accumulateLiveOutput('', {
        mode: 'append',
        data: 'y'.repeat(2_000_000),
      });
      expect((acc as string).length).toBeLessThanOrEqual(256 * 1024);
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

  describe('status mode (liveness, issue #2540)', () => {
    const status = {
      mode: 'status' as const,
      status: { kind: 'liveness' as const, seq: 1 },
    };

    it('preserves an existing string accumulator unchanged', () => {
      expect(accumulateLiveOutput('existing', status)).toBe('existing');
    });

    it('preserves an existing AnsiOutput accumulator unchanged', () => {
      expect(accumulateLiveOutput(ansiSnapshot, status)).toBe(ansiSnapshot);
    });

    it('returns empty string for an undefined accumulator', () => {
      expect(accumulateLiveOutput(undefined, status)).toBe('');
    });

    it('does not grow the accumulator across repeated status updates', () => {
      let acc: string | AnsiOutput | undefined = 'base';
      for (let seq = 1; seq <= 50; seq++) {
        acc = accumulateLiveOutput(acc, {
          mode: 'status',
          status: { kind: 'liveness', seq },
        });
      }
      expect(acc).toBe('base');
    });

    it('status after append keeps the accumulated text', () => {
      let acc: string | AnsiOutput | undefined = undefined;
      acc = accumulateLiveOutput(acc, { mode: 'append', data: 'kept' });
      acc = accumulateLiveOutput(acc, status);
      expect(acc).toBe('kept');
    });

    it('append after status appends onto the preserved text', () => {
      let acc: string | AnsiOutput | undefined = 'pre';
      acc = accumulateLiveOutput(acc, status);
      acc = accumulateLiveOutput(acc, { mode: 'append', data: '-post' });
      expect(acc).toBe('pre-post');
    });
  });
});
