/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fs from 'node:fs/promises';
import { parseChronologyBinding } from './chronologyBinding.js';
import {
  invalidateResponsesStatefulChain,
  type IContent,
} from '../services/history/IContent.js';
import type { JournalReadCounters } from './journalCounters.js';
import { ResolverDiskIndex, type IndexedRow } from './resolverDiskIndex.js';
import { ResolverIntervalIndex } from './resolverIntervalIndex.js';
import { field, validSeq, validRow, chronology } from './resolverProjection.js';
import {
  scanResolverLines,
  ResolverRowReader,
  type ProjectedLine,
} from './resolverScan.js';

export interface ResolverFileHandle {
  stat(): Promise<{ readonly size: number }>;
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<number>;
  close(): Promise<void>;
}
export interface ResolverIo {
  open(path: string, flags: string): Promise<ResolverFileHandle>;
}

const defaultResolverIo: ResolverIo = {
  open: async (path, flags) => {
    const handle = await fs.open(path, flags);
    return {
      stat: async () => ({ size: (await handle.stat()).size }),
      read: async (buffer, offset, length, position) =>
        (await handle.read(buffer, offset, length, position)).bytesRead,
      close: () => handle.close(),
    };
  },
};

export interface ResolverReplayObserver {
  line(line: ProjectedLine): void;
  malformed(type: unknown, payload: object, lineNumber: number): void;
  purge(frontier: unknown): void;
}
export interface JournalResolverOptions {
  readonly throughSeq?: number;
  readonly replayObserver?: ResolverReplayObserver;
  readonly chunkBytes?: number;
  readonly maxBytes?: number;
  readonly scratchRoot?: string;
  readonly io?: ResolverIo;
  readonly counters?: JournalReadCounters;
}
export interface ResolvedEntry {
  readonly seq: number;
  readonly offset: number;
  readonly length: number;
  readonly rowIndex: number;
  readonly content: IContent;
}
export interface SurvivorInterval {
  readonly fromSeq: number;
  readonly toSeq: number;
  readonly firstOffset: number;
  readonly rowCount: number;
}
export interface JournalResolverStats {
  readonly intervals: AsyncIterable<SurvivorInterval>;
  readonly resolvedRowCount: number;
  readonly skippedRecordCount: number;
}
export type ResolverStats = JournalResolverStats;

function isContent(value: unknown): value is IContent {
  return (
    ['human', 'ai', 'tool'].includes(String(field(value, 'speaker'))) &&
    Array.isArray(field(value, 'blocks'))
  );
}
function rowReference(
  content: unknown,
  seq: number,
  line: ProjectedLine,
  chron = chronology(content),
): IndexedRow {
  const start = field(content, 'start');
  const bytes = field(content, 'bytes');
  if (typeof start !== 'number' || typeof bytes !== 'number')
    throw new Error('Missing projected row byte range');
  return {
    seq,
    offset: line.offset,
    length: line.length,
    rowIndex: 0,
    start,
    bytes,
    chron,
    ...chronologyFields(content),
    purge: 0,
  };
}

function chronologyFields(
  content: unknown,
): Pick<IndexedRow, 'userTurn' | 'step' | 'recordedAt'> {
  const marker = field(field(content, 'metadata'), 'chronology');
  const userTurn = field(marker, 'userTurn');
  const step = field(marker, 'step');
  const recordedAt = field(marker, 'recordedAt');
  return {
    userTurn: typeof userTurn === 'number' ? userTurn : undefined,
    step: typeof step === 'number' ? step : undefined,
    recordedAt: typeof recordedAt === 'number' ? recordedAt : undefined,
  };
}

export class JournalResolver {
  private handle: ResolverFileHandle | null;
  private readonly units: ResolverDiskIndex;
  private activeInterval: ResolverIntervalIndex | null = null;
  private skippedRecordCount = 0;
  private prepassDone = false;
  private resolving = false;

