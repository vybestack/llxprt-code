/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260917-ISSUE854.P02c
 * @requirement G1,G2
 *
 * ScrollbackPager store (issue-854-design.md §3): bounded scrollback over the
 * append-only session journal. Rows are paged through a JournalCursor whose
 * two read heads mirror the resident window — pageBack consumes older records
 * from the backward head, pageForward picks up appends at the forward head,
 * and the resident rows always span exactly the records between the heads.
 *
 * Every async read is guarded by a generation counter: invalidate() and
 * close() bump the generation and drop the cursor, and any read that finishes
 * under a stale generation is discarded whole, so rows are never torn across
 * generations and a closed cursor can never mutate state.
 *
 * The visibility floor is the newest clear boundary (a rewind record) or the
 * file start; pageBack stops there so cleared history never resurrects.
 * Compressed records page through as summary rows and do not stop paging.
 *
 * Residency (issue-854-design.md §3): visible rows and the pending live tail
 * are never evicted (oversized-visible-row guarantee). pageOut schedules a
 * reset-debounced flush that evicts beyond-window rows — sub-context rows
 * (seq < contextWindow.firstSeq) first, then the far off-screen end — down
 * to the byte floor; reportViewport and setContextWindow evict sub-context
 * rows immediately at bottom.
 */

import { Buffer } from 'node:buffer';
import {
  JournalCursor,
  type IContent,
  type JournalEntry,
} from '@vybestack/llxprt-code-core';
import type { HistoryItem } from '../../types.js';
import {
  pendingRowIdentity,
  rowIdentity,
  rowIdentityKey,
  type RowIdentity,
} from '../../utils/rowIdentity.js';

/** Viewport metrics the pager reads to size its residency margins. */
export interface ScrollbackViewportReporter {
  visibleKeys: readonly string[];
  viewportLines: number;
  rowHeightLines(): number;
}

export interface ScrollbackPagerSettings {
  readonly marginViewports: number;
  readonly byteFloorBytes: number;
  readonly purgeDebounceMs: number;
}

export interface ScrollbackPagerOptions {
  readonly filePath: string;
  readonly viewport: ScrollbackViewportReporter;
  readonly pageRows: number;
  readonly settings: ScrollbackPagerSettings;
  /** JournalCursor read chunk size; defaults to the cursor's own default. */
  readonly chunkBytes?: number;
}

/** One display row: a projected journal record or a live-tail item. */
export interface ScrollbackRow {
  readonly key: string;
  readonly seq: number | null;
  readonly identity: RowIdentity;
  /** Journal byte offset, or null for rows with no journal record. */
  readonly offset: number | null;
  readonly item: HistoryItem;
}

export interface ScrollbackPagerState {
  readonly rows: readonly ScrollbackRow[];
  readonly loadingOlder: boolean;
  readonly atVisibilityFloor: boolean;
  readonly atFileEnd: boolean;
  readonly generation: number;
  readonly error: string | null;
}

export interface ScrollbackPagerMetrics {
  readonly residentBytes: number;
  readonly residentRows: number;
}

export interface ScrollbackPagerStore {
  getState(): ScrollbackPagerState;
  pageBack(): Promise<void>;
  pageForward(): Promise<void>;
  invalidate(): Promise<void>;
  reportViewport(): void;
  pageOut(direction: 'older' | 'newer'): void;
  setContextWindow(window: { firstSeq: number; lastSeq: number }): void;
  setLiveTail(items: readonly HistoryItem[]): void;
  commitPendingRow(
    pendingKey: string,
    committedIdentity: RowIdentity,
    item: HistoryItem,
  ): boolean;
  metrics(): ScrollbackPagerMetrics;
  close(): Promise<void>;
}

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

function contentToHistoryItem(content: IContent): HistoryItem {
  const id = nextRowItemId();
  const text = contentText(content);
  const chronologySeq = content.metadata?.chronology?.seq;
  if (content.speaker === 'ai') {
    return { id, type: 'gemini', text, chronologySeq };
  }
  if (content.speaker === 'human') {
    return { id, type: 'user', text, chronologySeq };
  }
  return { id, type: 'info', text, chronologySeq };
}

function compressedBoundaryText(payload: unknown): string {
  const summary = readSummaryContent(payload);
  const summaryText = summary === null ? '' : contentText(summary).trim();
  return summaryText.length > 0
    ? `[compressed] ${summaryText}`
    : '[compressed]';
}

function isClearBoundary(entry: JournalEntry): boolean {
  return entry.kind === 'boundary' && entry.envelope.type === 'rewind';
}

/** Entries that project a row a viewport can measure; boundaries do not. */
function isDisplayEntry(entry: JournalEntry): boolean {
  return entry.kind === 'content' || entry.kind === 'group';
}

interface BackPageCollect {
  added: number;
  hitClearBoundary: boolean;
}

/**
 * Consumes one page's entries (newest first) into `collected`, stopping at
 * the walk's clear boundary; the boundary itself and everything older than
 * it is cleared history and is dropped.
 */
