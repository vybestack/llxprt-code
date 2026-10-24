/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { VersionSnapshot } from '@vybestack/llxprt-code-core/journal/versionSnapshot.js';
import type {
  NativeFactIndexRegistration,
  NativeFactIndexWriter,
} from '@vybestack/llxprt-code-core/journal/nativeFactIndex.js';
import type {
  NormalizedFamily,
  OccurrenceKind,
} from '@vybestack/llxprt-code-core/journal/idKeys.js';
import {
  rowFormatKey,
  type RowFormatSettings,
} from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import { decodeStoredRow } from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';
import { assertRowIndex } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { normalizeToAnthropicToolId } from '@vybestack/llxprt-code-tools/toolIdNormalization.js';
import {
  AnthropicRepairSource,
  type RepairMessage,
  type AnthropicRepairRows,
} from './anthropic-repair-source.js';
import {
  AnthropicRepairIndex,
  sameFactVersion,
  writeRepairMessage,
  type ScalarFacts,
} from './anthropic-repair-index.js';
import { decideAnthropicTool } from './anthropic-tool-decision.js';

export class RawAnthropicQuery implements AnthropicRepairRows {
  readonly count: number;
  constructor(
    private readonly snapshot: VersionSnapshot,
    private readonly facts: ScalarFacts,
    private readonly generation?: readonly number[],
  ) {
    this.count = snapshot.rows;
  }
  async rawChainAt(
    at: number,
  ): Promise<{ readonly start: number; readonly end: number } | undefined> {
    const chain = await this.facts.get(['raw-chain', at]);
    const version = this.generation ?? (await this.facts.get(['version']));
    return version !== undefined && sameFactVersion(chain, version)
      ? { start: chain[2], end: chain[3] }
      : undefined;
  }
  async readAt(index: number): Promise<IContent> {
    assertRowIndex(index, this.count);
    return decodeStoredRow(
      await this.snapshot.readRow(await this.snapshot.entryAt(index)),
    );
  }
  async normalizedPosition(
    family: NormalizedFamily,
    kind: OccurrenceKind,
    id: string,
    ordinal: number,
  ): Promise<number | undefined> {
    return (
      await this.facts.get(['raw-position', family, kind, id, ordinal])
    )?.[0];
  }
  private async bound(
    family: NormalizedFamily,
    kind: OccurrenceKind,
    id: string,
    count: number,
    at: number,
  ): Promise<number> {
    let low = 0;
    let high = count;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const position = await this.normalizedPosition(family, kind, id, mid + 1);
      if (position === undefined)
        throw new Error('Missing raw Anthropic occurrence');
      if (position < at) low = mid + 1;
      else high = mid;
    }
    return low;
  }
  async normalizedCount(
    family: NormalizedFamily,
    kind: OccurrenceKind,
    id: string,
    range?: { readonly from: number; readonly to: number },
  ): Promise<number> {
    const stored = await this.facts.get(['raw-count', family, kind, id]);
    const version = this.generation ?? (await this.facts.get(['version']));
    if (version === undefined)
      throw new Error('Missing raw Anthropic fact version');
    const count = sameFactVersion(stored, version) ? stored[2] : 0;
    return range === undefined
      ? count
      : (await this.bound(family, kind, id, count, range.to)) -
          (await this.bound(family, kind, id, count, range.from));
  }
}

async function survives(
  source: AnthropicRepairSource<AnthropicRepairRows>,
  index: AnthropicRepairIndex,
  message: RepairMessage,
): Promise<boolean> {
  if (message.slot !== 'results') return true;
  for (let at = message.start; at <= message.end; at++)
    if (await survivesAt(source, index, message, at)) return true;
  return false;
}

async function survivesAt(
  source: AnthropicRepairSource<AnthropicRepairRows>,
  index: AnthropicRepairIndex,
  message: RepairMessage,
  at: number,
): Promise<boolean> {
  const local = new Map<string, number>();
  for await (const piece of source.pieces(
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
        (await source.query.normalizedCount(2, 1, id, { from: 0, to: at })) +
        within;
      if (
        (await source.query.normalizedCount(2, 0, id)) > 0 &&
        !(await index.taken(id, ordinal, message.start - 1))
      )
        return true;
    }
  }
  return false;
}

