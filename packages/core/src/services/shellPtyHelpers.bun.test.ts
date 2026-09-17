/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { maybeEmitRenderedOutput } from './shellPtyHelpers.js';
import type { AnsiOutput, AnsiToken } from '../utils/terminalSerializer.js';

/** Token factory with the production key order (JSON.stringify stability). */
function token(overrides: Partial<AnsiToken> = {}): AnsiToken {
  return {
    text: 'x',
    bold: false,
    italic: false,
    underline: false,
    dim: false,
    inverse: false,
    fg: '',
    bg: '',
    ...overrides,
  };
}

function baseOutput(): AnsiOutput {
  return [
    [
      token({ text: 'progress 50% ' }),
      token({ text: '[#####]', fg: '#800000' }),
    ],
    [],
    [token({ text: 'done', bold: true })],
  ];
}

interface CheckResult {
  emitted: boolean;
  emitCalls: number;
  current: string | AnsiOutput | null;
  chunk: AnsiOutput | null;
}

function runCheck(
  previous: string | AnsiOutput | null,
  next: AnsiOutput,
  cursor: { cursorY: number; cursorX: number } = { cursorY: 0, cursorX: 0 },
): CheckResult {
  const outputRef = { current: previous };
  let emitCalls = 0;
  let chunk: AnsiOutput | null = null;
  maybeEmitRenderedOutput(
    outputRef,
    (event) => {
      emitCalls++;
      chunk = event.chunk;
    },
    next,
    cursor,
  );
  return {
    emitted: emitCalls === 1,
    emitCalls,
    current: outputRef.current,
    chunk,
  };
}