function collectBackPage(
  entries: readonly JournalEntry[],
  collected: JournalEntry[],
): BackPageCollect {
  let added = 0;
  for (const entry of entries) {
    if (isClearBoundary(entry)) {
      return { added, hitClearBoundary: true };
    }
    collected.push(entry);
    if (isDisplayEntry(entry)) added += 1;
  }
  return { added, hitClearBoundary: false };
}

/** Appends one forward page (oldest first) in walk order. */
function pushForwardPage(
  entries: readonly JournalEntry[],
  collected: JournalEntry[],
): number {
  let added = 0;
  for (const entry of entries) {
    collected.push(entry);
    if (isDisplayEntry(entry)) added += 1;
  }
  return added;
}

function entryToRow(entry: JournalEntry): ScrollbackRow | null {
  switch (entry.kind) {
    case 'content': {
      const identity = rowIdentity(
        { kind: 'journal', offset: entry.offset },
        'text',
      );
      return {
        key: rowIdentityKey(identity),
        seq: entry.seq,
        identity,
        offset: entry.offset,
        item: contentToHistoryItem(entry.content),
      };
    }
    case 'group': {
      const identity = rowIdentity(
        { kind: 'journal', offset: entry.offset },
        'toolGroup',
      );
      const content = entry.call ?? entry.response;
      const item: HistoryItem =
        content === null
          ? { id: nextRowItemId(), type: 'info', text: '[tool group]' }
          : contentToHistoryItem(content);
      return {
        key: rowIdentityKey(identity),
        seq: entry.seqSpan[1],
        identity,
        offset: entry.offset,
        item,
      };
    }
    case 'boundary': {
      if (entry.envelope.type !== 'compressed') return null;
      return compressedBoundaryRow(entry);
    }
    default:
      // Oversized records are diagnosed by the cursor, never displayed.
      return null;
  }
}

