/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { projectAnthropicUnit } from './anthropic-unit-facts.js';
import { selectLastCacheableBlockIndex } from './AnthropicRequestBuilder.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import { CallerOwnedToolQuery } from '../utils/caller-owned-tool-query.js';
import {
  AnthropicRepairSource,
  type AnthropicRepairRows,
  type RepairMessage,
  type RepairPolicy,
} from './anthropic-repair-source.js';
import type { AnthropicRequestRepairIndex } from './anthropic-repair-index.js';
import type { ToolRepairOverlay } from './anthropic-tool-repair.js';
import { decideAnthropicTool } from './anthropic-tool-decision.js';
import {
  AnthropicStreamRepair,
  numericRepairPiece,
} from './anthropic-stream-repair.js';
import {
  beginAnthropicCacheAtom,
  addAnthropicCachePiece,
  finishAnthropicCacheAtom,
  anthropicCachePlan,
  type AnthropicCacheState,
  type AnthropicCachePlan,
} from './anthropic-cache-facts.js';

class CallerOwnedAnthropicIndex implements AnthropicRequestRepairIndex {
  private readonly entries: RepairMessage[] = [];
  private readonly decisions = new Map<string, ToolRepairOverlay | undefined>();
  private readonly selected = new Map<string, number>();
  private readonly consumed = new Map<
    string,
    { ordinal: number; inserted: boolean }
  >();
  lastThinking = -1;
  constructor(
    private readonly source: AnthropicRepairSource<AnthropicRepairRows>,
    private readonly toolFree: boolean,
  ) {}

  async prepare(): Promise<void> {
    if (this.toolFree) {
      this.lastThinking = await this.source.lastThinking();
      return;
    }
    for await (const message of this.source.messages()) {
      const previous =
        this.entries.length === 0
          ? undefined
          : this.entries[this.entries.length - 1];
      if (
        previous !== undefined &&
        previous.slot === 'results' &&
        message.chainResults === true &&
        (await this.source.describe(previous.end))?.speaker === 'tool'
      )
        this.entries[this.entries.length - 1] = {
          ...previous,
          end: message.end,
        };
      else this.entries.push(message);
    }
    this.lastThinking = await this.source.lastThinking();
    for (let at = 0; at < this.entries.length; at++) {
      const message = this.entries[at];
      if (message.role !== 'assistant') continue;
      const next = await this.nextMessage(at);
      for await (const call of this.source.calls(message))
        await this.decide(message, next, call.id);
    }
  }
  async rawResultsAt(at: number): Promise<RepairMessage | undefined> {
    return this.entries.find(
      (message) =>
        message.slot === 'results' && message.start <= at && at <= message.end,
    );
  }
  async rawChainAt(at: number): Promise<RepairMessage | undefined> {
    return this.entries.find(
      (message) =>
        message.slot === 'chain' && message.start <= at && at <= message.end,
    );
  }
  async *messages(from: number): AsyncGenerator<RepairMessage> {
    if (this.toolFree) {
      yield* this.source.messages(from);
      return;
    }
    let low = 0;
    let high = this.entries.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.entries[middle].end < from) low = middle + 1;
      else high = middle;
    }
    for (let at = low; at < this.entries.length; at++) yield this.entries[at];
  }
  async decision(
    message: RepairMessage,
    id: string,
  ): Promise<ToolRepairOverlay | undefined> {
    return this.decisions.get(JSON.stringify([message.start, id]));
  }
  async taken(id: string, ordinal: number, before: number): Promise<boolean> {
    const at = this.selected.get(JSON.stringify([id, ordinal]));
    return at !== undefined && at <= before;
  }
  private async survives(message: RepairMessage): Promise<boolean> {
    if (message.slot !== 'results') return true;
    for (let at = message.start; at <= message.end; at++)
      if (await this.survivesAt(message, at)) return true;
    return false;
  }
  private async survivesAt(
    message: RepairMessage,
    at: number,
  ): Promise<boolean> {
    const query = this.source.query;
    const local = new Map<string, number>();
    for await (const piece of this.source.pieces(
      { ...message, start: at, end: at },
      false,
    )) {
      if (typeof piece === 'string') continue;
      for (const block of piece) {
        if (block.type !== 'tool_result') continue;
        const id = block.tool_use_id;
        const within = (local.get(id) ?? 0) + 1;
        local.set(id, within);
        const ordinal =
          (await query.normalizedCount(2, 1, id, { from: 0, to: at })) + within;
        if (
          (await query.normalizedCount(2, 0, id)) > 0 &&
          !(await this.taken(id, ordinal, message.start - 1))
        )
          return true;
      }
    }
    return false;
  }
  private async nextMessage(at: number): Promise<RepairMessage | undefined> {
    for (let following = at + 1; following < this.entries.length; following++) {
      const candidate = this.entries[following];
      if (await this.survives(candidate)) return candidate;
    }
    return undefined;
  }
  private async decide(
    message: RepairMessage,
    next: RepairMessage | undefined,
    id: string,
  ): Promise<void> {
    const key = JSON.stringify([message.start, id]);
    if (this.decisions.has(key)) return;
    const state = this.consumed.get(id) ?? { ordinal: 0, inserted: false };
    const query = this.source.query;
    const count = await query.normalizedCount(2, 1, id);
    const result = await decideAnthropicTool(
      {
        count,
        countBefore: (before) =>
          query.normalizedCount(2, 1, id, { from: 0, to: before }),
      },
      state,
      next,
    );
    this.decisions.set(
      key,
      result.taken === undefined && !result.missing
        ? undefined
        : {
            id,
            callMessage: message.start,
            target: next?.role === 'user' ? next.start : undefined,
            resultOrdinal: result.taken,
            interrupted: result.missing,
          },
    );
    this.consumed.set(id, {
      ordinal: result.taken ?? state.ordinal,
      inserted: state.inserted || result.missing,
    });
    if (result.taken !== undefined)
      this.selected.set(JSON.stringify([id, result.taken]), message.start);
  }
}