describe('maybeEmitRenderedOutput (issue #3432)', () => {
  it('emits on an initial null previous output', () => {
    const next = baseOutput();
    const result = runCheck(null, next);
    expect(result.emitted).toBe(true);
    expect(result.current).toBe(next);
    expect(result.chunk).toBe(next);
  });

  it('emits when the previous output is a legacy string', () => {
    const next = baseOutput();
    const result = runCheck('previous raw chunk', next);
    expect(result.emitted).toBe(true);
    expect(result.current).toBe(next);
  });

  it('does not emit for the identical object reference', () => {
    const output = baseOutput();
    const result = runCheck(output, output);
    expect(result.emitted).toBe(false);
    expect(result.emitCalls).toBe(0);
    expect(result.current).toBe(output);
  });

  it('does not emit for an equal-value copy', () => {
    const previous = baseOutput();
    const next = baseOutput();
    expect(previous).not.toBe(next);
    const result = runCheck(previous, next);
    expect(result.emitted).toBe(false);
    expect(result.current).toBe(previous);
  });

  it('emits when characters change but text lengths match (50% → 75%)', () => {
    const previous: AnsiOutput = [
      [token({ text: 'progress 50% ' }), token({ text: '[#####]' })],
    ];
    const next: AnsiOutput = [
      [token({ text: 'progress 75% ' }), token({ text: '[#####]' })],
    ];
    const result = runCheck(previous, next);
    expect(result.emitted).toBe(true);
    expect(result.current).toBe(next);
  });

  it('emits on a color-only change', () => {
    const previous: AnsiOutput = [[token({ text: 'same', fg: '#800000' })]];
    const next: AnsiOutput = [[token({ text: 'same', fg: '#008000' })]];
    const result = runCheck(previous, next);
    expect(result.emitted).toBe(true);
  });

  it('emits on a background color-only change', () => {
    const previous: AnsiOutput = [[token({ text: 'same', bg: '' })]];
    const next: AnsiOutput = [[token({ text: 'same', bg: '#000080' })]];
    const result = runCheck(previous, next);
    expect(result.emitted).toBe(true);
  });

  it('emits when the cursor flips the inverse flag on the cursor line', () => {
    const previous: AnsiOutput = [[token({ text: 'prompt>', inverse: false })]];
    const next: AnsiOutput = [[token({ text: 'prompt>', inverse: true })]];
    const result = runCheck(previous, next);
    expect(result.emitted).toBe(true);
  });

  it('emits when the line count changes', () => {
    const previous = baseOutput();
    const next = baseOutput();
    next.push([token({ text: 'new line' })]);
    const result = runCheck(previous, next);
    expect(result.emitted).toBe(true);
  });

  it('emits when the per-line token count changes', () => {
    const previous: AnsiOutput = [[token({ text: 'ab' })]];
    const next: AnsiOutput = [
      [token({ text: 'a' }), token({ text: 'b', bold: true })],
    ];
    const result = runCheck(previous, next);
    expect(result.emitted).toBe(true);
  });

  it('does not emit when the cursor moved but emitted content is identical', () => {
    const previous = baseOutput();
    const next = baseOutput();
    const result = runCheck(previous, next, { cursorY: 5, cursorX: 3 });
    expect(result.emitted).toBe(false);
    expect(result.current).toBe(previous);
  });

  it('does not emit for the same reference with a different cursor', () => {
    const output = baseOutput();
    const result = runCheck(output, output, { cursorY: 7, cursorX: 9 });
    expect(result.emitted).toBe(false);
    expect(result.current).toBe(output);
  });

  it('emit decision exactly matches JSON.stringify inequality', () => {
    const variants: Array<() => AnsiOutput> = [
      baseOutput,
      () => [
        [
          token({ text: 'progress 75% ' }),
          token({ text: '[#####]', fg: '#800000' }),
        ],
        [],
        [token({ text: 'done', bold: true })],
      ],
      () => [
        [
          token({ text: 'progress 50% ', bold: true }),
          token({ text: '[#####]', fg: '#800000' }),
        ],
        [],
        [token({ text: 'done', bold: true })],
      ],
      () => [
        [
          token({ text: 'progress 50% ', italic: true }),
          token({ text: '[#####]', fg: '#800000' }),
        ],
        [],
        [token({ text: 'done', bold: true })],
      ],
      () => [
        [
          token({ text: 'progress 50% ', underline: true }),
          token({ text: '[#####]', fg: '#800000' }),
        ],
        [],
        [token({ text: 'done', bold: true })],
      ],
      () => [
        [
          token({ text: 'progress 50% ', dim: true }),
          token({ text: '[#####]', fg: '#800000' }),
        ],
        [],
        [token({ text: 'done', bold: true })],
      ],
      () => [
        [
          token({ text: 'progress 50% ', inverse: true }),
          token({ text: '[#####]', fg: '#800000' }),
        ],
        [],
        [token({ text: 'done', bold: true })],
      ],
      () => [
        [
          token({ text: 'progress 50% ' }),
          token({ text: '[#####]', fg: '#008000' }),
        ],
        [],
        [token({ text: 'done', bold: true })],
      ],
      () => [
        [
          token({ text: 'progress 50% ' }),
          token({ text: '[#####]', fg: '#800000', bg: '#000080' }),
        ],
        [],
        [token({ text: 'done', bold: true })],
      ],
      () => [
        [
          token({ text: 'progress 50%' }),
          token({ text: '[#####]', fg: '#800000' }),
        ],
        [],
        [token({ text: 'done', bold: true })],
      ],
      () => [
        [
          token({ text: 'p' }),
          token({ text: 'rogress 50% ' }),
          token({ text: '[#####]', fg: '#800000' }),
        ],
        [],
        [token({ text: 'done', bold: true })],
      ],
      () => [
        [
          token({ text: 'progress 50% ' }),
          token({ text: '[#####]', fg: '#800000' }),
        ],
        [],
        [token({ text: 'done', bold: true })],
        [token({ text: 'extra' })],
      ],
      () => [
        [
          token({ text: 'progress 50% ' }),
          token({ text: '[#####]', fg: '#800000' }),
        ],
        [token({ text: '   ' })],
        [token({ text: 'done', bold: true })],
      ],
      () => [
        [
          token({ text: 'progress 50% ' }),
          token({ text: '[#####]', fg: '#800000' }),
        ],
        [token({ text: 'was empty' })],
        [token({ text: 'done', bold: true })],
      ],
    ];

    for (const buildPrevious of variants) {
      for (const buildNext of variants) {
        const previous = buildPrevious();
        const next = buildNext();
        const expected = JSON.stringify(previous) !== JSON.stringify(next);
        const result = runCheck(previous, next);
        expect(result.emitted).toBe(expected);
        expect(result.current).toBe(expected ? next : previous);
      }
    }

    const next = baseOutput();
    expect(runCheck(null, next).emitted).toBe(
      JSON.stringify(null) !== JSON.stringify(next),
    );
    expect(runCheck('legacy', next).emitted).toBe(
      JSON.stringify('legacy') !== JSON.stringify(next),
    );
  });
});
