/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import type { VersionSnapshot } from '@vybestack/llxprt-code-core/journal/versionSnapshot.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import type { SlotSummary } from '@vybestack/llxprt-code-core/journal/slotSummary.js';
import {
  composeSlotSummaries,
  identitySlotSummary,
} from '@vybestack/llxprt-code-core/journal/summaryComposition.js';
import { requestFormatSlot } from '@vybestack/llxprt-code-core/services/history/native-provider-format.js';
import {
  AnthropicRepairIndex,
  anthropicRepairScope,
} from './anthropic-repair-index.js';
import {
  AnthropicRepairSource,
  type RepairPolicy,
} from './anthropic-repair-source.js';
import {
  anthropicUnitFacts,
  type AnthropicAtom,
} from './anthropic-unit-facts.js';
import {
  type AnthropicStreamRepair,
  numericRepairPiece,
} from './anthropic-stream-repair.js';
import { anthropicUnitTransfer } from './anthropic-unit-transfer.js';
import { AnthropicViewCoordinates } from './anthropic-view-coordinates.js';
import { readAnthropicCacheFacts } from './anthropic-cache-facts.js';
import type { StoredAnthropicRequestPlan } from './journal-anthropic-length.js';

function topology(atoms: readonly AnthropicAtom[]): unknown {
  return atoms.map((atom) =>
    atom.form === 'string'
      ? { ...atom, bytes: 0 }
      : {
          ...atom,
          blocks: atom.blocks.map((block) => ({ ...block, bytes: 0 })),
        },
  );
}
async function stableHolder(
  base: IndexedJournalRequestSnapshot,
  query: IndexedJournalRequestSnapshot,
  settings: RowFormatSettings,
  index: AnthropicRepairIndex,
  start: number,
  count: number,
  oldStart = start,
): Promise<boolean> {
  const end = oldStart + count;
  for await (const message of index.messages(oldStart)) {
    if (message.start >= end) break;
    if (message.start < oldStart || message.end >= end) return false;
  }
  for (let within = 0; within < count; within++) {
    const old = await base.readAt(oldStart + within);
    const next = await query.readAt(start + within);
    if (
      old.speaker !== next.speaker ||
      old.metadata?.cacheAnchor !== next.metadata?.cacheAnchor
    )
      return false;
    const before = anthropicUnitFacts(old, settings);
    const after = anthropicUnitFacts(next, settings);
    if (before === undefined || after === undefined) return false;
    if (
      before.chainStart !== after.chainStart ||
      before.hasThinking !== after.hasThinking
    )
      return false;
    for (const variant of [0, 1]) {
      if (
        JSON.stringify(topology(before.atoms[variant])) !==
        JSON.stringify(topology(after.atoms[variant]))
      )
        return false;
    }
  }
  return true;
}
async function isolatedTail(
  snapshot: VersionSnapshot,
  query: IndexedJournalRequestSnapshot,
  settings: RowFormatSettings,
  index: AnthropicRepairIndex,
): Promise<boolean> {
  const source = new AnthropicRepairSource(query, settings);
  const coordinates = new AnthropicViewCoordinates(query, snapshot.units);
  const first =
    coordinates.prefixEnd < query.count
      ? await source.describe(coordinates.prefixEnd)
      : undefined;
  if (index.count > 0 && first !== undefined) {
    const last = coordinates.message(await index.message(index.count));
    if (
      first.speaker === 'ai' &&
      (last.slot === 'chain' ||
        (await source.describe(last.start))?.chain === true)
    )
      return false;
    if (first.speaker !== 'ai' && last.role === 'assistant') {
      for await (const _call of source.calls(last)) return false;
    }
  }
  for (let at = coordinates.prefixEnd; at < query.count; at++) {
    const row = await query.readAt(at);
    if (
      row.blocks.some(
        (block) =>
          !['text', 'code', 'media', 'tool_call', 'tool_response'].includes(
            block.type,
          ),
      )
    )
      return false;
    for (const fact of await query.anthropicToolFactsAt(at)) {
      if (fact.uses !== 1 || fact.results !== 1) return false;
      const call = await query.normalizedPosition(2, 0, fact.id, 1);
      const result = await query.normalizedPosition(2, 1, fact.id, 1);
      if (
        call === undefined ||
        call < coordinates.prefixEnd ||
        result !== call + 1
      )
        return false;
    }
  }
  return true;
}
async function independentTool(
  base: IndexedJournalRequestSnapshot,
  start: number,
  end: number,
  id: string,
): Promise<boolean> {
  for (const kind of [0, 1] satisfies ReadonlyArray<0 | 1>)
    for await (const holder of base.normalizedRange(2, kind, id))
      if (holder < start || holder >= end) return false;
  return true;
}

