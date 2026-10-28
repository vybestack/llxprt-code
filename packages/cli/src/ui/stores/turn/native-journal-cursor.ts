/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  NativeJournalPageReader,
  type NativeJournalEntry as RowEntry,
  type IContent,
} from '@vybestack/llxprt-code-core';
import type { HistoryItem } from '../../types.js';
import { iContentToHistoryItems } from '../../utils/iContentToHistoryItems.js';
import { rowIdentityKey } from '../../utils/rowIdentity.js';
import type {
  NativeDisplayEntry as DisplayJournalEntry,
  NativeJournalOptions,
} from './native-journal-types.js';
import { NativeResponseIndex } from './native-response-index.js';
import { decodeJournalUiItem } from './journal-ui-item.js';
import {
  displayText,
  withToolPresentations,
} from './journal-display-projection.js';

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
  readonly inContext: boolean;
}

export class NativeJournalCursor {
  private start: Position;
  private end: Position;
  private readonly positions = new Map<
    string,
    Pick<LocatedEntry, 'before' | 'after'>
  >();
  private retained: HistoryItem[] = [];
  private firstOffset: number | null = null;
  private boundaryOffset: number | null = null;
  private initialPage: LocatedEntry[] | undefined;
  private readonly controller = new AbortController();
  private queue: Promise<void> = Promise.resolve();
  private closing: Promise<void> | undefined;
  private responseIndex: NativeResponseIndex;
  private group: { readonly start: number; readonly end: number } | undefined;
  private publishedEnd: number | undefined;
  private readonly orphanBeforeOffset: number;

