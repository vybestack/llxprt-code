/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { DensitySpanRows } from './densitySpanRows.js';
import { mergeRemovedInteriorSpans } from './contextRange.js';
import { SPAN_WINDOW_CAPACITY } from './historySpanWindow.js';
import type { RemovedInteriorSpan } from './historyEventTypes.js';

function span(index: number): RemovedInteriorSpan {
  return {
    start: (index * 331) % 20000,
    end: ((index * 331) % 20000) + (index % 3),
    reason: index % 2 === 0 ? 'density-removed' : 'density-replaced',
  };
}

describe('density span disk sort and existing standing window', () => {
  for (const size of [512, 8192])
    it(`preserves exact sorted merge semantics across ${size} nonmonotonic spans`, () => {
      const disk = new DensitySpanRows();
      const accumulated: RemovedInteriorSpan[] = [
        { start: 800, end: 860, reason: 'rewound' },
        { start: 0, end: 30, reason: 'cleared' },
      ];
      const expected = mergeRemovedInteriorSpans([
        ...accumulated,
        ...Array.from({ length: size }, (_, index) => span(index)),
      ]).slice(-SPAN_WINDOW_CAPACITY);
      try {
        for (let index = 0; index < size; index++) disk.append(span(index));
        expect(disk.project(accumulated, [])).toStrictEqual(expected);
        expect(disk.metrics().diskEntries).toBe(size);
        expect(disk.metrics().peakResidentSpans).toBeLessThanOrEqual(
          SPAN_WINDOW_CAPACITY,
        );
      } finally {
        disk.close();
      }
    });
});