async function independentBoundary(
  base: IndexedJournalRequestSnapshot,
  settings: RowFormatSettings,
  index: AnthropicRepairIndex,
  start: number,
  end: number,
): Promise<boolean> {
  if (start === 0 || end >= base.count) return false;
  const first = index.count === 0 ? undefined : await index.message(1);
  if (first !== undefined && start <= first.end) return false;
  const previous = await index.before(start);
  const source = new AnthropicRepairSource(base, settings);
  if (previous?.slot === 'results' || previous?.slot === 'chain') return false;
  if (previous?.role === 'assistant') {
    if ((await source.describe(previous.start))?.chain === true) return false;
    for await (const _call of source.calls(previous)) return false;
  }
  for await (const message of index.messages(start)) {
    if (message.start >= end) break;
    if (message.start < start || message.end >= end) return false;
  }
  return true;
}

async function independentReplacement(
  base: IndexedJournalRequestSnapshot,
  query: IndexedJournalRequestSnapshot,
  settings: RowFormatSettings,
  index: AnthropicRepairIndex,
  change: AnthropicViewCoordinates['changes'][number],
): Promise<boolean> {
  const { row, oldStart } = change;
  const end = oldStart + row.oldCount;
  if (
    row.start === 0 ||
    !(await independentBoundary(base, settings, index, oldStart, end))
  )
    return false;
  for (let at = oldStart; at < end; at++) {
    const old = await base.readAt(at);
    if (old.blocks.some((block) => block.type === 'thinking')) return false;
    for (const fact of await base.anthropicToolFactsAt(at))
      if (!(await independentTool(base, oldStart, end, fact.id))) return false;
  }
  for (let at = row.start; at < row.start + row.count; at++) {
    const next = await query.readAt(at);
    if (
      next.speaker === 'tool' ||
      next.metadata?.cacheAnchor === true ||
      next.blocks.some(
        (block) => !['text', 'code', 'media'].includes(block.type),
      )
    )
      return false;
  }
  return true;
}

async function replacementCacheSupported(
  snapshot: VersionSnapshot,
  query: IndexedJournalRequestSnapshot,
  settings: RowFormatSettings,
  coordinates: AnthropicViewCoordinates,
  plan: StoredAnthropicRequestPlan,
): Promise<boolean> {
  if (plan.cache === undefined) return true;
  const auxiliary = await snapshot.formatAuxiliary(
    requestFormatSlot(snapshot, settings),
  );
  if (auxiliary === undefined) throw new Error('Missing Anthropic cache facts');
  const facts = readAnthropicCacheFacts(auxiliary).current;
  for (const state of [facts.kept, facts.stripped, facts.corrected])
    if (
      state.anchor !== undefined ||
      state.run?.leadingAnchor !== undefined ||
      state.run?.otherAnchor !== undefined
    )
      return false;
  if (coordinates.prefixEnd === query.count) return false;
  const first = await query.readAt(coordinates.prefixEnd);
  return first.speaker === 'human' && facts.kept.run?.role === 'assistant';
}

async function supportedChange(
  base: IndexedJournalRequestSnapshot,
  query: IndexedJournalRequestSnapshot,
  settings: RowFormatSettings,
  index: AnthropicRepairIndex,
  change: AnthropicViewCoordinates['changes'][number],
): Promise<boolean> {
  const { row, oldStart } = change;
  return row.count !== row.oldCount
    ? independentReplacement(base, query, settings, index, change)
    : stableHolder(
        base,
        query,
        settings,
        index,
        row.start,
        row.count,
        oldStart,
      );
}