  private constructor(
    private reader: NativeJournalPageReader,
    private readonly options: NativeJournalOptions,
  ) {
    this.options = {
      ...options,
      signal: options.signal
        ? AbortSignal.any([options.signal, this.controller.signal])
        : this.controller.signal,
    };
    this.publishedEnd = options.publishedEnd;
    this.orphanBeforeOffset = options.orphanBeforeOffset ?? reader.size;
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
    const reader = await NativeJournalPageReader.open(
      path,
      options.journal,
      options.publishedEnd,
    );
    const cursor = new NativeJournalCursor(reader, options);
    try {
      options.signal?.throwIfAborted();
      options.counters?.recordDecoded();
      if (reader.rows > 0)
        cursor.firstOffset = (await reader.entryAt(0)).recordOffset;
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
    return this.reader.rows;
  }
  private retainEntry(entry: DisplayJournalEntry): void {
    if (entry.kind === 'projected')
      this.options.counters?.ownership?.retain(entry.item);
  }
  private async seed(count: number): Promise<void> {
    const page: LocatedEntry[] = [];
    try {
      let end = this.rows;
      while (end > 0 && page.length < count) {
        const row = await this.groupStart(end - 1);
        const group: LocatedEntry[] = [];
        for await (const located of this.projectGroup(
          row,
          0,
          Number.POSITIVE_INFINITY,
          count - page.length,
        )) {
          group.push(located);
          this.retainEntry(located.entry);
        }
        page.unshift(...group);
        end = row;
      }
      this.initialPage = page;
    } catch (error) {
      for (const located of page)
        if (located.entry.kind === 'projected')
          this.options.counters?.ownership?.release(located.entry.item);
      throw error;
    }
  }
  private async read(entry: RowEntry, callStart?: number): Promise<IContent> {
    this.options.signal?.throwIfAborted();
    this.options.counters?.recordDecoded();
    this.options.counters?.rowDecoded();
    try {
      const content =
        callStart === undefined
          ? await this.reader.readContent(entry)
          : await this.reader.readToolPage(entry, callStart, 16);
      this.options.signal?.throwIfAborted();
      return content;
    } finally {
      this.options.counters?.rowReleased();
    }
  }
  private async isToolContinuation(entry: RowEntry): Promise<boolean> {
    if (this.reader.isTool(entry)) return true;
    const presentation = await this.reader.presentation(entry);
    return (
      presentation?.descriptor.type === 'tool-result' ||
      presentation?.descriptor.type === 'tool-approval'
    );
  }
  private async groupStart(row: number): Promise<number> {
    if (this.group && row >= this.group.start && row < this.group.end)
      return this.group.start;
    while (
      row > 0 &&
      (await this.isToolContinuation(await this.reader.entryAt(row)))
    )
      row--;
    return row;
  }
  private async groupEnd(row: number): Promise<number> {
    if (this.group?.start === row) return this.group.end;
    let end = row + 1;
    for await (const entry of this.reader.entries(end)) {
      if (!(await this.isToolContinuation(entry))) break;
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
    inContext: boolean,
  ): DisplayJournalEntry {
    const seq = opener.metadata?.chronology?.seq ?? Number(first.label);
    const common = {
      transcriptId: first.transcriptId.toString(),
      offset: first.recordOffset,
      length: first.recordLength,
      seq,
      contextState: inContext ? 'in-context' : 'purged',
    } satisfies {
      transcriptId: string;
      offset: number;
      length: number;
      seq: number;
      contextState: 'in-context' | 'purged';
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
    if (this.reader.curated) {
      const first = await this.reader.entryAt(from);
      const last = await this.reader.entryAt(end - 1);
      for (const id of calls) {
        const label = await this.responseIndex.last(
          id,
          first.label,
          last.label + 1n,
        );
        if (label === undefined) continue;
        const entry = await this.reader.entryByLabel(label);
        if (entry === undefined)
          throw new Error('Indexed native response row is absent');
        responses.set(id, entry);
      }
      return responses;
    }
    let ordinal = from;
    for await (const entry of this.reader.entries(from)) {
      if (ordinal++ >= end) break;
      this.options.signal?.throwIfAborted();
      const ids = await this.reader.responseIds(entry);
      for (const id of ids) if (calls.has(id)) responses.set(id, entry);
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
      const seq = this.reader.chronologySeq(entry);
      if (seq === undefined) continue;
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
                transcriptId: first.transcriptId.toString(),
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
        entry: this.displayEntry(
          first,
          opener,
          projected,
          group.rows,
          group.inContext,
        ),
        before: { row: from, item: firstItem + index },
        after:
          index === items.length - 1 && callStart + 16 >= group.calls
            ? { row: from + group.rows, item: 0 }
            : { row: from, item: firstItem + index + 1 },
      };
    });
  }
  private async readToolCalls(
    first: RowEntry,
    opener: IContent,
    start: number,
  ): Promise<
    Array<Extract<IContent['blocks'][number], { type: 'tool_call' }>>
  > {
    const page = start === 0 ? opener : await this.read(first, start);
    return page.blocks.filter((block) => block.type === 'tool_call');
  }
  private async projectItems(
    first: RowEntry,
    opener: IContent,
    callStart: number,
    responseEntries: ReadonlyMap<string, RowEntry>,
  ): Promise<HistoryItem[]> {
    const selected = await this.readToolCalls(first, opener, callStart);
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
    return withToolPresentations(
      this.reader,
      first,
      iContentToHistoryItems(
        [page, ...responses.values()],
        this.options.emojiFilterMode,
      ),
      first.recordOffset < this.orphanBeforeOffset,
    );
  }
  private async *projectGroup(
    from: number,
    minimumItem = 0,
    maximumItem = Number.POSITIVE_INFINITY,
    tailCount = Number.POSITIVE_INFINITY,
  ): AsyncGenerator<LocatedEntry> {
    const first = await this.reader.entryAt(from);
    const status = await this.reader.status(first);
    if (status === 5 || status === 6) return;
    const presentation = await this.reader.presentation(first);
    if (presentation !== undefined) {
      const display = await this.projectNotice(from, first, presentation);
      if (display !== undefined) yield display;
      return;
    }
    const slices = await this.reader.textSlices(first);
    if (slices !== undefined) {
      yield* this.projectTextSlices(
        from,
        first,
        slices,
        minimumItem,
        maximumItem,
        tailCount,
      );
      return;
    }
    yield* this.projectModelGroup(
      from,
      first,
      minimumItem,
      maximumItem,
      tailCount,
    );
  }
  private async projectNotice(
    from: number,
    first: RowEntry,
    presentation: NonNullable<
      Awaited<ReturnType<NativeJournalPageReader['presentation']>>
    >,
  ): Promise<LocatedEntry | undefined> {
    if (
      presentation.status === 6 ||
      presentation.descriptor.type === 'tool-result' ||
      presentation.descriptor.type === 'tool-approval'
    )
      return undefined;
    const opener = await this.read(first);
    const type = presentation.descriptor.type;
    const text = displayText(opener);
    const item: HistoryItem = {
      ...(type === 'ui-item'
        ? decodeJournalUiItem(text)
        : { type: type === 'slash' || type === 'shell' ? 'info' : type, text }),
      id: -1,
      rowIdentity: {
        kind: 'journal',
        offset: first.recordOffset,
        transcriptId: first.transcriptId.toString(),
        discriminator: 'text',
      },
    };
    return {
      entry: {
        ...this.displayEntry(first, opener, item, 1, false),
        contextState: 'n/a',
      },
      before: { row: from, item: 0 },
      after: { row: from + 1, item: 0 },
    };
  }
  private async *projectModelGroup(
    from: number,
    first: RowEntry,
    minimumItem: number,
    maximumItem: number,
    tailCount: number,
  ): AsyncGenerator<LocatedEntry> {
    const end = await this.groupEnd(from);
    const opener = await this.read(first, 0);
    this.options.counters?.ownership?.retain(opener);
    let itemIndex = 0;
    try {
      const callCount = first.toolCallBlocks;
      const callIds = new Set(
        end === from + 1 ? [] : await this.reader.callIds(first),
      );
      const responseEntries = await this.responseEntries(
        callIds,
        from + 1,
        end,
      );
      const spanEnd = this.responseSpan(responseEntries);
      const inContext = await this.reader.inContext(first);
      for (
        let callStart = 0;
        callStart === 0 || callStart < callCount;
        callStart += 16
      ) {
        const items = await this.projectItems(
          first,
          opener,
          callStart,
          responseEntries,
        );
        if (callStart === 0) {
          const total =
            items.length + Math.max(0, Math.ceil(callCount / 16) - 1);
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
            calls: callCount,
            spanEnd,
            inContext,
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
        if (callCount === 0 || itemIndex >= maximumItem) break;
        if (itemIndex < minimumItem) {
          callStart += (minimumItem - itemIndex) * 16;
          itemIndex = minimumItem;
        }
      }
    } finally {
      this.options.counters?.ownership?.release(opener);
    }
  }
  private async *projectTextItems(
    slices: AsyncIterable<IContent>,
  ): AsyncGenerator<{ content: IContent; item: HistoryItem }> {
    for await (const content of slices) {
      for (const item of iContentToHistoryItems(
        [content],
        this.options.emojiFilterMode,
      ))
        yield { content, item };
    }
  }
  private async *projectTextSlices(
    from: number,
    first: RowEntry,
    slices: AsyncIterable<IContent>,
    minimum: number,
    maximum: number,
    tailCount: number,
  ): AsyncGenerator<LocatedEntry> {
    const tail: LocatedEntry[] = [];
    const inContext = await this.reader.inContext(first);
    const iterator = this.projectTextItems(slices)[Symbol.asyncIterator]();
    let current = await iterator.next();
    let index = 0;
    try {
      while (current.done !== true && index < maximum) {
        const next = await iterator.next();
        const { content, item: original } = current.value;
        const sliced: HistoryItem =
          index > 0 && original.type === 'gemini'
            ? { ...original, type: 'gemini_content' }
            : original;
        const item: HistoryItem = {
          ...sliced,
          rowIdentity: {
            kind: 'journal',
            offset: first.recordOffset,
            transcriptId: first.transcriptId.toString(),
            discriminator: 'text',
            textOffset: index,
          },
        };
        const located: LocatedEntry = {
          entry: this.displayEntry(first, content, item, 1, inContext),
          before: { row: from, item: index },
          after:
            next.done === true
              ? { row: from + 1, item: 0 }
              : { row: from, item: index + 1 },
        };
        if (index >= minimum && !Number.isFinite(tailCount)) yield located;
        if (index >= minimum && Number.isFinite(tailCount)) tail.push(located);
        if (tail.length > tailCount) tail.shift();
        index++;
        current = next;
      }
      yield* tail;
    } finally {
      await iterator.return(undefined);
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
  refreshFileEnd(publishedEnd?: number): Promise<void> {
    return this.enqueue(() => {
      this.publishedEnd = publishedEnd;
      return this.refreshReader();
    });
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
      const entry = located.entry;
      const identity =
        entry.kind === 'boundary'
          ? rowIdentityKey({
              kind: 'journal',
              offset: entry.offset,
              transcriptId: entry.transcriptId,
              discriminator: 'summaryRow',
            })
          : entry.item.rowIdentity && rowIdentityKey(entry.item.rowIdentity);
      if (identity !== undefined)
        this.positions.set(identity, {
          before: located.before,
          after: located.after,
        });
      if (entry.kind !== 'projected') continue;
      this.options.counters?.ownership?.retain(entry.item);
      this.retained.push(entry.item);
    }
    return { entries: selected.map(({ entry }) => entry) };
  }
  retainWindow(keys: readonly string[], direction: 'older' | 'newer'): void {
    const first = keys.at(0);
    const last = keys.at(-1);
    const head = first === undefined ? undefined : this.positions.get(first);
    const tail = last === undefined ? undefined : this.positions.get(last);
    if (keys.length > 0 && (head === undefined || tail === undefined))
      throw new Error('Resident journal window has no cursor positions');
    if (head && tail) {
      this.start = head.before;
      this.end = tail.after;
    } else if (direction === 'older') this.start = this.end;
    else this.end = this.start;
    const resident = new Set(keys);
    for (const key of this.positions.keys())
      if (!resident.has(key)) this.positions.delete(key);
  }
  private async refreshReader(): Promise<void> {
    this.options.signal?.throwIfAborted();
    const next = await NativeJournalPageReader.open(
      this.reader.path,
      this.options.journal,
      this.publishedEnd,
    );
    if (this.options.signal?.aborted === true) {
      await next.close();
      this.options.signal.throwIfAborted();
    }
    if (
      next.groupTag !== this.reader.groupTag &&
      this.rows > 0 &&
      (this.end.row >= this.rows ||
        (await this.groupEnd(this.end.row)) === this.rows)
    ) {
      const tail = await this.reader.entryAt(this.rows - 1);
      if (!this.reader.isHuman(tail))
        this.end = { row: await this.groupStart(this.rows - 1), item: 0 };
    }
    if (next.groupTag !== this.reader.groupTag) this.group = undefined;
    await this.reader.close();
    this.reader = next;
    this.responseIndex = new NativeResponseIndex(next);
  }
  private async locateClearBoundary(): Promise<void> {
    this.boundaryOffset = await this.reader.clearBoundaryOffset();
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
    return this.reader.size;
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
