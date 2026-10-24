/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  openJournalReadOnly,
  type JournalReader,
} from '@vybestack/llxprt-code-core/journal/journalReader.js';
import {
  entryAt,
  iterateRowEntries,
  rowTreeRootOf,
  type RowTreeRootRef,
} from '@vybestack/llxprt-code-core/journal/rowTreeReader.js';
import {
  readRowIds,
  readStoredRow,
} from '@vybestack/llxprt-code-core/journal/rowReads.js';
import {
  ROW_ID_KIND,
  ROW_SPEAKER,
} from '@vybestack/llxprt-code-core/journal/rowRecord.js';
import { decodeStoredRow } from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  ROW_ENTRY_NO_CHRONOLOGY_SEQ,
  type RowEntry,
} from '@vybestack/llxprt-code-core/journal/rowEntry.js';
import type { HistoryItem } from '../../types.js';
import { iContentToHistoryItems } from '../../utils/iContentToHistoryItems.js';
import { rowIdentityKey } from '../../utils/rowIdentity.js';
import type {
  NativeDisplayEntry as DisplayJournalEntry,
  NativeJournalOptions,
} from './native-journal-types.js';
import { entryByLabel } from '@vybestack/llxprt-code-core/journal/rowTreeQueries.js';
import { NativeResponseIndex } from './native-response-index.js';
import { readVersionAt } from '@vybestack/llxprt-code-core/journal/trailerAccess.js';
import { versionOf } from '@vybestack/llxprt-code-core/journal/version.js';
import { MUTATION } from '@vybestack/llxprt-code-core/journal/recordKinds.js';

interface Position {
  readonly row: number;
  readonly item: number;
}
interface LocatedEntry {
  readonly entry: DisplayJournalEntry;
  readonly before: Position;
  readonly after: Position;
}

interface ProjectionGroup {
  readonly first: RowEntry;
  readonly opener: IContent;
  readonly from: number;
  readonly rows: number;
  readonly calls: number;
  readonly spanEnd: number | undefined;
}

export class NativeJournalCursor {
  private start: Position;
  private end: Position;
  private readonly positions = new Map<string, LocatedEntry>();
  private retained: HistoryItem[] = [];
  private firstOffset: number | null = null;
  private boundaryOffset: number | null = null;
  private initialPage: LocatedEntry[] | undefined;
  private readonly controller = new AbortController();
  private queue: Promise<void> = Promise.resolve();
  private closing: Promise<void> | undefined;
  private responseIndex: NativeResponseIndex;
  private group: { readonly start: number; readonly end: number } | undefined;