export async function supportsAnthropicPendingTail(
  snapshot: VersionSnapshot,
  query: IndexedJournalRequestSnapshot,
  settings: RowFormatSettings,
  plan: StoredAnthropicRequestPlan,
  recovery: boolean,
): Promise<boolean> {
  const index = await AnthropicRepairIndex.read(
    await snapshot.nativeFacts(anthropicRepairScope(settings)),
  );
  const base = await IndexedJournalRequestSnapshot.create(snapshot);
  const coordinates = new AnthropicViewCoordinates(query, snapshot.units);
  try {
    if (coordinates.resized && recovery) return false;
    const unsupported = await index.facts.get(['unsupported-rows']);
    if (coordinates.resized && unsupported?.[0] !== 0) return false;
    for (const change of coordinates.changes)
      if (!(await supportedChange(base, query, settings, index, change)))
        return false;
    if (
      coordinates.resized &&
      !(await replacementCacheSupported(
        snapshot,
        query,
        settings,
        coordinates,
        plan,
      ))
    )
      return false;
    return await isolatedTail(snapshot, query, settings, index);
  } finally {
    await base.close();
  }
}
async function measuredHolder(
  engine: AnthropicStreamRepair,
  start: number,
  count: number,
): Promise<SlotSummary> {
  let summary = identitySlotSummary('anthropic');
  for await (const atom of engine.atoms(start * 4)) {
    if (atom.key >= (start + count) * 4) break;
    let emitted = false;
    const add = (fact: AnthropicAtom): void => {
      summary = composeSlotSummaries(
        summary,
        anthropicUnitTransfer(
          {
            speaker: atom.role === 'user' ? 'human' : 'ai',
            chainStart: false,
            hasThinking: false,
            atoms: [[fact], [fact]],
            chain: [fact, fact],
          },
          1n,
        ),
      );
    };
    for await (const piece of atom.openPieces()) {
      emitted = true;
      add(numericRepairPiece(piece, atom.role));
    }
    if (!emitted) add(numericRepairPiece([], atom.role));
  }
  return summary;
}
export async function anthropicPendingPrefix(
  snapshot: VersionSnapshot,
  query: IndexedJournalRequestSnapshot,
  settings: RowFormatSettings,
  policy: RepairPolicy,
  engine: AnthropicStreamRepair,
): Promise<SlotSummary> {
  const slot = requestFormatSlot(snapshot, settings);
  const kept =
    engine.lastThinking < 0
      ? 0n
      : (await query.unitEntryAt(engine.lastThinking)).entry.label;
  const stripped = policy.includeInContext === false || policy.strip === 'all';
  const select = (summary: SlotSummary, keep: boolean): SlotSummary => {
    if (summary.kind !== 'anthropic') return summary;
    const variant =
      stripped || (policy.strip === 'allButLast' && !keep) ? 1 : 0;
    return {
      ...summary,
      variants: [summary.variants[variant], summary.variants[variant]],
    };
  };
  const range = async (from: bigint, to: bigint): Promise<SlotSummary> => {
    const selection = { label: kept, select };
    const summary = await snapshot.formatSummaryRange(
      slot,
      from,
      to,
      selection,
    );
    return kept < from || kept >= to ? select(summary, false) : summary;
  };
  let summary = identitySlotSummary('anthropic');
  let from = 1n;
  const end = query.viewPlan.sourceVersion?.nextLabel ?? 1n;
  for (const row of query.viewPlan.changedSources) {
    if (row.entry.label >= end) break;
    summary = composeSlotSummaries(summary, await range(from, row.entry.label));
    summary = composeSlotSummaries(
      summary,
      await measuredHolder(engine, row.start, row.count),
    );
    from = row.entry.label + 1n;
  }
  return composeSlotSummaries(summary, await range(from, end));
}