function compressedBoundaryRow(entry: BoundaryEntry): ScrollbackRow {
  const identity = rowIdentity(
    { kind: 'journal', offset: entry.offset },
    'summaryRow',
  );
  return {
    key: rowIdentityKey(identity),
    seq: entry.seq,
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

class ScrollbackPagerStoreImpl implements ScrollbackPagerStore {
  private readonly filePath: string;
  private readonly viewport: ScrollbackViewportReporter;
  private readonly pageRows: number;
  private readonly settings: ScrollbackPagerSettings;
  private readonly chunkBytes: number | undefined;

  private cursor: JournalCursor | null = null;
  private openPromise: Promise<JournalCursor | null> | null = null;
  private openGeneration = -1;
  private closed = false;
  private generation = 0;
  private inFlightBackReads = 0;
  private pagedRows: ScrollbackRow[] = [];
  private liveItems: readonly HistoryItem[] = [];
  private atVisibilityFloor = false;
  private atFileEnd = false;
  private error: string | null = null;
  private contextWindow: ContextWindow | null = null;
  private visibleKeys: readonly string[] = [];
  private purgeTimer: ReturnType<typeof setTimeout> | null = null;
  private purgeDirection: 'older' | 'newer' = 'older';

  constructor(options: ScrollbackPagerOptions) {
    this.filePath = options.filePath;
    this.viewport = options.viewport;
    this.pageRows = options.pageRows;
    this.settings = options.settings;
    this.chunkBytes = options.chunkBytes;
  }

  getState(): ScrollbackPagerState {
    return {
      rows: [...this.pagedRows, ...this.liveRows()],
      loadingOlder: this.inFlightBackReads > 0,
      atVisibilityFloor: this.atVisibilityFloor,
      atFileEnd: this.atFileEnd,
      generation: this.generation,
      error: this.error,
    };
  }

  async pageBack(): Promise<void> {
    if (this.closed || this.atVisibilityFloor) return;
    const gen = this.generation;
    this.inFlightBackReads += 1;
    try {
      const cursor = await this.ensureCursor(gen);
      if (cursor === null || this.isStale(gen)) return;
      const { collected, exhausted } = await this.collectBack(cursor, gen);
      if (this.isStale(gen)) return;
      this.absorbBack(collected);
      if (exhausted || cursor.windowStart() === 0) {
        this.atVisibilityFloor = true;
      }
      this.atFileEnd = cursor.windowEnd() >= cursor.size();
      this.error = null;
    } catch (error) {
      if (!this.isStale(gen)) {
        this.error = errorMessage(error);
      }
    } finally {
      this.inFlightBackReads -= 1;
    }
  }

  async pageForward(): Promise<void> {
    if (this.closed) return;
    const gen = this.generation;
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
      this.error = null;
    } catch (error) {
      if (!this.isStale(gen)) {
        this.error = errorMessage(error);
      }
    }
  }

  async invalidate(): Promise<void> {
    if (this.closed) return;
    this.generation += 1;
    this.pagedRows = [];
    this.atVisibilityFloor = false;
    this.atFileEnd = false;
    this.error = null;
    this.clearPurgeTimer();
    await this.dropCursor();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.generation += 1;
    this.clearPurgeTimer();
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
    this.purgeTimer = setTimeout(() => {
      this.purgeTimer = null;
      this.flushPurge();
    }, this.settings.purgeDebounceMs);
  }

  setContextWindow(window: { firstSeq: number; lastSeq: number }): void {
    this.contextWindow = { ...window };
    this.evictSubContext();
  }

  /** Replaces the live tail wholesale; rows merge by identity in liveRows. */
  setLiveTail(items: readonly HistoryItem[]): void {
    this.liveItems = [...items];
  }

  commitPendingRow(
    pendingKey: string,
    committedIdentity: RowIdentity,
    item: HistoryItem,
  ): boolean {
    const pendingSlot = rowIdentityKey(pendingRowIdentity(pendingKey));
    const index = this.liveItems.findIndex(
      (live) =>
        live.rowIdentity !== undefined &&
        rowIdentityKey(live.rowIdentity) === pendingSlot,
    );
    if (index === -1) return false;
    const committedKey = rowIdentityKey(committedIdentity);
    this.pagedRows = this.pagedRows.filter((row) => row.key !== committedKey);
    const next = this.liveItems.slice();
    next[index] = { ...item, rowIdentity: committedIdentity };
    this.liveItems = next;
    return true;
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

  /** Seq range of reported visible paged rows; null when none reported. */
  private visibleSeqRange(): { oldest: number | null; newest: number | null } {
    const visible = this.visibleSet();
    let oldest: number | null = null;
    let newest: number | null = null;
    for (const row of this.pagedRows) {
      if (row.seq === null || !visible.has(row.key)) continue;
      if (oldest === null || row.seq < oldest) oldest = row.seq;
      if (newest === null || row.seq > newest) newest = row.seq;
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
    this.pagedRows = this.pagedRows.filter(
      (row) =>
        row.seq === null || row.seq >= ctx.firstSeq || visible.has(row.key),
    );
  }

  private flushPurge(): void {
    if (this.closed) return;
    this.evictSubContext();
    this.evictFarEnd(this.purgeDirection);
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
    const { oldest, newest } = this.visibleSeqRange();
    let limit = Number.POSITIVE_INFINITY;
    if (direction === 'newer') {
      limit = newest === null ? Number.NEGATIVE_INFINITY : newest + margin;
    } else if (oldest !== null) {
      limit = oldest - margin;
    }
    const candidates = this.pagedRows.filter(
      (row): row is ScrollbackRow & { readonly seq: number } =>
        row.seq !== null &&
        !visible.has(row.key) &&
        (direction === 'older' ? row.seq < limit : row.seq > limit),
    );
    if (candidates.length === 0) return;
    candidates.sort((a, b) =>
      direction === 'older' ? a.seq - b.seq : b.seq - a.seq,
    );
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
  }

  private isStale(gen: number): boolean {
    return this.closed || gen !== this.generation;
  }

  private liveRows(): ScrollbackRow[] {
    const rows: ScrollbackRow[] = [];
    const seen = new Set<string>();
    for (const item of this.liveItems) {
      const identity = item.rowIdentity;
      if (identity !== undefined) {
        const key = rowIdentityKey(identity);
        if (!seen.has(key)) {
          seen.add(key);
          rows.push({
            key,
            seq: item.chronologySeq ?? null,
            identity,
            offset: identity.kind === 'journal' ? identity.offset : null,
            item,
          });
        }
      }
    }
    return rows;
  }

  /**
   * Pages back until `pageRows` display rows are collected or the walk ends.
   * Boundary rows (compressed) ride along free of the row budget; a rewind
   * boundary ends the walk and everything from it onward is dropped.
   */
  private async collectBack(
    cursor: JournalCursor,
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
        const collect = collectBackPage(page.entries, collected);
        contentCount += collect.added;
        exhausted = collect.hitClearBoundary;
      }
    }
    return { collected, exhausted: exhausted || stale };
  }

  private absorbBack(entries: readonly JournalEntry[]): void {
    const rows: ScrollbackRow[] = [];
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const row = entryToRow(entries[i]);
      if (row !== null) rows.push(row);
    }
    this.pagedRows = [...rows, ...this.pagedRows];
  }

  private absorbForward(entries: readonly JournalEntry[]): void {
    const rows: ScrollbackRow[] = [];
    for (const entry of entries) {
      const row = entryToRow(entry);
      if (row !== null) rows.push(row);
    }
    this.pagedRows = [...this.pagedRows, ...rows];
  }

  /**
   * Opens the cursor on first use, keyed to the requesting generation: an
   * open that resolves under a stale generation (or a closed store) is closed
   * immediately and yields null, never state.
   */
  private async ensureCursor(gen: number): Promise<JournalCursor | null> {
    if (this.closed || gen !== this.generation) return null;
    if (this.cursor !== null) return this.cursor;
    if (this.openPromise === null || this.openGeneration !== gen) {
      this.openGeneration = gen;
      this.openPromise = JournalCursor.open(this.filePath, {
        chunkBytes: this.chunkBytes,
      }).then(
        (cursor): JournalCursor | null => {
          if (this.closed || gen !== this.generation) {
            void cursor.close().catch(() => undefined);
            return null;
          }
          this.cursor = cursor;
          return cursor;
        },
        (error: unknown): JournalCursor | null => {
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
