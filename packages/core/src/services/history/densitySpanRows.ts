/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { ResolverIntervalIndex } from '../../recording/resolverIntervalIndex.js';
import type { RemovedInteriorSpan } from './historyEventTypes.js';
import { SPAN_WINDOW_CAPACITY } from './historySpanWindow.js';
import { mergeRemovedInteriorSpans } from './contextRange.js';

const reasons: ReadonlyArray<RemovedInteriorSpan['reason']> = [
  'density-removed',
  'density-replaced',
  'rewound',
  'cleared',
  'compressed',
];

export class DensitySpanRows {
  private index: ResolverIntervalIndex | undefined;
  private peakResidentSpans = 0;
  private closed = false;

  private get rows(): ResolverIntervalIndex {
    this.index ??= new ResolverIntervalIndex();
    return this.index;
  }

  append(span: RemovedInteriorSpan): void {
    if (this.closed) throw new RangeError('Invalid interval index write');
    this.rows.push({
      fromSeq: span.start,
      toSeq: span.end,
      firstOffset: reasons.indexOf(span.reason),
      rowCount: 0,
      purge: false,
    });
  }
  private read(index: number): RemovedInteriorSpan {
    const entry = this.rows.get(index);
    const reason = reasons[entry.firstOffset];
    return { start: entry.fromSeq, end: entry.toSeq, reason };
  }
  project(
    accumulated: readonly RemovedInteriorSpan[],
    trailing: readonly RemovedInteriorSpan[],
  ): RemovedInteriorSpan[] {
    if (this.index === undefined) {
      const retained = mergeRemovedInteriorSpans([
        ...accumulated,
        ...trailing,
      ]).slice(-SPAN_WINDOW_CAPACITY);
      this.peakResidentSpans = Math.max(
        this.peakResidentSpans,
        retained.length,
      );
      return retained;
    }
    const sorted = new DensitySpanRows();
    try {
      for (const span of accumulated) sorted.append(span);
      this.appendOrderedTo(sorted);
      for (const span of trailing) sorted.append(span);
      sorted.rows.sort();
      return this.merge(sorted);
    } finally {
      sorted.close();
    }
  }
  private appendOrderedTo(target: DensitySpanRows): void {
    for (const removed of [true, false])
      for (let index = 0; index < this.rows.length; index++) {
        const span = this.read(index);
        if ((span.reason === 'density-removed') === removed)
          target.append(span);
      }
  }
  private merge(sorted: DensitySpanRows): RemovedInteriorSpan[] {
    const retained: RemovedInteriorSpan[] = [];
    let current: RemovedInteriorSpan | undefined;
    for (let index = 0; index < sorted.rows.length; index++) {
      const span = sorted.read(index);
      if (
        current !== undefined &&
        span.start <= current.end + 1 &&
        (span.reason === current.reason || span.start <= current.end)
      )
        current.end = Math.max(current.end, span.end);
      else {
        current = { ...span };
        if (retained.length === SPAN_WINDOW_CAPACITY) retained.shift();
        retained.push(current);
        this.peakResidentSpans = Math.max(
          this.peakResidentSpans,
          retained.length,
        );
      }
    }
    return retained;
  }
  metrics(): { diskEntries: number; peakResidentSpans: number } {
    return {
      diskEntries: this.index?.length ?? 0,
      peakResidentSpans: this.peakResidentSpans,
    };
  }
  close(): void {
    this.closed = true;
    this.index?.close();
  }
}
