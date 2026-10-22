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
): Promise<boolean> {
  const end = start + count;
  for await (const message of index.messages(start)) {
    if (message.start >= end) break;
    if (message.start < start || message.end >= end) return false;
  }
  for (let at = start; at < end; at++) {
    const old = await base.readAt(at);
    const next = await query.readAt(at);
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
  const first =
    snapshot.units < query.count
      ? await source.describe(snapshot.units)
      : undefined;
  if (index.count > 0 && first !== undefined) {
    const last = await index.message(index.count);
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
  for (let at = snapshot.units; at < query.count; at++) {
    const row = await query.readAt(at);
    if (
      row.blocks.some(
        (block) =>
          block.type !== 'text' &&
          block.type !== 'code' &&
          block.type !== 'tool_call' &&
          block.type !== 'tool_response',
      )
    )
      return false;
    for (const fact of await query.anthropicToolFactsAt(at)) {
      if (fact.uses !== 1 || fact.results !== 1) return false;
      const call = await query.normalizedPosition(2, 0, fact.id, 1);
      const result = await query.normalizedPosition(2, 1, fact.id, 1);
      if (call === undefined || call < snapshot.units || result !== call + 1)
        return false;
    }
  }
  return true;
}
export async function supportsAnthropicPendingTail(
  snapshot: VersionSnapshot,
  query: IndexedJournalRequestSnapshot,
  settings: RowFormatSettings,
): Promise<boolean> {
  const index = await AnthropicRepairIndex.read(
    await snapshot.nativeFacts(anthropicRepairScope(settings)),
  );
  const base = await IndexedJournalRequestSnapshot.create(snapshot);
  try {
    for (const row of query.viewPlan.changedSources) {
      if (row.entry.label >= (query.viewPlan.sourceVersion?.nextLabel ?? 1n))
        continue;
      if (
        row.count !== row.oldCount ||
        !(await stableHolder(
          base,
          query,
          settings,
          index,
          row.start,
          row.count,
        ))
      )
        return false;
    }
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
