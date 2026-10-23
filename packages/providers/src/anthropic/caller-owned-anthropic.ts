/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
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
  ) {}

  async prepare(): Promise<void> {
    for await (const message of this.source.messages())
      this.entries.push(message);
    this.lastThinking = await this.source.lastThinking();
    for (let at = 0; at < this.entries.length; at++) {
      const message = this.entries[at];
      if (message.role !== 'assistant') continue;
      const next = await this.nextMessage(at);
      for await (const call of this.source.calls(message))
        await this.decide(message, next, call.id);
    }
  }
  async *messages(from: number): AsyncGenerator<RepairMessage> {
    for (const message of this.entries) if (message.end >= from) yield message;
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
): Promise<AnthropicStreamRepair<AnthropicRepairRows>> {
  const query = Object.assign(await CallerOwnedToolQuery.create(rows), {
    readAt: rows.readAt,
  });
  const source = new AnthropicRepairSource(query, settings);
  const index = new CallerOwnedAnthropicIndex(source);
  await index.prepare();
  return AnthropicStreamRepair.fromSource(
    new AnthropicRepairSource(query, settings, index),
    index,
    policy,
  );
}

export async function callerOwnedAnthropicCache(
  engine: Pick<AnthropicStreamRepair, 'atoms'>,
  settings: RowFormatSettings,
  ttl: '5m' | '1h',
): Promise<AnthropicCachePlan> {
  let state: AnthropicCacheState = {};
  for await (const atom of engine.atoms()) {
    state = beginAnthropicCacheAtom(state, atom.role, atom.chain);
    const before = state.run?.blocks ?? 0;
    for await (const piece of atom.openPieces())
      state = addAnthropicCachePiece(
        state,
        numericRepairPiece(piece, atom.role),
      );
    state = finishAnthropicCacheAtom(state, false, before);
  }
  return anthropicCachePlan(state, settings, ttl);
}