export async function callerOwnedAnthropicEngine(
  rows: ProviderRequestRows,
  settings: RowFormatSettings,
  policy: RepairPolicy,
  rawDump = false,
): Promise<AnthropicStreamRepair<AnthropicRepairRows>> {
  const toolQuery = await CallerOwnedToolQuery.create(rows, (row) =>
    projectAnthropicUnit(row, settings, false),
  );
  const query: AnthropicRepairRows = Object.assign(toolQuery, {
    readAt: rows.readAt,
    rawChainAt: (at: number) => index.rawChainAt(at),
    rawResultsAt: (at: number) => index.rawResultsAt(at),
    rawDump,
  });
  const source = new AnthropicRepairSource(
    query,
    settings,
    undefined,
    undefined,
    false,
  );
  const index = new CallerOwnedAnthropicIndex(source, !toolQuery.hasToolBlocks);
  await index.prepare();
  return AnthropicStreamRepair.fromSource(
    new AnthropicRepairSource(query, settings, index, undefined, false),
    index,
    policy,
  );
}

export async function callerOwnedAnthropicCache(
  engine: Pick<AnthropicStreamRepair<AnthropicRepairRows>, 'atoms' | 'source'>,
  settings: RowFormatSettings,
  ttl: '5m' | '1h',
): Promise<AnthropicCachePlan> {
  let state: AnthropicCacheState = {};
  for await (const atom of engine.atoms()) {
    const anchored =
      !atom.repair &&
      atom.results !== true &&
      (await engine.source.query.readAt(atom.end ?? Math.floor(atom.key / 4)))
        .metadata?.cacheAnchor === true;
    const before = state.run?.role === atom.role ? state.run.blocks : 0;
    state = beginAnthropicCacheAtom(state, atom.role, atom.chain);
    for await (const piece of atom.openPieces())
      state = addAnthropicCachePiece(
        state,
        numericRepairPiece(piece, atom.role, anchored),
      );
    state = finishAnthropicCacheAtom(state, anchored, before);
  }
  return anthropicCachePlan(state, settings, ttl);
}

export async function callerOwnedPurgeCache(
  engine: Pick<AnthropicStreamRepair<AnthropicRepairRows>, 'cacheBlocks'>,
  cache: AnthropicCachePlan,
  prefixBreakpoints: number,
): Promise<AnthropicCachePlan> {
  type Target = AnthropicCachePlan['targets'][number];
  let previous: Target | undefined;
  let expected: Target | undefined;
  let tagged: Target | undefined;
  let tags = 0;
  let image = false;
  let breakpoints = prefixBreakpoints + cache.targets.length;
  const same = (left: Target, right: Target): boolean =>
    left.run === right.run && left.block === right.block;
  for await (const entry of engine.cacheBlocks()) {
    const cached = cache.targets.some((target) => same(target, entry.target));
    if ('cache_control' in entry.block && !cached) breakpoints++;
    if (entry.purge !== undefined && !(entry.target.string && cached)) {
      tags++;
      tagged = entry.target;
    }
    if (!image && entry.block.type === 'image') {
      image = true;
      expected = previous;
    }
    if (selectLastCacheableBlockIndex([entry.block]) === 0)
      previous = entry.target;
  }
  if (tags !== 1 || tagged === undefined || expected === undefined)
    return cache;
  if (
    !same(tagged, expected) ||
    breakpoints >= 3 ||
    cache.targets.some((target) => same(target, tagged))
  )
    return cache;
  const markerBytes =
    Buffer.byteLength(
      JSON.stringify({ cache_control: { type: 'ephemeral', ttl: cache.ttl } }),
    ) - 1;
  const blockify =
    Buffer.byteLength(JSON.stringify([{ type: 'text', text: '' }])) - 2;
  return {
    ...cache,
    targets: [...cache.targets, tagged],
    bytes: cache.bytes + markerBytes + (tagged.string ? blockify : 0),
  };
}
