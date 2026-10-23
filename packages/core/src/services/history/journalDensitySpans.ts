/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { PreparedGroup } from '../../journal/preparedGroup.js';
import { BoundedIdNodeCache } from '../../journal/idTrieCache.js';
import { mergeIdTrie } from '../../journal/idTrieMerge.js';
import { IdTrieReader } from '../../journal/idTrieReader.js';
import { compareIdHashes, type IdEntry } from '../../journal/idTrieNode.js';
import type { RemovedInteriorSpan } from './historyEventTypes.js';
import {
  encodeJournalSpanWindow,
  JOURNAL_SPAN_WINDOW,
} from './journalSpanWindow.js';
import { SPAN_WINDOW_CAPACITY } from './historySpanWindow.js';

interface OrderedSpan {
  readonly span: RemovedInteriorSpan;
  readonly priority: number;
}

const reasons: ReadonlyArray<RemovedInteriorSpan['reason']> = [
  'density-removed',
  'density-replaced',
  'rewound',
  'cleared',
  'compressed',
];

export class JournalDensitySpans {
  private pending: RemovedInteriorSpan[] = [];
  private root = 0;
  private ordinal = 0;
  private readonly cache = new BoundedIdNodeCache();
  private writtenBytes = 0;
  private peak = 0;

  constructor(private readonly group: PreparedGroup) {}

  async append(span: RemovedInteriorSpan): Promise<void> {
    if (this.pending.length === SPAN_WINDOW_CAPACITY) await this.writePending();
    this.pending.push(span);
    this.peak = Math.max(this.peak, this.pending.length);
  }

  private reader(): IdTrieReader {
    return new IdTrieReader(
      this.group.read(this.group.appender.nextOffset),
      this.cache,
    );
  }

  private encode(span: RemovedInteriorSpan): IdEntry {
    const key = new Uint8Array(16);
    const view = new DataView(key.buffer);
    view.setBigUint64(0, BigInt(span.start));
    view.setBigUint64(8, BigInt(this.ordinal++));
    key[8] = span.reason === 'density-removed' ? 0 : 1;
    const value = new Uint8Array(9);
    new DataView(value.buffer).setBigUint64(0, BigInt(span.end));
    value[8] = reasons.indexOf(span.reason);
    return { hash: key, value };
  }

  private async writePending(): Promise<void> {
    const entries = this.pending
      .map((span) => this.encode(span))
      .sort((left, right) => compareIdHashes(left.hash, right.hash));
    this.pending = [];
    await this.group.appender.drain();
    const before = this.group.appender.nextOffset;
    this.root = await mergeIdTrie(
      this.group.appender,
      this.reader(),
      this.root,
      entries,
    );
    this.writtenBytes += this.group.appender.nextOffset - before;
    await this.group.appender.drain();
  }

  private async *ordered(): AsyncGenerator<RemovedInteriorSpan> {
    const compare = (
      left: RemovedInteriorSpan,
      right: RemovedInteriorSpan,
    ): number => {
      const start = left.start - right.start;
      return start !== 0
        ? start
        : Number(left.reason !== 'density-removed') -
            Number(right.reason !== 'density-removed');
    };
    const sorted = [...this.pending].sort(compare);
    let index = 0;
    await this.group.appender.drain();
    for await (const entry of this.reader().entries(this.root)) {
      const span: RemovedInteriorSpan = {
        start: Number(
          new DataView(
            entry.hash.buffer,
            entry.hash.byteOffset,
            entry.hash.byteLength,
          ).getBigUint64(0),
        ),
        end: Number(
          new DataView(
            entry.value.buffer,
            entry.value.byteOffset,
            entry.value.byteLength,
          ).getBigUint64(0),
        ),
        reason: reasons[entry.value[8]],
      };
      while (index < sorted.length && compare(sorted[index], span) < 0)
        yield sorted[index++];
      yield span;
    }
    while (index < sorted.length) yield sorted[index++];
  }

  async project(
    accumulated: readonly RemovedInteriorSpan[],
    trailing: readonly RemovedInteriorSpan[],
  ): Promise<RemovedInteriorSpan[]> {
    const bounded: OrderedSpan[] = [
      ...accumulated.map((span) => ({ span, priority: 0 })),
      ...trailing.map((span) => ({ span, priority: 3 })),
    ].sort((a, b) => {
      const start = a.span.start - b.span.start;
      return start !== 0 ? start : a.priority - b.priority;
    });
    let index = 0;
    let current: RemovedInteriorSpan | undefined;
    const retained: RemovedInteriorSpan[] = [];
    const take = (span: RemovedInteriorSpan): void => {
      if (
        current !== undefined &&
        span.start <= current.end + 1 &&
        (span.reason === current.reason || span.start <= current.end)
      ) {
        current.end = Math.max(current.end, span.end);
      } else {
        current = { ...span };
        if (retained.length === SPAN_WINDOW_CAPACITY) retained.shift();
        retained.push(current);
      }
    };
    for await (const span of this.ordered()) {
      while (
        index < bounded.length &&
        (bounded[index].span.start < span.start ||
          (bounded[index].span.start === span.start &&
            bounded[index].priority === 0))
      )
        take(bounded[index++].span);
      take(span);
    }
    while (index < bounded.length) take(bounded[index++].span);
    this.peak = Math.max(this.peak, retained.length);
    return retained;
  }

  async retain(spans: readonly RemovedInteriorSpan[]): Promise<void> {
    if (spans.length > 0)
      await this.group.retainMetadata(
        JOURNAL_SPAN_WINDOW,
        encodeJournalSpanWindow(spans),
      );
  }

  metrics(): {
    privateBytes: number;
    peakResidentSpans: number;
    cacheBytes: number;
    cacheCap: number;
  } {
    return {
      privateBytes: this.writtenBytes,
      peakResidentSpans: this.peak,
      cacheBytes: this.cache.bytes,
      cacheCap: this.cache.capBytes,
    };
  }
}
