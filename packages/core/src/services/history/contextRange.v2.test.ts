/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @plan PLAN-20260917-ISSUE854.P03
 * @requirement G3,G4
 * Behavioral tests for the context-range v2 membership projection:
 * removed-interior seq spans carrying a reason, interval semantics
 * (inclusive spans, same-reason coalescing, no overlap), the approximate
 * flag for unmarked legacy history, and the first-entry
 * contextRangeChanged contract fix. Every scenario drives a real
 * HistoryService or the pure computeContextRange derivation.
 */

import { describe, expect, it } from 'bun:test';
import type { IContent } from './IContent.js';
import type { ContextRange, RemovedInteriorSpan } from './historyEventTypes.js';
import { computeContextRange } from './contextRange.js';
import { HistoryService } from './HistoryService.js';
import type {
  DensityResult,
  DensityResultMetadata,
} from '../../core/compression/types.js';

function textContent(speaker: 'human' | 'ai', text: string): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

function seqOf(service: HistoryService, positionFromEnd: number): number {
  const entries = service.getRecent(positionFromEnd + 1);
  const index = entries.length - 1 - positionFromEnd;
  const entry = index >= 0 ? entries[index] : undefined;
  if (entry === undefined) {
    throw new Error('expected a history entry');
  }
  const seq = entry.metadata?.chronology?.seq;
  if (seq === undefined) {
    throw new Error('expected a chronology seq');
  }
  return seq;
}

function makeMetadata(
  overrides: Partial<DensityResultMetadata> = {},
): DensityResultMetadata {
  return {
    readWritePairsPruned: 0,
    fileDeduplicationsPruned: 0,
    recencyPruned: 0,
    ...overrides,
  };
}

function makeDensityResult(
  removals: number[],
  replacements: Map<number, IContent>,
): DensityResult {
  return { removals, replacements, metadata: makeMetadata() };
}

/** Compression summary shaped like the ones transformAll-based tests build. */
function summaryEntry(
  seq: number,
  replacedFromSeq: number,
  replacedToSeq: number,
  text: string,
): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
    metadata: {
      chronology: { seq, userTurn: 1, step: 1, recordedAt: 0 },
      chronologyReplaced: {
        fromSeq: replacedFromSeq,
        toSeq: replacedToSeq,
        itemCount: replacedToSeq - replacedFromSeq + 1,
      },
    },
  };
}

function captureRanges(service: HistoryService): ContextRange[] {
  const events: ContextRange[] = [];
  service.on('contextRangeChanged', (range) => {
    events.push(range);
  });
  return events;
}

function lastRangeOf(events: ContextRange[]): ContextRange {
  const range = events.length > 0 ? events[events.length - 1] : undefined;
  if (range === undefined) {
    throw new Error('expected a contextRangeChanged event');
  }
  return range;
}

/**
 * Membership intervals are [start,end] inclusive over chronology seq, sorted
 * by start, and can never overlap (adjacent same-reason spans must have been
 * coalesced by the producer).
 */
function expectWellFormedInterior(range: ContextRange): void {
  const spans: readonly RemovedInteriorSpan[] = range.removedInterior;
  for (let index = 0; index < spans.length; index++) {
    const span = index < spans.length ? spans[index] : undefined;
    if (span === undefined) {
      throw new Error(`expected a removed-interior span at ${index}`);
    }
    expect(span.start).toBeLessThanOrEqual(span.end);
    if (index === 0) {
      continue;
    }
    const previous = index - 1 < spans.length ? spans[index - 1] : undefined;
    if (previous === undefined) {
      throw new Error('expected a preceding removed-interior span');
    }
    expect(previous.end).toBeLessThan(span.start);
  }
}

