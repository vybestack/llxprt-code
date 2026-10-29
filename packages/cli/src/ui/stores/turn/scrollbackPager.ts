/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Buffer } from 'node:buffer';
import {
  type IContent,
  type JournalReadCounters,
  type JournalCommitWatermark,
} from '@vybestack/llxprt-code-core';
import type {
  ScrollbackViewportReporter,
  ScrollbackPagerSettings,
  ScrollbackPagerOptions,
  ScrollbackRow,
  ScrollbackPagerState,
  ScrollbackPagerMetrics,
  ScrollbackResumeSummary,
  ScrollbackPagerStore,
} from './scrollback-pager-types.js';
export type {
  ScrollbackViewportReporter,
  ScrollbackPagerSettings,
  ScrollbackPagerOptions,
  ScrollbackRow,
  ScrollbackPagerState,
  ScrollbackPagerMetrics,
  ScrollbackResumeSummary,
  ScrollbackPagerStore,
} from './scrollback-pager-types.js';
import { NativeJournalCursor } from './native-journal-cursor.js';
import { JournalPagerSubscription } from './journal-pager-subscription.js';
import type { NativeDisplayEntry as JournalEntry } from './native-journal-types.js';
import type { HistoryItem } from '../../types.js';

import { rowIdentityKey, type RowIdentity } from '../../utils/rowIdentity.js';

type BoundaryEntry = Extract<JournalEntry, { kind: 'boundary' }>;

interface ContextWindow {
  firstSeq: number;
  lastSeq: number;
}

let rowItemIdCounter = 0;