async function decide(
  source: AnthropicRepairSource<AnthropicRepairRows>,
  writer: NativeFactIndexWriter,
  index: AnthropicRepairIndex,
  message: RepairMessage,
  next: RepairMessage | undefined,
  id: string,
): Promise<void> {
  if (
    sameFactVersion(
      await writer.get(['decision', message.start, id]),
      index.version,
    )
  )
    return;
  const stored = await writer.get(['state', id]);
  const state = sameFactVersion(stored, index.version)
    ? { ordinal: stored[2], inserted: stored[3] !== 0 }
    : { ordinal: 0, inserted: false };
  const query = source.query;
  const result = await decideAnthropicTool(
    {
      count: await query.normalizedCount(2, 1, id),
      countBefore: (to) => query.normalizedCount(2, 1, id, { from: 0, to }),
    },
    state,
    next,
  );
  await writer.set(
    ['decision', message.start, id],
    [
      ...index.version,
      next?.role === 'user' ? next.start + 1 : 0,
      result.taken ?? 0,
      Number(result.missing),
    ],
  );
  await writer.set(
    ['state', id],
    [
      ...index.version,
      result.taken ?? state.ordinal,
      Number(state.inserted || result.missing),
    ],
  );
  if (result.taken !== undefined)
    await writer.set(
      ['taken', id, result.taken],
      [...index.version, message.start + 1],
    );
}

async function writeOccurrences(
  query: RawAnthropicQuery,
  writer: NativeFactIndexWriter,
  generation: readonly number[],
): Promise<void> {
  let leading = true;
  for (let at = 0; at < query.count; at++) {
    const row = await query.readAt(at);
    leading &&= row.speaker === 'tool';
    const tools = row.blocks.filter(
      (block) => block.type === 'tool_call' || block.type === 'tool_response',
    );
    for (const block of tools) {
      const call = block.type === 'tool_call';
      if (call ? row.speaker !== 'ai' : leading) continue;
      const id = normalizeToAnthropicToolId(call ? block.id : block.callId);
      const kind = Number(!call);
      const key = ['raw-count', 2, kind, id];
      const stored = await writer.get(key);
      const count = sameFactVersion(stored, generation) ? stored[2] : 0;
      await writer.set(key, [...generation, count + 1]);
      await writer.set(['raw-position', 2, kind, id, count + 1], [at]);
    }
  }
}

export function rawAnthropicFactIndex(
  settings: RowFormatSettings,
): NativeFactIndexRegistration {
  return {
    scope: `anthropic-raw:1:${rowFormatKey(settings)}`,
    async write(snapshot, writer, generation) {
      const query = new RawAnthropicQuery(snapshot, writer, generation);
      await writeOccurrences(query, writer, generation);
      const source = new AnthropicRepairSource(
        query,
        settings,
        undefined,
        undefined,
        false,
      );
      let count = 0;
      let last = -1;
      for await (const message of source.messages()) {
        await writeRepairMessage(writer, ++count, message, generation);
        if (message.slot === 'chain') {
          for (let at = message.start; at <= message.end; at++)
            await writer.set(
              ['raw-chain', at],
              [...generation, message.start, message.end],
            );
        }
        if (
          message.role === 'assistant' &&
          (await source.describe(message.start))?.thinking === true
        )
          last = message.start;
      }
      await writer.set(['messages'], [count, last + 1]);
      const index = await AnthropicRepairIndex.prepared(writer, generation);
      for (let ordinal = 1; ordinal <= count; ordinal++) {
        const message = await index.message(ordinal);
        if (message.role !== 'assistant') continue;
        let next: RepairMessage | undefined;
        for (let following = ordinal + 1; following <= count; following++) {
          const candidate = await index.message(following);
          if (await survives(source, index, candidate)) {
            next = candidate;
            break;
          }
        }
        for await (const call of source.calls(message))
          await decide(source, writer, index, message, next, call.id);
      }
    },
  };
}
