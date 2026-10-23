/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import type { VersionSnapshot } from '@vybestack/llxprt-code-core/journal/versionSnapshot.js';
import { unitCount } from '@vybestack/llxprt-code-core/journal/unitContributions.js';
import type { AnthropicRepairIndex } from './anthropic-repair-index.js';
import type {
  AnthropicRepairSource,
  RepairMessage,
} from './anthropic-repair-source.js';
import { AnthropicViewCoordinates } from './anthropic-view-coordinates.js';

export interface AnthropicSpan {
  readonly start: number;
  readonly end: number;
}
async function* merge(
  left: AsyncGenerator<number>,
  right: AsyncGenerator<number>,
): AsyncGenerator<number> {
  try {
    let a = await left.next();
    let b = await right.next();
    let previous = -1;
    while (a.done !== true || b.done !== true) {
      const value =
        b.done === true || (a.done !== true && a.value <= b.value) ? a : b;
      if (value.done !== true && value.value !== previous) {
        previous = value.value;
        yield value.value;
      }
      if (value === a) a = await left.next();
      else b = await right.next();
    }
  } finally {
    await left.return(undefined);
    await right.return(undefined);
  }
}
export class AnthropicSpanPlan {
  readonly coordinates: AnthropicViewCoordinates;
  readonly ids = new Set<string>();
  readonly source: AnthropicRepairSource;
  private readonly windows: AnthropicSpan[] = [];
  private readonly topology: AnthropicSpan[] = [];
  async extendThinking(at: number): Promise<void> {
    for await (const message of this.source.messages(at, at + 1))
      if (message.end > at)
        this.topology.push({ start: at, end: message.end + 1 });
    this.topology.sort((left, right) => left.start - right.start);
  }
  affected:
    | ((id: string, at: number, kind: 0 | 1) => Promise<boolean>)
    | undefined;
  constructor(
    readonly snapshot: VersionSnapshot,
    readonly query: IndexedJournalRequestSnapshot,
    readonly base: IndexedJournalRequestSnapshot,
    readonly index: AnthropicRepairIndex,
    source: AnthropicRepairSource,
  ) {
    this.coordinates = new AnthropicViewCoordinates(query, snapshot.units);
    this.source = source;
  }
  async prepare(): Promise<void> {
    for (const { row, oldStart } of this.coordinates.changes) {
      for (let at = oldStart; at < oldStart + row.oldCount; at++)
        for (const fact of await this.base.anthropicToolFactsAt(at))
          this.ids.add(fact.id);
      for (let at = row.start; at < row.start + row.count; at++)
        for (const fact of await this.query.anthropicToolFactsAt(at))
          this.ids.add(fact.id);
    }
    for (let at = this.coordinates.prefixEnd; at < this.query.count; at++)
      for (const fact of await this.query.anthropicToolFactsAt(at))
        this.ids.add(fact.id);
  }
  async prepareCache(): Promise<void> {
    const facts = this.index.facts;
    const runs = await facts.get(['cache-runs']);
    const anchors = await facts.get(['cache-anchors']);
    if (runs === undefined || anchors === undefined)
      throw new Error('Missing Anthropic cache windows');
    const add = async (start: number, end: number): Promise<void> => {
      if (start >= end || start >= this.query.count) return;
      const left = await this.bounds(start);
      const right = await this.bounds(Math.min(this.query.count - 1, end - 1));
      this.windows.push({ start: left.start, end: right.end });
    };
    const firstAnchor = await this.firstCacheAnchor(anchors[0]);
    if (firstAnchor !== undefined) {
      const window = await this.cacheRun(firstAnchor, runs[0]);
      await add(
        this.coordinates.forward(window[0]),
        this.coordinates.forward(window[1] - 1) + 1,
      );
    }
    if (runs[0] > 0) {
      const tail = await facts.get(['cache-run', runs[0] - 1]);
      if (tail === undefined)
        throw new Error('Missing Anthropic cache tail window');
      await add(this.coordinates.forward(tail[0]), this.query.count);
    }
    for (const row of this.query.viewPlan.changedSources)
      for (let at = row.start; at < row.start + row.count; at++)
        await this.addChangedCacheWindow(at, runs[0], add);
    this.windows.sort((left, right) => left.start - right.start);
  }
  private async addChangedCacheWindow(
    at: number,
    runs: number,
    add: (start: number, end: number) => Promise<void>,
  ): Promise<void> {
    const old = this.coordinates.backward(at);
    if (
      old >= this.snapshot.units ||
      runs === 0 ||
      (await this.query.planAt(at)).header.metadata?.cacheAnchor !== true
    )
      return;
    const window = await this.cacheRun(old, runs);
    await add(
      this.coordinates.forward(window[0]),
      this.coordinates.forward(window[1] - 1) + 1,
    );
  }
  private async firstCacheAnchor(count: number): Promise<number | undefined> {
    for (let ordinal = 0; ordinal < count; ordinal++) {
      const anchor = await this.index.facts.get(['cache-anchor', ordinal]);
      if (anchor === undefined)
        throw new Error('Missing Anthropic cache anchor window');
      const removed = this.coordinates.changes.some(
        ({ row, oldStart }) =>
          row.count === 0 &&
          anchor[0] >= oldStart &&
          anchor[0] < oldStart + row.oldCount,
      );
      if (removed) continue;
      const at = this.coordinates.forward(anchor[0]);
      if (
        at < this.query.count &&
        (await this.query.planAt(at)).header.metadata?.cacheAnchor === true
      )
        return anchor[0];
    }
    return undefined;
  }
  private async cacheRun(
    at: number,
    count: number,
  ): Promise<readonly number[]> {
    let low = 0;
    let high = count;
    while (low + 1 < high) {
      const mid = (low + high) >> 1;
      const run = await this.index.facts.get(['cache-run', mid]);
      if (run === undefined)
        throw new Error('Missing Anthropic cache run window');
      if (run[0] <= at) low = mid;
      else high = mid;
    }
    const run = await this.index.facts.get(['cache-run', low]);
    if (run === undefined)
      throw new Error('Missing Anthropic cache run window');
    return run;
  }
  private async *changed(): AsyncGenerator<number> {
    for (const { row } of this.coordinates.changes) {
      yield Math.max(0, row.start - 1);
      for (let at = row.start; at <= row.start + row.count; at++) yield at;
    }
    for (
      let at = Math.max(0, this.coordinates.prefixEnd - 1);
      at < this.query.count;
      at++
    )
      yield at;
  }
  private async *holders(id: string, kind: 0 | 1): AsyncGenerator<number> {
    async function* mapped(plan: AnthropicSpanPlan): AsyncGenerator<number> {
      for await (const at of plan.base.normalizedRange(2, kind, id))
        yield plan.coordinates.forward(at);
    }
    for await (const at of merge(
      mapped(this),
      this.query.normalizedRange(2, kind, id),
    ))
      if (this.affected === undefined || (await this.affected(id, at, kind)))
        yield at;
  }
  private streams(holders: boolean): AsyncGenerator<number> {
    async function* windows(plan: AnthropicSpanPlan): AsyncGenerator<number> {
      for (const window of plan.windows) yield window.start;
    }
    async function* topology(plan: AnthropicSpanPlan): AsyncGenerator<number> {
      for (const span of plan.topology) yield span.start;
    }
    const streams = holders
      ? [this.changed(), topology(this), windows(this)]
      : [this.changed(), topology(this)];
    if (holders)
      for (const id of this.ids)
        for (const kind of [0, 1] satisfies Array<0 | 1>)
          streams.push(this.holders(id, kind));
    const combine = (from: number, to: number): AsyncGenerator<number> =>
      to - from === 1
        ? streams[from]
        : merge(combine(from, (from + to) >> 1), combine((from + to) >> 1, to));
    return combine(0, streams.length);
  }
  private async bounds(at: number): Promise<AnthropicSpan> {
    const window =
      this.topology.find((candidate) => candidate.start === at) ??
      this.windows.find((candidate) => candidate.start === at);
    let start = window?.start ?? Math.max(0, at - 1);
    let end = window?.end ?? Math.min(this.query.count, at + 2);
    if (start >= end) return { start, end };
    const old = this.coordinates.backward(start);
    const previous = await this.index.before(old + 1);
    if (previous !== undefined && previous.end >= old)
      start = Math.max(
        0,
        Math.min(start, this.coordinates.forward(previous.start)),
      );
    const oldEnd = this.coordinates.backward(end - 1);
    for await (const message of this.index.messages(oldEnd)) {
      if (message.start > oldEnd) break;
      end = Math.min(
        this.query.count,
        Math.max(end, this.coordinates.forward(message.end) + 1),
      );
    }
    const first = await this.query.unitEntryAt(start);
    start -= first.unit;
    const last = await this.query.unitEntryAt(end - 1);
    const changed = this.query.viewPlan.changedSources.find(
      (row) => row.entry.label === last.entry.label,
    );
    end += (changed?.count ?? unitCount(last.entry)) - last.unit - 1;
    return { start, end };
  }
  async *spans(holders = true): AsyncGenerator<AnthropicSpan> {
    let pending: AnthropicSpan | undefined;
    for await (const at of this.streams(holders)) {
      const span = await this.bounds(at);
      if (span.start >= span.end) continue;
      if (pending !== undefined && pending.end < span.start) {
        yield pending;
        pending = undefined;
      }
      pending = {
        start: Math.min(pending?.start ?? span.start, span.start),
        end: Math.max(pending?.end ?? span.end, span.end),
      };
    }
    if (pending !== undefined) yield pending;
  }
  private async *persistedMessages(
    from: number,
    to: number,
  ): AsyncGenerator<RepairMessage> {
    for await (const message of this.index.messages(
      this.coordinates.backward(from),
    )) {
      const mapped = this.coordinates.message(message);
      if (mapped.start >= to) return;
      if (mapped.end >= from) yield mapped;
    }
  }
  async *messages(from: number): AsyncGenerator<RepairMessage> {
    let cursor = from;
    for await (const span of this.spans()) {
      if (span.end <= from) continue;
      if (cursor < span.start)
        yield* this.persistedMessages(cursor, span.start);
      for await (const message of this.topologyMessages(
        Math.max(from, span.start),
      )) {
        if (message.start >= span.end) break;
        yield message;
      }
      cursor = span.end;
    }
    if (cursor < this.coordinates.prefixEnd)
      yield* this.persistedMessages(cursor, this.query.count);
  }
  async *topologyMessages(from: number): AsyncGenerator<RepairMessage> {
    let cursor = from;
    for await (const span of this.spans(false)) {
      if (span.end <= from) continue;
      if (cursor < span.start)
        yield* this.persistedMessages(cursor, span.start);
      for await (const message of this.source.messages(span.start, span.end))
        if (message.end >= from) yield message;
      cursor = span.end;
    }
    if (cursor < this.coordinates.prefixEnd)
      for await (const message of this.index.messages(
        this.coordinates.backward(cursor),
      ))
        yield this.coordinates.message(message);
  }
}