  private constructor(
    handle: ResolverFileHandle,
    private readonly chunkBytes: number,
    private readonly counters?: JournalReadCounters,
    private readonly scratchRoot?: string,
    private readonly maxBytes?: number,
    private readonly throughSeq?: number,
    private readonly replayObserver?: ResolverReplayObserver,
  ) {
    this.units = new ResolverDiskIndex(scratchRoot);
    this.handle = handle;
  }

  static async open(
    filePath: string,
    options: JournalResolverOptions = {},
  ): Promise<JournalResolver> {
    const chunk = options.chunkBytes ?? 64 * 1024;
    if (!Number.isSafeInteger(chunk) || chunk <= 0)
      throw new RangeError('chunkBytes must be a positive safe integer');
    if (
      options.maxBytes !== undefined &&
      (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0)
    )
      throw new RangeError('Invalid resolver watermark');
    const handle = await (options.io ?? defaultResolverIo).open(filePath, 'r');
    try {
      return new JournalResolver(
        handle,
        Math.min(chunk, 64 * 1024),
        options.counters,
        options.scratchRoot,
        options.maxBytes,
        options.throughSeq,
        options.replayObserver,
      );
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  async *resolve(): AsyncIterable<ResolvedEntry> {
    if (this.resolving) throw new Error('Resolver iteration already active');
    this.resolving = true;
    let completed = false;
    try {
      if (!this.prepassDone) await this.runPrepass();
      const reader = new ResolverRowReader(
        this.assertOpen(),
        this.chunkBytes,
        this.maxBytes,
      );
      for (let index = 0; index < this.units.length; index += 1) {
        const unit = this.units.get(index);
        let content: unknown = await reader.read(unit.start, unit.bytes);
        this.counters?.recordDecoded();
        if (!isContent(content))
          throw new Error('Survivor no longer matches prepass validation');
        this.counters?.rowDecoded();
        const binding = parseChronologyBinding({
          rowIndex: index,
          chronology: {
            seq: unit.chron,
            userTurn: unit.userTurn,
            step: unit.step,
            recordedAt: unit.recordedAt,
          },
        });
        const markedContent =
          binding === null
            ? content
            : {
                ...content,
                metadata: {
                  ...content.metadata,
                  chronology: binding.chronology,
                },
              };

        const resolvedContent =
          unit.invalidateResponses === true
            ? invalidateResponsesStatefulChain([markedContent])[0]
            : markedContent;
        this.counters?.ownership?.retain(content);
        this.counters?.ownership?.retain(resolvedContent);
        try {
          yield {
            seq: unit.seq,
            offset: unit.offset,
            length: unit.length,
            rowIndex: unit.rowIndex,
            content: resolvedContent,
          };
        } finally {
          this.counters?.ownership?.release(content);
          this.counters?.ownership?.release(resolvedContent);
          content = null;
          this.counters?.rowReleased();
        }
      }
      completed = true;
    } finally {
      this.resolving = false;
      if (!completed) await this.close();
    }
  }

  metrics(): {
    readonly residentIndexBufferBytes: number;
    readonly indexFileBytes: number;
  } {
    return this.units.metrics();
  }

  async countRows(): Promise<number> {
    if (!this.prepassDone) await this.runPrepass();
    return this.units.length;
  }

  stats(): JournalResolverStats {
    return {
      intervals: {
        [Symbol.asyncIterator]: () =>
          this.deriveIntervals()[Symbol.asyncIterator](),
      },
      resolvedRowCount: this.units.length,
      skippedRecordCount: this.skippedRecordCount,
    };
  }

  async close(): Promise<void> {
    const handle = this.handle;
    this.handle = null;
    try {
      if (handle !== null) await handle.close();
    } finally {
      this.activeInterval?.close();
      this.activeInterval = null;
      this.units.close();
    }
  }

  private assertOpen(): ResolverFileHandle {
    if (this.handle === null) throw new Error('JournalResolver is closed');
    return this.handle;
  }

  private async runPrepass(): Promise<void> {
    const staged = new ResolverDiskIndex(this.scratchRoot);
    let lastInvalid = false;
    try {
      for await (const line of scanResolverLines(
        this.assertOpen(),
        this.chunkBytes,
        staged,
        this.maxBytes,
        this.replayObserver !== undefined,
      )) {
        this.replayObserver?.line(line);
        const seq = field(line.parsed, 'seq');
        if (
          validSeq(seq) &&
          this.throughSeq !== undefined &&
          seq > this.throughSeq
        )
          break;
        lastInvalid = line.invalid;
        this.absorb(line, staged);
      }
      if (lastInvalid) this.skippedRecordCount -= 1;
      this.prepassDone = true;
    } finally {
      staged.close();
    }
  }

  private absorb(line: ProjectedLine, staged: ResolverDiskIndex): void {
    if (line.invalid) {
      this.skippedRecordCount += 1;
      return;
    }
    if (line.blank || line.parsed === null) return;
    this.counters?.recordDecoded();
    const version = field(line.parsed, 'v');
    if (version !== 1 && version !== 2)
      throw new Error(
        `Unsupported recording version ${String(version)} at line ${line.lineNumber}`,
      );
    const seq = field(line.parsed, 'seq');
    const payload = field(line.parsed, 'payload');
    if (!validSeq(seq) || payload === null || typeof payload !== 'object') {
      this.skippedRecordCount += 1;
      return;
    }
    const type = field(line.parsed, 'type');
    if (!this.fold(type, payload, seq, line, staged)) {
      this.skippedRecordCount += 1;
      this.replayObserver?.malformed(type, payload, line.lineNumber);
    }
  }

  private fold(
    type: unknown,
    payload: object,
    seq: number,
    line: ProjectedLine,
    staged: ResolverDiskIndex,
  ): boolean {
    switch (type) {
      case 'chronology_bind': {
        const binding = parseChronologyBinding(payload);
        if (binding === null || binding.rowIndex >= this.units.length)
          return false;
        const content = field(payload, 'content');
        if (content !== undefined && !validRow(content)) return false;
        const row = this.units.get(binding.rowIndex);
        const replacement =
          content === undefined ? row : rowReference(content, seq, line);
        this.units.set(binding.rowIndex, {
          ...row,
          start: replacement.start,
          bytes: replacement.bytes,
          chron: binding.chronology.seq,
          userTurn: binding.chronology.userTurn,
          step: binding.chronology.step,
          recordedAt: binding.chronology.recordedAt,
          invalidateResponses:
            binding.invalidateResponses ?? row.invalidateResponses,
        });
        return true;
      }
      case 'content':
      case 'compressed': {
        const content = field(
          payload,
          type === 'content' ? 'content' : 'summary',
        );
        if (
          !validRow(content) ||
          (type === 'compressed' &&
            field(payload, 'itemsCompressed') === undefined)
        )
          return false;
        if (type === 'compressed') this.units.truncate(0);
        this.units.push(rowReference(content, seq, line));
        return true;
      }
      case 'semantic_media_purge':
        if (
          !line.projection.validPurge(
            field(payload, 'frontier'),
            field(payload, 'history'),
          )
        )
          return false;
        this.replayObserver?.purge(field(payload, 'frontier'));
        this.units.truncate(0);
        for (let index = 0; index < staged.length; index += 1)
          this.units.push({
            ...staged.get(index),
            seq,
            length: line.length,
            purge: 1,
          });
        return true;
      case 'rewind':
        return this.rewind(payload);
      case 'density_mutation':
        return this.density(payload, seq, line);
      case 'synthetic_insert':
        return this.insert(payload, seq, line);
      case 'compression_detail':
        return ['fromSeq', 'toSeq', 'itemsCompressed'].every(
          (key) => typeof field(payload, key) === 'number',
        );
      default:
        return true;
    }
  }

  private rewind(payload: object): boolean {
    const count = field(payload, 'itemsRemoved');
    if (typeof count !== 'number' || count < 0) return false;
    const cut = field(payload, 'cutSeq');
    if (validSeq(cut)) {
      for (let index = 0; index < this.units.length; index += 1) {
        if (this.units.get(index).chron === cut) {
          this.units.truncate(index);
          return true;
        }
      }
    }
    this.units.truncate(Math.max(0, this.units.length - Math.ceil(count)));
    return cut === undefined || validSeq(cut);
  }

  private density(payload: object, seq: number, line: ProjectedLine): boolean {
    const removed = field(payload, 'removedSeqs');
    const replacements = field(payload, 'replacements');
    if (
      !Array.isArray(removed) ||
      !removed.every(validSeq) ||
      !Array.isArray(replacements)
    )
      return false;
    const replacementBySeq = new Map<number, IndexedRow>();
    for (const entry of replacements) {
      const marker = field(entry, 'replacedSeq');
      const content = field(entry, 'replacement');
      if (!validSeq(marker) || !validRow(content)) return false;
      replacementBySeq.set(marker, rowReference(content, seq, line));
    }
    const dropped = new Set<number>(removed);
    let write = 0;
    for (let index = 0; index < this.units.length; index += 1) {
      const row = this.units.get(index);
      const replacement = replacementBySeq.get(row.chron);
      if (replacement !== undefined)
        this.units.set(write++, {
          ...row,
          start: replacement.start,
          bytes: replacement.bytes,
          invalidateResponses: false,
        });
      else if (!dropped.has(row.chron)) this.units.set(write++, row);
    }
    this.units.truncate(write);
    return true;
  }

  private insert(payload: object, seq: number, line: ProjectedLine): boolean {
    const content = field(payload, 'content');
    const chron = field(payload, 'chronologySeq');
    const after = field(payload, 'afterSeq');
    if (!validRow(content) || !validSeq(chron) || !validSeq(after))
      return false;
    for (let index = 0; index < this.units.length; index += 1) {
      const row = this.units.get(index);
      if (row.chron !== after) continue;
      this.units.insert(index + 1, rowReference(content, seq, line, chron));
      return true;
    }
    return false;
  }

  private appendInterval(
    intervals: ResolverIntervalIndex,
    row: IndexedRow,
    current: number,
  ): number {
    if (row.purge === 0 && current !== -1) {
      const previous = intervals.get(current);
      if (previous.toSeq + 1 === row.seq) {
        intervals.set(current, {
          ...previous,
          toSeq: row.seq,
          rowCount: previous.rowCount + 1,
        });
        return current;
      }
    }
    const next = intervals.length;
    intervals.push({
      fromSeq: row.seq,
      toSeq: row.seq,
      firstOffset: row.offset,
      rowCount: 1,
      purge: row.purge !== 0,
    });
    return row.purge !== 0 ? -1 : next;
  }

  private async *deriveIntervals(): AsyncIterable<SurvivorInterval> {
    if (!this.prepassDone) await this.runPrepass();
    this.assertOpen();
    if (this.activeInterval !== null)
      throw new Error('Resolver interval iteration already active');
    const intervals = new ResolverIntervalIndex(this.scratchRoot);
    this.activeInterval = intervals;
    try {
      let current = -1;
      for (let index = 0; index < this.units.length; index += 1)
        current = this.appendInterval(
          intervals,
          this.units.get(index),
          current,
        );
      intervals.sort();
      let pending: SurvivorInterval | undefined;
      let pendingPurge = false;
      for (let index = 0; index < intervals.length; index += 1) {
        const next = intervals.get(index);
        if (
          pending !== undefined &&
          pendingPurge &&
          next.purge &&
          pending.fromSeq === next.fromSeq
        ) {
          pending = { ...pending, rowCount: pending.rowCount + next.rowCount };
          continue;
        }
        if (pending !== undefined) yield pending;
        pending = {
          fromSeq: next.fromSeq,
          toSeq: next.toSeq,
          firstOffset: next.firstOffset,
          rowCount: next.rowCount,
        };
        pendingPurge = next.purge;
      }
      if (pending !== undefined) yield pending;
    } finally {
      this.activeInterval = null;
      intervals.close();
    }
  }
}