  private constructor(
    private reader: JournalReader,
    private readonly options: NativeJournalOptions,
  ) {
    this.options = {
      ...options,
      signal: options.signal
        ? AbortSignal.any([options.signal, this.controller.signal])
        : this.controller.signal,
    };
    this.start = { row: this.rows, item: 0 };
    this.end = this.start;
    this.responseIndex = new NativeResponseIndex(reader);
  }
  static async open(
    path: string,
    options: NativeJournalOptions,
    pageRows = 16,
  ): Promise<NativeJournalCursor> {
    options.signal?.throwIfAborted();
    const reader = await openJournalReadOnly(path, options.journal);
    const cursor = new NativeJournalCursor(reader, options);
    try {
      options.signal?.throwIfAborted();
      const root = rowTreeRootOf(reader.trailer);
      options.counters?.recordDecoded();
      if (root)
        cursor.firstOffset = (await entryAt(reader, root, 0)).recordOffset;
      await cursor.locateClearBoundary();
      await cursor.seed(pageRows);
      options.signal?.throwIfAborted();
      return cursor;
    } catch (error) {
      await cursor.close();
      throw error;
    }
  }
  private get rows(): number {
    return this.reader.trailer?.rootAggregate.rows ?? 0;
  }
  private retainEntry(entry: DisplayJournalEntry): void {
    if (entry.kind === 'projected')
      this.options.counters?.ownership?.retain(entry.item);
  }
  private trimSeed(page: LocatedEntry[], count: number): void {
    if (page.length <= count) return;
    const dropped = page.shift();
    if (dropped?.entry.kind === 'projected')
      this.options.counters?.ownership?.release(dropped.entry.item);
  }
  private async seed(count: number): Promise<void> {
    const page: LocatedEntry[] = [];
    try {
      let row = 0;
      while (row < this.rows) {
        for await (const located of this.projectGroup(row)) {
          page.push(located);
          this.retainEntry(located.entry);
          this.trimSeed(page, count);
        }
        row = await this.groupEnd(row);
      }
      this.initialPage = page;
    } catch (error) {
      for (const located of page)
        if (located.entry.kind === 'projected')
          this.options.counters?.ownership?.release(located.entry.item);
      throw error;
    }
  }
  private root(): RowTreeRootRef {
    const root = rowTreeRootOf(this.reader.trailer);
    if (!root) throw new Error('Empty journal has no row tree');
    return root;
  }
  private async read(entry: RowEntry): Promise<IContent> {
    this.options.signal?.throwIfAborted();
    this.options.counters?.recordDecoded();
    this.options.counters?.rowDecoded();
    try {
      const stored = await readStoredRow(this.reader, entry);
      this.options.signal?.throwIfAborted();
      return decodeStoredRow(stored);
    } finally {
      this.options.counters?.rowReleased();
    }
  }
  private async groupStart(row: number): Promise<number> {
    if (this.group && row >= this.group.start && row < this.group.end)
      return this.group.start;
    while (
      row > 0 &&
      (await entryAt(this.reader, this.root(), row)).speaker ===
        ROW_SPEAKER.tool
    )
      row--;
    return row;
  }
  private async groupEnd(row: number): Promise<number> {
    if (this.group?.start === row) return this.group.end;
    let end = row + 1;
    for await (const entry of iterateRowEntries(
      this.reader,
      this.root(),
      end,
    )) {
      if (entry.speaker !== ROW_SPEAKER.tool) break;
      end++;
    }
    this.group = { start: row, end };
    return end;
  }
  private displayEntry(
    first: RowEntry,
    opener: IContent,
    item: HistoryItem,
    rows: number,
  ): DisplayJournalEntry {
    const seq = opener.metadata?.chronology?.seq ?? Number(first.label);
    const common = {
      offset: first.recordOffset,
      length: first.recordLength,
      seq,
    };
    return opener.metadata?.isSummary === true
      ? {
          ...common,
          kind: 'boundary',
          envelope: {
            v: 1,
            seq,
            ts: '',
            type: 'compressed',
            payload: { summary: opener },
          },
        }
      : { ...common, kind: 'projected', rows, item };
  }
  private async responseEntries(
    calls: ReadonlySet<string>,
    from: number,
    end: number,
  ): Promise<Map<string, RowEntry>> {
    const responses = new Map<string, RowEntry>();
    if (calls.size === 0 || from === end) return responses;
    if (this.reader.trailer?.rootAggregate.curated === this.rows) {
      const first = await entryAt(this.reader, this.root(), from);
      const last = await entryAt(this.reader, this.root(), end - 1);
      for (const id of calls) {
        const label = await this.responseIndex.last(
          id,
          first.label,
          last.label + 1n,
        );
        if (label === undefined) continue;
        const entry = await entryByLabel(this.reader, this.root(), label);
        if (entry === undefined)
          throw new Error('Indexed native response row is absent');
        responses.set(id, entry);
      }
      return responses;
    }
    let ordinal = from;
    for await (const entry of iterateRowEntries(
      this.reader,
      this.root(),
      from,
    )) {
      if (ordinal++ >= end) break;
      this.options.signal?.throwIfAborted();
      const ids = await readRowIds(this.reader, entry);
      for (const [index, id] of ids.rawIds.entries())
        if (
          ids.header.ids[index].kind === ROW_ID_KIND.response &&
          calls.has(id)
        )
          responses.set(id, entry);
    }
    return responses;
  }
  private async responsesFor(
    wanted: ReadonlySet<string>,
    entries: ReadonlyMap<string, RowEntry>,
  ): Promise<Map<string, IContent>> {
    const responses = new Map<string, IContent>();
    for (const id of wanted) {
      const entry = entries.get(id);
      if (entry === undefined) continue;
      const response = await this.read(entry);
      for (const block of response.blocks)
        if (block.type === 'tool_response' && block.callId === id)
          responses.set(id, { ...response, blocks: [block] });
    }
    return responses;
  }
  private responseSpan(
    entries: ReadonlyMap<string, RowEntry>,
  ): number | undefined {
    let end: number | undefined;
    for (const entry of entries.values()) {
      if (entry.chronologySeq === ROW_ENTRY_NO_CHRONOLOGY_SEQ) continue;
      const seq = Number(entry.chronologySeq);
      end = Math.max(end ?? seq, seq);
    }
    return end;
  }
  private locateItems(
    group: ProjectionGroup,
    items: readonly HistoryItem[],
    firstItem: number,
    callStart: number,
  ): LocatedEntry[] {
    const { first, opener, from, spanEnd } = group;
    return items.map((item, index) => {
      const identity = item.rowIdentity;
      const spanStart = opener.metadata?.chronology?.seq;
      const projected: HistoryItem = {
        ...item,
        ...(item.type === 'tool_group' &&
        spanStart !== undefined &&
        spanEnd !== undefined
          ? { seqSpan: [spanStart, Math.max(spanStart, spanEnd)] }
          : {}),
        ...(identity && identity.kind !== 'pending'
          ? {
              rowIdentity: {
                kind: 'journal',
                offset: first.recordOffset,
                discriminator: identity.discriminator,
                ...(callStart > 0 ? { toolOffset: callStart } : {}),
              },
            }
          : {}),
        ...(item.type === 'tool_group' && group.calls > 16
          ? {
              toolPage: {
                start: callStart,
                total: group.calls,
                groupIndex: from,
              },
            }
          : {}),
      };
      return {
        entry: this.displayEntry(first, opener, projected, group.rows),
        before: { row: from, item: firstItem + index },
        after: { row: from, item: firstItem + index + 1 },
      };
    });
  }
  private async *projectGroup(
    from: number,
    minimumItem = 0,
    maximumItem = Number.POSITIVE_INFINITY,
    tailCount = Number.POSITIVE_INFINITY,
  ): AsyncGenerator<LocatedEntry> {
    const first = await entryAt(this.reader, this.root(), from);
    const end = await this.groupEnd(from);
    const opener = await this.read(first);
    this.options.counters?.ownership?.retain(opener);
    let itemIndex = 0;
    try {
      const calls = opener.blocks.filter((block) => block.type === 'tool_call');
      const callIds = new Set(calls.map((call) => call.id));
      const responseEntries = await this.responseEntries(
        callIds,
        from + 1,
        end,
      );
      const spanEnd = this.responseSpan(responseEntries);
      for (
        let callStart = 0;
        callStart === 0 || callStart < calls.length;
        callStart += 16
      ) {
        const selected = calls.slice(callStart, callStart + 16);
        const responses = await this.responsesFor(
          new Set(selected.map((call) => call.id)),
          responseEntries,
        );
        const page: IContent = {
          ...opener,
          blocks: [
            ...(callStart === 0
              ? opener.blocks.filter((block) => block.type !== 'tool_call')
              : []),
            ...selected,
          ],
        };
        const items = iContentToHistoryItems([page, ...responses.values()]);
        if (callStart === 0) {
          const total =
            items.length + Math.max(0, Math.ceil(calls.length / 16) - 1);
          minimumItem = Math.max(
            minimumItem,
            Math.min(maximumItem, total) - tailCount,
          );
        }
        const located = this.locateItems(
          {
            first,
            opener,
            from,
            rows: end - from,
            calls: calls.length,
            spanEnd,
          },
          items,
          itemIndex,
          callStart,
        );
        yield* located.filter(
          ({ before }) =>
            before.item >= minimumItem && before.item < maximumItem,
        );
        itemIndex += items.length;
        if (calls.length === 0 || itemIndex >= maximumItem) break;
        if (itemIndex < minimumItem) {
          callStart += (minimumItem - itemIndex) * 16;
          itemIndex = minimumItem;
        }
      }
    } finally {
      this.options.counters?.ownership?.release(opener);
    }
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      this.options.signal?.throwIfAborted();
      return operation();
    });
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  pageBack(count: number): Promise<{ entries: DisplayJournalEntry[] }> {
    return this.enqueue(() => this.readBack(count));
  }
  pageForward(count: number): Promise<{ entries: DisplayJournalEntry[] }> {
    return this.enqueue(() => this.readForward(count));
  }
  refreshFileEnd(): Promise<void> {
    return this.enqueue(() => this.refreshReader());
  }
  private async readBack(
    count: number,
  ): Promise<{ entries: DisplayJournalEntry[] }> {
    this.releasePage();
    if (this.initialPage !== undefined) {
      const page = this.initialPage;
      this.initialPage = undefined;
      const selected = page.slice(-count).reverse();
      this.start = selected[selected.length - 1]?.before ?? this.start;
      const result = this.handoff(selected);
      for (const located of page)
        if (located.entry.kind === 'projected')
          this.options.counters?.ownership?.release(located.entry.item);
      return result;
    }
    const selected: LocatedEntry[] = [];
    let position = this.start;
    while (selected.length < count && (position.row > 0 || position.item > 0)) {
      const from =
        position.item > 0
          ? position.row
          : await this.groupStart(position.row - 1);
      const tail: LocatedEntry[] = [];
      for await (const located of this.projectGroup(
        from,
        0,
        from === position.row ? position.item : Number.POSITIVE_INFINITY,
        count - selected.length,
      )) {
        tail.push(located);
        if (tail.length > count - selected.length) tail.shift();
      }
      selected.push(...tail.reverse());
      position =
        tail.length > 0 ? tail[tail.length - 1].before : { row: from, item: 0 };
    }
    this.start = position;
    return this.handoff(selected);
  }
  private async readForward(
    count: number,
  ): Promise<{ entries: DisplayJournalEntry[] }> {
    this.releasePage();
    await this.refreshReader();
    const selected: LocatedEntry[] = [];
    let position = this.end;
    while (selected.length < count && position.row < this.rows) {
      const from = position.row;
      let exhausted = true;
      for await (const located of this.projectGroup(from, position.item)) {
        if (selected.length === count) {
          exhausted = false;
          break;
        }
        if (located.before.item >= position.item) {
          selected.push(located);
          position = located.after;
        }
      }
      if (exhausted) position = { row: await this.groupEnd(from), item: 0 };
    }
    this.end = position;
    return this.handoff(selected);
  }
  private handoff(selected: readonly LocatedEntry[]): {
    entries: DisplayJournalEntry[];
  } {
    this.options.signal?.throwIfAborted();
    for (const located of selected) {
      if (located.entry.kind !== 'projected') continue;
      const item = located.entry.item;
      this.options.counters?.ownership?.retain(item);
      this.retained.push(item);
      if (item.rowIdentity)
        this.positions.set(rowIdentityKey(item.rowIdentity), located);
    }
    return { entries: selected.map(({ entry }) => entry) };
  }
  retainWindow(
    first: string | undefined,
    last: string | undefined,
    direction: 'older' | 'newer',
  ): void {
    const head = first === undefined ? undefined : this.positions.get(first);
    const tail = last === undefined ? undefined : this.positions.get(last);
    if (head && tail) {
      this.start = head.before;
      this.end = tail.after;
    } else if (direction === 'older') this.start = this.end;
    else this.end = this.start;
    this.positions.clear();
    if (head && first) this.positions.set(first, head);
    if (tail && last) this.positions.set(last, tail);
  }
  private async refreshReader(): Promise<void> {
    this.options.signal?.throwIfAborted();
    const next = await openJournalReadOnly(
      this.reader.path,
      this.options.journal,
    );
    if (this.options.signal?.aborted === true) {
      await next.close();
      this.options.signal.throwIfAborted();
    }
    if (
      (next.trailer?.rootAggregate.rows ?? 0) > this.rows &&
      this.rows > 0 &&
      this.end.row === this.rows
    ) {
      const tail = await entryAt(this.reader, this.root(), this.rows - 1);
      if (tail.speaker !== ROW_SPEAKER.human)
        this.end = { row: await this.groupStart(this.rows - 1), item: 0 };
    }
    if (next.trailer?.groupTag !== this.reader.trailer?.groupTag)
      this.group = undefined;
    await this.reader.close();
    this.reader = next;
    this.responseIndex = new NativeResponseIndex(next);
  }
  private async locateClearBoundary(): Promise<void> {
    const trailer = this.reader.trailer;
    if (trailer === undefined) return;
    let first = versionOf(trailer);
    while (first.parent !== 0) {
      const offset =
        [...first.skip].reverse().find((value) => value !== 0) ?? first.parent;
      first = await readVersionAt(this.reader, offset);
    }
    const fullPop = first.mutation === MUTATION.pop && first.rows === 0;
    const replaced = first.mutation === MUTATION.replace;
    this.boundaryOffset = replaced || fullPop ? first.selfOffset : null;
  }
  clearBoundaryOffset(): number | null {
    return this.boundaryOffset;
  }
  firstDisplayOffset(): number | null {
    return this.firstOffset;
  }
  atStart(): boolean {
    return this.start.row === 0 && this.start.item === 0;
  }
  atFirstPageAtOffset(offset: number): boolean {
    return this.atStart() && offset === this.firstOffset;
  }
  size(): number {
    return this.reader.trailer?.durableEnd ?? this.reader.fileSize;
  }
  windowStart(): number {
    return this.atStart() ? 0 : this.start.row;
  }
  windowEnd(): number {
    return this.end.row >= this.rows ? this.size() : this.end.row;
  }
  private releasePage(): void {
    for (const item of this.retained)
      this.options.counters?.ownership?.release(item);
    this.retained = [];
  }
  close(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    this.controller.abort(new Error('Native journal cursor is closed'));
    this.closing = this.queue.then(() => this.dispose());
    return this.closing;
  }
  private async dispose(): Promise<void> {
    this.releasePage();
    for (const located of this.initialPage ?? [])
      if (located.entry.kind === 'projected')
        this.options.counters?.ownership?.release(located.entry.item);
    this.initialPage = undefined;
    this.positions.clear();
    await this.reader.close();
  }
}
