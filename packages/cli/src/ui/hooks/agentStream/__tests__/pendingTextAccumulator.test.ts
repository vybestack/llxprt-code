/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { PendingTextAccumulator } from '../pendingTextAccumulator.js';

describe('PendingTextAccumulator', () => {
  it('materializes thousands of deltas exactly while coalescing previews', () => {
    const accumulator = new PendingTextAccumulator(32);
    const expected = Array.from(
      { length: 10_000 },
      (_, index) => `${index},`,
    ).join('');
    let publications = 0;

    for (let index = 0; index < 10_000; index += 1) {
      const result = accumulator.append(`${index},`);
      publications += result.publish ? 1 : 0;
    }

    expect({ text: accumulator.materialize(), publications }).toStrictEqual({
      text: expected,
      publications: 312,
    });
  });

  it('publishes a semantic newline immediately', () => {
    const accumulator = new PendingTextAccumulator(32);
    accumulator.append('markdown');
    const result = accumulator.append('\n');
    expect(result).toStrictEqual({ publish: true, text: 'markdown\n' });
  });

  it('replaces and clears retained terminal state', () => {
    const accumulator = new PendingTextAccumulator(32);
    accumulator.append('before');
    accumulator.replace('after');
    const replaced = accumulator.materialize();
    accumulator.clear();
    expect({ replaced, cleared: accumulator.materialize() }).toStrictEqual({
      replaced: 'after',
      cleared: '',
    });
  });
});
