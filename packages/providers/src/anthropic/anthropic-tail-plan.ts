/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import type { VersionSnapshot } from '@vybestack/llxprt-code-core/journal/versionSnapshot.js';
import type { SlotSummary } from '@vybestack/llxprt-code-core/journal/slotSummary.js';
import { composeSlotSummaries } from '@vybestack/llxprt-code-core/journal/summaryComposition.js';
import { requestFormatSlot } from '@vybestack/llxprt-code-core/services/history/native-provider-format.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import { JournalFormatError } from '@vybestack/llxprt-code-core/journal/errors.js';
import {
  AnthropicRepairIndex,
  anthropicRepairScope,
  type AnthropicRequestRepairIndex,
} from './anthropic-repair-index.js';
import {
  AnthropicRepairSource,
  type RepairMessage,
  type RepairPolicy,
} from './anthropic-repair-source.js';
import {
  anthropicUnitFacts,
  type AnthropicUnitFacts,
} from './anthropic-unit-facts.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  anthropicUnitTransfer,
  finalizeAnthropicTransfer,
} from './anthropic-unit-transfer.js';
import {
  addAnthropicCachePiece,
  anthropicCachePlan,
  beginAnthropicCacheAtom,
  finishAnthropicCacheAtom,
  readAnthropicCacheFacts,
  type AnthropicCacheState,
} from './anthropic-cache-facts.js';
import type { StoredAnthropicRequestPlan } from './journal-anthropic-length.js';

export async function anthropicTailIndex(
  snapshot: VersionSnapshot,
  query: IndexedJournalRequestSnapshot,
  settings: RowFormatSettings,
): Promise<AnthropicRequestRepairIndex> {
  const base = await AnthropicRepairIndex.read(
    await snapshot.nativeFacts(anthropicRepairScope(settings)),
  );
  const source = new AnthropicRepairSource(query, settings);
  const tail: RepairMessage[] = [];
  for await (const message of source.messages(snapshot.units))
    tail.push(message);
  return {
    lastThinking: base.lastThinking,
    async *messages(from) {
      yield* base.messages(from);
      for (const message of tail) if (message.end >= from) yield message;
    },
    decision: (message, id) =>
      message.start >= snapshot.units
        ? Promise.resolve(undefined)
        : base.decision(message, id),
    taken: (id, ordinal, before) => base.taken(id, ordinal, before),
  };
}

function appendUserCache(
  cache: AnthropicCacheState | undefined,
  unit: AnthropicUnitFacts,
  row: IContent,
): AnthropicCacheState | undefined {
  if (cache === undefined) return undefined;
  let state = cache;
  for (const atom of unit.atoms[0]) {
    const before = state.run?.role === atom.role ? state.run.blocks : 0;
    state = finishAnthropicCacheAtom(
      addAnthropicCachePiece(beginAnthropicCacheAtom(state, atom.role), atom),
      row.metadata?.cacheAnchor === true,
      before,
    );
  }
  return state;
}

export async function planAnthropicTail(
  snapshot: VersionSnapshot,
  query: IndexedJournalRequestSnapshot,
  settings: RowFormatSettings,
  policy: RepairPolicy,
  base: StoredAnthropicRequestPlan,
  prefix: SlotSummary,
): Promise<StoredAnthropicRequestPlan> {
  const slot = requestFormatSlot(snapshot, settings);
  const auxiliary = await snapshot.formatAuxiliary(slot);
  if (auxiliary === undefined)
    throw new JournalFormatError('Missing Anthropic tail prefix facts');
  const stripped = policy.includeInContext === false || policy.strip === 'all';
  const corrected = !stripped && policy.strip === 'allButLast';
  let summary = prefix;
  const storedCache =
    base.cache === undefined
      ? undefined
      : readAnthropicCacheFacts(auxiliary).current;
  let cache = storedCache?.kept;
  if (stripped) cache = storedCache?.stripped;
  else if (corrected) cache = storedCache?.corrected;
  for (let at = snapshot.units; at < query.count; at++) {
    const row = await query.readAt(at);
    const unit = anthropicUnitFacts(row, settings);
    if (unit === undefined) continue;
    summary = composeSlotSummaries(
      summary,
      anthropicUnitTransfer(unit, BigInt(at + 1)),
    );
    cache = appendUserCache(cache, unit, row);
  }
  if (summary.kind !== 'anthropic')
    throw new JournalFormatError('Missing Anthropic user-tail transfer');
  const measured = finalizeAnthropicTransfer(
    summary.variants[stripped ? 1 : 0],
    settings,
  );
  const plannedCache =
    cache === undefined || base.cache === undefined
      ? undefined
      : anthropicCachePlan(cache, settings, base.cache.ttl);
  const messagesBytes = measured.bytes + (plannedCache?.bytes ?? 0);
  return {
    ...base,
    cache: plannedCache,
    messages: measured.messages,
    messagesBytes,
    contentLength: base.contentLength - base.messagesBytes + messagesBytes,
  };
}