function nextRowItemId(): number {
  rowItemIdCounter += 1;
  return rowItemIdCounter;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isIContent(value: unknown): value is IContent {
  if (!isRecord(value)) return false;
  const speaker = value['speaker'];
  if (speaker !== 'human' && speaker !== 'ai' && speaker !== 'tool') {
    return false;
  }
  return Array.isArray(value['blocks']);
}

function readSummaryContent(payload: unknown): IContent | null {
  if (!isRecord(payload)) return null;
  const summary = payload['summary'];
  return isIContent(summary) ? summary : null;
}

function contentText(content: IContent): string {
  const parts: string[] = [];
  for (const block of content.blocks) {
    if (block.type === 'text') {
      parts.push(block.text);
    }
  }
  return parts.join('\n');
}

function compressedBoundaryText(payload: unknown): string {
  const summary = readSummaryContent(payload);
  const summaryText = summary === null ? '' : contentText(summary).trim();
  return summaryText.length > 0
    ? `[compressed] ${summaryText}`
    : '[compressed]';
}

interface BackPageCollect {
  added: number;
}

/** Consumes one page's entries (newest first) into `collected`. */
function collectBackPage(
  entries: readonly JournalEntry[],
  collected: JournalEntry[],
): BackPageCollect {
  let added = 0;
  for (const entry of entries) {
    collected.push(entry);
    added += 1;
  }
  return { added };
}

/** Appends one forward page (oldest first) in walk order. */
function pushForwardPage(
  entries: readonly JournalEntry[],
  collected: JournalEntry[],
): number {
  let added = 0;
  for (const entry of entries) {
    collected.push(entry);
    added += 1;
  }
  return added;
}

/** Floor scalars the cursor tracks while projecting: the newest full clear and the oldest display row. */
interface ResumeFloorOffsets {
  boundaryOffset: number | null;
  firstDisplayOffset: number | null;
}

function entryToRow(entry: JournalEntry): ScrollbackRow {
  if (entry.kind === 'boundary') return compressedBoundaryRow(entry);
  const identity = entry.item.rowIdentity;
  if (!identity) throw new Error('Missing projected identity');
  return {
    key: rowIdentityKey(identity),
    seq: entry.seq,
    contextState: entry.contextState,
    identity,
    offset: entry.offset,
    item: entry.item,
  };
}

function compressedBoundaryRow(entry: BoundaryEntry): ScrollbackRow {
  const identity: RowIdentity = {
    kind: 'journal',
    offset: entry.offset,
    transcriptId: entry.transcriptId,
    discriminator: 'summaryRow',
  };
  return {
    key: rowIdentityKey(identity),
    seq: entry.seq,
    contextState: entry.contextState,
    identity,
    offset: entry.offset,
    item: {
      id: nextRowItemId(),
      type: 'info',
      text: compressedBoundaryText(entry.envelope.payload),
    },
  };
}

function estimateRowBytes(item: HistoryItem): number {
  try {
    return Buffer.byteLength(JSON.stringify(item), 'utf8');
  } catch {
    return 0;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Min/max seq across rows; null when no row carries a seq. */
function seqWatermarks(rows: readonly ScrollbackRow[]): {
  headSeq: number | null;
  tailSeq: number | null;
} {
  let headSeq: number | null = null;
  let tailSeq: number | null = null;
  for (const row of rows) {
    if (row.seq === null) continue;
    if (headSeq === null || row.seq < headSeq) headSeq = row.seq;
    if (tailSeq === null || row.seq > tailSeq) tailSeq = row.seq;
  }
  return { headSeq, tailSeq };
}

class ScrollbackPagerStoreImpl implements ScrollbackPagerStore {
  private readonly filePath: string;
  private readonly viewport: ScrollbackViewportReporter;
  private readonly pageRows: number;
  private readonly settings: ScrollbackPagerSettings;
  private readonly chunkBytes: number | undefined;
  private readonly counters: JournalReadCounters | undefined;

  private readonly subscription: JournalPagerSubscription;
  private publishedEnd: number | undefined;
  private watermark: JournalCommitWatermark | undefined;
  private orphanBeforeTranscriptId: bigint | undefined;
  private resumed = false;
  private cursor: NativeJournalCursor | null = null;
  private openPromise: Promise<NativeJournalCursor | null> | null = null;
  private openGeneration = -1;
  private controller = new AbortController();
  private closed = false;
  private generation = 0;
  private inFlightBackReads = 0;
  /**
   * Page calls run one at a time in issue order: concurrent callers would
   * otherwise walk the same cursor page twice and each prepend/append it,
   * duplicating resident rows. The queue never rejects, so one failed page
   * cannot stall the callers behind it.
   */
  private pageQueue: Promise<void> = Promise.resolve();
  private residentPagedRows: ScrollbackRow[] = [];
  private get pagedRows(): ScrollbackRow[] {
    return this.residentPagedRows;
  }

  private set pagedRows(next: ScrollbackRow[]) {
    const ownership = this.counters?.ownership;
    if (ownership) {
      for (const row of next) ownership.retain(row.item);
      for (const row of this.residentPagedRows) ownership.release(row.item);
    }
    this.residentPagedRows = next;
  }

  private hasNewOutput = false;
  private atVisibilityFloor = false;
  private atFileEnd = false;
  private error: string | null = null;
  private contextWindow: ContextWindow | null = null;
  private visibleKeys: readonly string[] = [];
  private purgeTimer: ReturnType<typeof setTimeout> | null = null;
  private purgeDirection: 'older' | 'newer' = 'older';
  /**
   * Offset of the oldest display row in the journal, recorded by
   * resumeFromJournal. When a backward walk's head rests exactly there,
   * every unconsumed line below is non-display (session header) and the
   * visibility floor is reached without an extra empty-page read. Null
   * when no resume ran, which keeps pageBack's floor behavior unchanged.
   */
  private resumeFirstDisplayOffset: number | null = null;

  constructor(private readonly options: ScrollbackPagerOptions) {
    if (!options.filePath.endsWith('.llxj'))
      throw new Error('Scrollback requires a .llxj session journal');
    this.filePath = options.filePath;
    this.viewport = options.viewport;
    this.pageRows = options.pageRows;
    this.settings = options.settings;
    this.chunkBytes = options.chunkBytes;
    this.counters = options.counters;
    this.orphanBeforeTranscriptId = options.orphanBeforeTranscriptId;
    this.subscription = new JournalPagerSubscription(
      this.filePath,
      (watermark) => this.refreshCommitted(watermark),
      (error) => {
        this.error = errorMessage(error);
      },
    );
  }

  private async refreshCommitted(
    watermark: JournalCommitWatermark,
  ): Promise<void> {
    this.publishedEnd = watermark.durableEnd;
    this.watermark = watermark;
    if (!this.resumed) return;
    const tail = this.pagedRows.at(-1);
    const following =
      this.viewport.followingTail ??
      (this.visibleKeys.length === 0 || this.visibleKeys.at(-1) === tail?.key);
    this.atFileEnd = false;
    if (!following) {
      this.hasNewOutput = true;
      return;
    }
    const gen = this.generation;
    const run = this.pageQueue.then(async () => {
      const cursor = await this.ensureCursor(gen);
      if (cursor === null || this.isStale(gen)) return;
      await cursor.refreshFileEnd(watermark.durableEnd);
      await this.runPageForward(gen);
    });
    this.pageQueue = run.then(
      () => undefined,
      () => undefined,
    );
    await run;
    this.publish();
  }

  private readonly listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(): void {
    for (const listener of this.listeners) listener();
  }

  getState(): ScrollbackPagerState {
    return {
      rows: this.pagedRows,
      loadingOlder: this.inFlightBackReads > 0,
      atVisibilityFloor: this.atVisibilityFloor,
      atFileEnd: this.atFileEnd,
      hasNewOutput: this.hasNewOutput,
      generation: this.generation,
      error: this.error,
    };
  }

  async pageBack(): Promise<void> {
    this.inFlightBackReads += 1;
    // The generation is captured at call time, not when the queued body
    // runs: a read is keyed to the generation it was issued under, so an
    // invalidate() that lands while the call waits in the queue still
    // discards it whole.
    const gen = this.generation;
    const run = this.pageQueue.then(() => this.runPageBack(gen));
    this.pageQueue = run.then(
      () => undefined,
      () => undefined,
    );
    try {
      await run;
    } finally {
      this.inFlightBackReads -= 1;
      this.publish();
    }
  }

  async pageForward(): Promise<void> {
    const gen = this.generation;
    const run = this.pageQueue.then(() => this.runPageForward(gen));
    this.pageQueue = run.then(
      () => undefined,
      () => undefined,
    );
    await run;
    this.publish();
  }

  /**
   * Boot-time resume (P04b): seeds the resident window with the journal's
   * LAST PAGE under the pageRows budget and captures the floor/tail scalars.
   * Rows seed through the ordinary collectBack path on the store cursor,
   * which stays open for subsequent paging; the scalars come from a
   * generation-guarded probe cursor that walks to the visibility floor.
   * Serialized through the page queue so a concurrent pageBack cannot
   * interleave with seeding.
   */
  async resumeFromJournal(): Promise<ScrollbackResumeSummary> {
    this.inFlightBackReads += 1;
    const gen = this.generation;
    const run = this.pageQueue.then(() => this.runResumeFromJournal(gen));
    this.pageQueue = run.then(
      () => undefined,
      () => undefined,
    );
    try {
      const summary = await run;
      this.resumed = true;
      if (this.watermark !== undefined)
        await this.refreshCommitted(this.watermark);
      return summary;
    } catch (error) {
      if (!this.isStale(gen)) {
        this.error = errorMessage(error);
      }
      throw error;
    } finally {
      this.inFlightBackReads -= 1;
      this.publish();
    }
  }

  private async runPageBack(gen: number): Promise<void> {
    if (this.closed || this.atVisibilityFloor) return;
    try {
      const cursor = await this.ensureCursor(gen);
      if (cursor === null || this.isStale(gen)) return;
      const { collected, exhausted } = await this.collectBack(cursor, gen);
      if (this.isStale(gen)) return;
      await cursor.refreshFileEnd(this.publishedEnd);
      if (this.isStale(gen)) return;
      this.absorbBack(collected);
      if (exhausted || this.isResumeFloor(cursor)) {
        this.atVisibilityFloor = true;
      }
      this.atFileEnd = cursor.windowEnd() >= cursor.size();
      this.error = null;
    } catch (error) {
      if (!this.isStale(gen)) {
        this.error = errorMessage(error);
      }
    }
  }

  private async runPageForward(gen: number): Promise<void> {
    if (this.closed) return;
    try {
      const cursor = await this.ensureCursor(gen);
      if (cursor === null || this.isStale(gen)) return;
      const collected: JournalEntry[] = [];
      let contentCount = 0;
      let atFileEnd = false;
      let stale = false;
      while (contentCount < this.pageRows && !atFileEnd && !stale) {
        const page = await cursor.pageForward(this.pageRows);
        if (this.isStale(gen)) {
          stale = true;
        } else if (page.entries.length === 0) {
          atFileEnd = true;
        } else {
          contentCount += pushForwardPage(page.entries, collected);
          atFileEnd = cursor.windowEnd() >= cursor.size();
        }
      }
      if (stale || this.isStale(gen)) return;
      this.absorbForward(collected);
      this.atFileEnd = cursor.windowEnd() >= cursor.size();
      if (this.atFileEnd) this.hasNewOutput = false;
      this.error = null;
    } catch (error) {
      if (!this.isStale(gen)) {
        this.error = errorMessage(error);
      }
    }
  }

  /**
   * Seeds the resident window with the journal's last page and captures the
   * resume scalars. The floor scalars come from a probe cursor (the store
   * cursor must keep its backward head at the seeded page boundary so later
   * pageBack calls pull exactly the rows older than the seeded page); the
   * rows themselves seed through the ordinary collectBack path. Every step
   * is abandoned whole when the generation goes stale.
   */
  private async runResumeFromJournal(
    gen: number,
  ): Promise<ScrollbackResumeSummary> {
    const cursor = await this.ensureCursor(gen);
    if (cursor === null || this.isStale(gen)) {
      throw new Error('scrollback resume failed: journal cursor unavailable');
    }
    const floor: ResumeFloorOffsets = {
      boundaryOffset: cursor.clearBoundaryOffset(),
      firstDisplayOffset: cursor.firstDisplayOffset(),
    };
    const { collected, exhausted } = await this.collectBack(cursor, gen);
    if (this.isStale(gen)) {
      throw new Error('scrollback resume aborted: store generation changed');
    }
    const seeded: ScrollbackRow[] = [];
    for (let i = collected.length - 1; i >= 0; i -= 1) {
      const row = entryToRow(collected[i]);
      seeded.push(row);
    }
    this.pagedRows = seeded;
    this.resumeFirstDisplayOffset = floor.firstDisplayOffset;
    this.atVisibilityFloor = exhausted || this.isResumeFloor(cursor);
    this.atFileEnd = cursor.windowEnd() >= cursor.size();
    this.error = null;
    const { headSeq, tailSeq } = seqWatermarks(seeded);
    return {
      seededRows: seeded.length,
      floorOffset: floor.boundaryOffset ?? 0,
      tailOffset: cursor.windowEnd(),
      headSeq,
      tailSeq,
      atClearBoundary: floor.boundaryOffset !== null,
    };
  }

  /**
   * Floor test for a backward walk head position: the data start, or —
   * after a resume — the oldest display row's offset recorded by
   * resumeFromJournal. Null keeps the pre-resume behavior (exhausted read
   * or data start) untouched.
   */
  private isResumeFloor(cursor: NativeJournalCursor): boolean {
    return (
      cursor.atStart() ||
      (this.resumeFirstDisplayOffset !== null &&
        cursor.atFirstPageAtOffset(this.resumeFirstDisplayOffset))
    );
  }

  async invalidate(): Promise<void> {
    if (this.closed) return;
    this.generation += 1;
    this.controller.abort();
    this.controller = new AbortController();
    this.pagedRows = [];
    this.hasNewOutput = false;
    this.atVisibilityFloor = false;
    this.atFileEnd = false;
    this.error = null;
    this.resumeFirstDisplayOffset = null;
    this.publishedEnd = undefined;
    this.watermark = undefined;
    this.clearPurgeTimer();
    await this.dropCursor();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.subscription.close();
    this.listeners.clear();
    this.generation += 1;
    this.controller.abort();
    this.controller = new AbortController();
    this.clearPurgeTimer();
    this.pagedRows = [];
    await this.dropCursor();
  }

  reportViewport(): void {
    this.visibleKeys = [...this.viewport.visibleKeys];
    this.evictSubContext();
  }

  /**
   * Schedules the residency flush on a reset debounce: repeated pageOut
   * calls push the flush back, so a burst coalesces into a single purge
   * once scrolling has been stopped for purgeDebounceMs.
   */
  pageOut(direction: 'older' | 'newer'): void {
    if (this.closed) return;
    this.clearPurgeTimer();
    this.purgeDirection = direction;
    if (this.settings.purgeDebounceMs === 0) {
      this.flushPurge();
      return;
    }
    this.purgeTimer = setTimeout(() => {
      this.purgeTimer = null;
      this.flushPurge();
    }, this.settings.purgeDebounceMs);
  }

  setContextWindow(window: { firstSeq: number; lastSeq: number }): void {
    this.contextWindow = { ...window };
    this.evictSubContext();
  }

  metrics(): ScrollbackPagerMetrics {
    const rows = this.getState().rows;
    let residentBytes = 0;
    for (const row of rows) {
      residentBytes += estimateRowBytes(row.item);
    }
    return { residentBytes, residentRows: rows.length };
  }

  private clearPurgeTimer(): void {
    if (this.purgeTimer !== null) {
      clearTimeout(this.purgeTimer);
      this.purgeTimer = null;
    }
  }

  /** Off-screen margin height in rows (§3: viewport ± margin viewports). */
  private marginRows(): number {
    return (
      this.settings.marginViewports *
      this.viewport.viewportLines *
      this.viewport.rowHeightLines()
    );
  }

  private visibleSet(): ReadonlySet<string> {
    return new Set(this.visibleKeys);
  }

  /** Display-row range, including distinct pages sharing a chronology span. */
  private visibleRowRange(): { oldest: number | null; newest: number | null } {
    const visible = this.visibleSet();
    let oldest: number | null = null;
    let newest: number | null = null;
    for (let index = 0; index < this.pagedRows.length; index += 1) {
      if (!visible.has(this.pagedRows[index].key)) continue;
      oldest ??= index;
      newest = index;
    }
    return { oldest, newest };
  }

  /**
   * At-bottom rule (§3): anything below the context window start leaves
   * immediately unless it is visible. Runs synchronously from
   * reportViewport/setContextWindow; visible rows are never candidates.
   */
  private evictSubContext(): void {
    const ctx = this.contextWindow;
    if (ctx === null) return;
    const visible = this.visibleSet();
    const previousCount = this.pagedRows.length;
    this.pagedRows = this.pagedRows.filter(
      (row) =>
        row.seq === null || row.seq >= ctx.firstSeq || visible.has(row.key),
    );
    if (this.pagedRows.length !== previousCount)
      this.retainCursorWindow('older');
  }

  private flushPurge(): void {
    if (this.closed) return;
    this.evictSubContext();
    this.evictFarEnd(this.purgeDirection);
    this.publish();
  }

  /**
   * Hard budget (§3): evict beyond-window rows from the far off-screen end,
   * down to the byte floor. With no viewport reported, every non-visible
   * paged row counts as off-screen. A floor of Infinity disables the byte
   * limit (beyond-window rows all evict); a visible row is never a
   * candidate regardless of its size (oversized-visible-row guarantee).
   */
  private evictFarEnd(direction: 'older' | 'newer'): void {
    const visible = this.visibleSet();
    const margin = this.marginRows();
    const { oldest, newest } = this.visibleRowRange();
    let limit = Number.POSITIVE_INFINITY;
    if (direction === 'newer') {
      limit = newest === null ? Number.NEGATIVE_INFINITY : newest + margin;
    } else if (oldest !== null) {
      limit = oldest - margin;
    }
    const candidates = this.pagedRows.filter(
      (row, index) =>
        !visible.has(row.key) &&
        (direction === 'older' ? index < limit : index > limit),
    );
    if (candidates.length === 0) return;
    if (direction === 'newer') candidates.reverse();
    const byteFloor = this.settings.byteFloorBytes;
    let residentBytes = this.metrics().residentBytes;
    const evicted = new Set<string>();
    for (const row of candidates) {
      if (Number.isFinite(byteFloor) && residentBytes <= byteFloor) break;
      evicted.add(row.key);
      residentBytes -= estimateRowBytes(row.item);
    }
    if (evicted.size === 0) return;
    this.pagedRows = this.pagedRows.filter((row) => !evicted.has(row.key));
    this.retainCursorWindow(direction);
  }

  private retainCursorWindow(direction: 'older' | 'newer'): void {
    this.cursor?.retainWindow(
      this.pagedRows.map((row) => row.key),
      direction,
    );
    this.atVisibilityFloor =
      this.cursor !== null && this.isResumeFloor(this.cursor);
    this.atFileEnd =
      this.cursor !== null && this.cursor.windowEnd() >= this.cursor.size();
  }

  private isStale(gen: number): boolean {
    return this.closed || gen !== this.generation;
  }

  /**
   * Pages back until `pageRows` display rows are collected or the walk ends.
   * Compression summaries consume the same budget as content rows; a rewind
   * boundary ends the walk and everything from it onward is dropped.
   */
  private async collectBack(
    cursor: NativeJournalCursor,
    gen: number,
  ): Promise<{ collected: JournalEntry[]; exhausted: boolean }> {
    const collected: JournalEntry[] = [];
    let exhausted = false;
    let contentCount = 0;
    let stale = false;
    while (contentCount < this.pageRows && !exhausted && !stale) {
      const page = await cursor.pageBack(this.pageRows);
      if (this.isStale(gen)) {
        stale = true;
      } else if (page.entries.length === 0) {
        exhausted = true;
      } else {
        contentCount += collectBackPage(page.entries, collected).added;
      }
    }
    return { collected, exhausted: exhausted || stale };
  }

  private absorbBack(entries: readonly JournalEntry[]): void {
    const rows: ScrollbackRow[] = [];
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const row = entryToRow(entries[i]);
      rows.push(row);
    }
    this.pagedRows = [...rows, ...this.pagedRows];
    this.retainCursorWindow('older');
  }

  private absorbForward(entries: readonly JournalEntry[]): void {
    const rows: ScrollbackRow[] = [];
    for (const entry of entries) {
      const row = entryToRow(entry);
      rows.push(row);
    }
    const merged = new Map(this.pagedRows.map((row) => [row.key, row]));
    for (const row of rows) merged.set(row.key, row);
    this.pagedRows = [...merged.values()];
    this.retainCursorWindow('newer');
  }

  /**
   * Opens the cursor on first use, keyed to the requesting generation: an
   * open that resolves under a stale generation (or a closed store) is closed
   * immediately and yields null, never state.
   */
  private async ensureCursor(gen: number): Promise<NativeJournalCursor | null> {
    if (this.closed || gen !== this.generation) return null;
    if (this.cursor !== null) return this.cursor;
    if (this.openPromise === null || this.openGeneration !== gen) {
      this.openGeneration = gen;
      const options = {
        chunkBytes: this.chunkBytes,
        counters: this.counters,
        signal: this.controller.signal,
        publishedEnd: this.publishedEnd,
        journal: this.options.journal,
        orphanBeforeTranscriptId: this.orphanBeforeTranscriptId,
        emojiFilterMode: this.options.emojiFilterMode,
      };
      const opening = NativeJournalCursor.open(
        this.filePath,
        options,
        this.pageRows,
      );
      this.openPromise = opening.then(
        async (cursor): Promise<NativeJournalCursor | null> => {
          if (this.closed || gen !== this.generation) {
            await cursor.close();
            return null;
          }
          this.orphanBeforeTranscriptId ??= cursor.orphanBoundary();
          this.cursor = cursor;
          return cursor;
        },
        (error: unknown): NativeJournalCursor | null => {
          if (gen === this.generation && !this.closed) {
            this.error = errorMessage(error);
          }
          return null;
        },
      );
    }
    return this.openPromise;
  }

  private async dropCursor(): Promise<void> {
    const cursor = this.cursor;
    this.cursor = null;
    this.openPromise = null;
    if (cursor !== null) {
      await cursor.close().catch(() => undefined);
    }
  }
}

export function createScrollbackPagerStore(
  options: ScrollbackPagerOptions,
): ScrollbackPagerStore {
  return new ScrollbackPagerStoreImpl(options);
}
