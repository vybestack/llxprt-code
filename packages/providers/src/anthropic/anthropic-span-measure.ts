/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { SlotSummary } from '@vybestack/llxprt-code-core/journal/slotSummary.js';
import {
  composeSlotSummaries,
  identitySlotSummary,
} from '@vybestack/llxprt-code-core/journal/summaryComposition.js';
import {
  type AnthropicStreamRepair,
  numericRepairPiece,
} from './anthropic-stream-repair.js';
import {
  anthropicUnitTransfer,
  finalizeAnthropicTransfer,
} from './anthropic-unit-transfer.js';
import type {
  AnthropicSpanPlan,
  AnthropicSpan,
} from './anthropic-span-plan.js';
import type { StoredAnthropicRequestPlan } from './journal-anthropic-length.js';
import {
  addAnthropicCachePiece,
  beginAnthropicCacheAtom,
  finishAnthropicCacheAtom,
  anthropicCachePlan,
  type AnthropicCacheState,
} from './anthropic-cache-facts.js';
import {
  anthropicStoredSpanRange,
  composeAnthropicSpanCache,
  anthropicSummaryRole,
  anthropicSummaryCount,
} from './anthropic-span-summary.js';

async function measureSpan(
  plan: AnthropicSpanPlan,
  engine: AnthropicStreamRepair,
  span: AnthropicSpan,
  initial: SlotSummary,
): Promise<{
  summary: SlotSummary;
  cache: AnthropicCacheState;
  firstRole?: 'user' | 'assistant';
}> {
  let summary = initial;
  let cache: AnthropicCacheState = {};
  let firstRole: 'user' | 'assistant' | undefined;
  for await (const atom of engine.atoms(span.start * 4)) {
    if (atom.key >= span.end * 4) break;
    firstRole ??= atom.role;
    const anchored =
      !atom.repair &&
      (await plan.query.planAt(atom.end ?? Math.floor(atom.key / 4))).header
        .metadata?.cacheAnchor === true;
    const purge =
      !atom.repair &&
      (await plan.query.planAt(atom.end ?? Math.floor(atom.key / 4))).header
        .metadata?.semanticMediaPurgeBoundary !== undefined;
    const before = cache.run?.role === atom.role ? cache.run.blocks : 0;
    cache = beginAnthropicCacheAtom(cache, atom.role, atom.chain);
    let emitted = false;
    const add = (piece: Parameters<typeof numericRepairPiece>[0]): void => {
      const fact = numericRepairPiece(piece, atom.role, anchored, purge);
      cache = addAnthropicCachePiece(cache, fact);
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
      add(piece);
    }
    if (!emitted) add([]);
    cache = finishAnthropicCacheAtom(cache, anchored, before);
  }
  return { summary, cache, firstRole };
}
export interface AnthropicSpanMeasurement {
  readonly span?: AnthropicSpan;
  readonly summary: SlotSummary;
  readonly cache: AnthropicCacheState;
  readonly offset: number;
}
export async function* anthropicSpanMeasurements(
  plan: AnthropicSpanPlan,
  engine: AnthropicStreamRepair,
): AsyncGenerator<AnthropicSpanMeasurement> {
  const { query, snapshot } = plan;
  const range = await anthropicStoredSpanRange(plan, engine);
  let summary = identitySlotSummary('anthropic');
  let from = 1n;
  const end = snapshot.version?.nextLabel ?? 1n;
  let cache: AnthropicCacheState = {};
  let synthetic: boolean | undefined;
  for await (const span of plan.spans()) {
    const first = (await query.unitEntryAt(span.start)).entry.label;
    summary = composeSlotSummaries(
      summary,
      await range(from, first < end ? first : end),
    );
    const before = anthropicSummaryCount(summary);
    const previousRole = anthropicSummaryRole(summary);
    if (synthetic === undefined && before > 0)
      synthetic =
        plan.index.count > 0 &&
        (await plan.index.message(1)).role === 'assistant';
    const result = await measureSpan(plan, engine, span, summary);
    if (synthetic === undefined && result.firstRole !== undefined)
      synthetic = result.firstRole === 'assistant';
    const offset =
      before === 0
        ? 0
        : before -
          Number(synthetic) -
          Number(previousRole === result.firstRole);
    summary = result.summary;
    cache = composeAnthropicSpanCache(cache, result.cache, offset);
    yield { span, summary, cache, offset };
    from = (await query.unitEntryAt(span.end - 1)).entry.label + 1n;
    if (from > end) from = end;
  }
  summary = composeSlotSummaries(summary, await range(from, end));
  yield { summary, cache, offset: 0 };
}
export async function measureAnthropicSpans(
  plan: AnthropicSpanPlan,
  engine: AnthropicStreamRepair,
  base: StoredAnthropicRequestPlan,
): Promise<StoredAnthropicRequestPlan> {
  let summary = identitySlotSummary('anthropic');
  let cache: AnthropicCacheState = {};
  for await (const next of anthropicSpanMeasurements(plan, engine)) {
    summary = next.summary;
    cache = next.cache;
  }
  if (summary.kind !== 'anthropic')
    throw new Error('Missing Anthropic affected-span transfer');
  const measured = finalizeAnthropicTransfer(
    summary.variants[0],
    base.settings,
  );
  const plannedCache =
    base.cache === undefined
      ? undefined
      : anthropicCachePlan(cache, base.settings, base.cache.ttl);
  const messagesBytes = measured.bytes + (plannedCache?.bytes ?? 0);
  return {
    ...base,
    cache: plannedCache,
    messages: measured.messages,
    messagesBytes,
    contentLength: base.contentLength - base.messagesBytes + messagesBytes,
  };
}