describe('HistoryService context range v2', () => {
  it('emits contextRangeChanged once when the first entry lands in an empty history', () => {
    const service = new HistoryService();
    const events = captureRanges(service);
    service.add(textContent('human', 'one'));
    expect(events).toHaveLength(1);
    const range = lastRangeOf(events);
    expect(range.firstSeq).toBe(seqOf(service, 0));
    expect(range.lastSeq).toBe(seqOf(service, 0));
    expect(range.totalEntries).toBe(1);
    expect(range.removedInterior).toStrictEqual([]);
    expect(range.approximate).toBe(false);
    service.add(textContent('ai', 'two'));
    expect(events).toHaveLength(1);
  });

  it('reports the compressed interior span between preserved head and tail', async () => {
    const service = new HistoryService();
    for (const text of [
      'one',
      'two',
      'three',
      'four',
      'five',
      'six',
      'seven',
    ]) {
      service.add(textContent('human', text));
    }
    const events = captureRanges(service);
    await service.transformAll((contents) => [
      ...contents.slice(0, 2),
      summaryEntry(99, 3, 5, 'summary of three through five'),
      ...contents.slice(5),
    ]);
    expect(events).toHaveLength(1);
    const range = lastRangeOf(events);
    expect(range.firstSeq).toBe(seqOf(service, 4));
    expect(range.lastSeq).toBe(seqOf(service, 0));
    expect(range.totalEntries).toBe(5);
    expect(range.removedInterior).toStrictEqual([
      { start: 3, end: 5, reason: 'compressed' },
    ]);
    expect(range.approximate).toBe(false);
    expectWellFormedInterior(range);
  });

  it('reports density-replaced and density-removed spans with their seqs', async () => {
    const service = new HistoryService();
    for (const text of ['one', 'two', 'three', 'four', 'five']) {
      service.add(textContent('human', text));
    }
    await service.waitForTokenUpdates();
    const events = captureRanges(service);
    await service.applyDensityResult(
      makeDensityResult([3], new Map([[1, textContent('human', 'dense-two')]])),
    );
    expect(events).toHaveLength(1);
    const range = lastRangeOf(events);
    expect(range.totalEntries).toBe(4);
    expect(range.removedInterior).toStrictEqual([
      { start: 2, end: 2, reason: 'density-replaced' },
      { start: 4, end: 4, reason: 'density-removed' },
    ]);
    expectWellFormedInterior(range);
  });

  it('coalesces adjacent same-reason spans and keeps different reasons separate', async () => {
    const service = new HistoryService();
    for (const text of ['one', 'two', 'three', 'four', 'five']) {
      service.add(textContent('human', text));
    }
    await service.waitForTokenUpdates();
    const events = captureRanges(service);
    await service.applyDensityResult(
      makeDensityResult(
        [1, 2],
        new Map([
          [3, textContent('human', 'dense-four')],
          [4, textContent('human', 'dense-five')],
        ]),
      ),
    );
    const range = lastRangeOf(events);
    expect(range.totalEntries).toBe(3);
    expect(range.removedInterior).toStrictEqual([
      { start: 2, end: 3, reason: 'density-removed' },
      { start: 4, end: 5, reason: 'density-replaced' },
    ]);
    expectWellFormedInterior(range);
  });

  it('reports a rewound span when the history is truncated to a seq prefix', async () => {
    const service = new HistoryService();
    for (const text of ['one', 'two', 'three', 'four', 'five']) {
      service.add(textContent('human', text));
    }
    const events = captureRanges(service);
    // In-memory rewind shape: a strict seq-prefix truncation through the
    // batch-commit path; P05 journals it as a durable rewind op.
    await service.transformAll((contents) => contents.slice(0, 3));
    expect(events).toHaveLength(1);
    const range = lastRangeOf(events);
    expect(range.firstSeq).toBe(seqOf(service, 2));
    expect(range.lastSeq).toBe(seqOf(service, 0));
    expect(range.totalEntries).toBe(3);
    expect(range.removedInterior).toStrictEqual([
      { start: 4, end: 5, reason: 'rewound' },
    ]);
    expect(range.approximate).toBe(false);
    expectWellFormedInterior(range);
  });

  it('reports the full span as cleared on clear', () => {
    const service = new HistoryService();
    for (const text of ['one', 'two', 'three']) {
      service.add(textContent('human', text));
    }
    const events = captureRanges(service);
    service.clear();
    expect(events).toHaveLength(1);
    expect(lastRangeOf(events)).toStrictEqual({
      firstSeq: 0,
      lastSeq: 0,
      totalEntries: 0,
      removedInterior: [{ start: 1, end: 3, reason: 'cleared' }],
      approximate: false,
    });
  });

  it('keeps compressed and density spans disjoint and ordered, and the snapshot matches the last event', async () => {
    const service = new HistoryService();
    for (const text of [
      'one',
      'two',
      'three',
      'four',
      'five',
      'six',
      'seven',
    ]) {
      service.add(textContent('human', text));
    }
    const events = captureRanges(service);
    await service.transformAll((contents) => [
      ...contents.slice(0, 2),
      summaryEntry(99, 3, 5, 'summary of three through five'),
      ...contents.slice(5),
    ]);
    await service.waitForTokenUpdates();
    // After the compression the tail row with seq 6 sits at index 3.
    await service.applyDensityResult(
      makeDensityResult([], new Map([[3, textContent('human', 'dense-six')]])),
    );
    const range = lastRangeOf(events);
    expect(range.removedInterior).toStrictEqual([
      { start: 3, end: 5, reason: 'compressed' },
      { start: 6, end: 6, reason: 'density-replaced' },
    ]);
    expectWellFormedInterior(range);
    expect(service.getContextRange()).toStrictEqual(range);
  });

  it('derives compressed spans purely from chronologyReplaced metadata', () => {
    const head = textContent('human', 'one');
    head.metadata = {
      chronology: { seq: 1, userTurn: 1, step: 1, recordedAt: 0 },
    };
    const tail = textContent('human', 'six');
    tail.metadata = {
      chronology: { seq: 6, userTurn: 1, step: 1, recordedAt: 0 },
    };
    const range = computeContextRange([
      head,
      summaryEntry(98, 2, 5, 'summary of two through five'),
      tail,
    ]);
    expect(range.totalEntries).toBe(3);
    expect(range.firstSeq).toBe(1);
    expect(range.lastSeq).toBe(6);
    expect(range.removedInterior).toStrictEqual([
      { start: 2, end: 5, reason: 'compressed' },
    ]);
    expect(range.approximate).toBe(false);
  });

  it('flags membership approximate for unmarked legacy entries', () => {
    const range = computeContextRange([
      textContent('human', 'legacy one'),
      textContent('ai', 'legacy two'),
      textContent('human', 'legacy three'),
    ]);
    expect(range.totalEntries).toBe(3);
    expect(range.removedInterior).toStrictEqual([]);
    expect(range.approximate).toBe(true);
  });

  it('reports an empty range with empty interior and exact membership', () => {
    expect(computeContextRange([])).toStrictEqual({
      firstSeq: 0,
      lastSeq: 0,
      totalEntries: 0,
      removedInterior: [],
      approximate: false,
    });
  });
});
