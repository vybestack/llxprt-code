/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { SlotSummary } from '@vybestack/llxprt-code-core/journal/slotSummary.js';
import {
  composeSlotSummaries,
  identitySlotSummary,
} from '@vybestack/llxprt-code-core/journal/summaryComposition.js';
import { requestFormatSlot } from '@vybestack/llxprt-code-core/services/history/native-provider-format.js';
import type { AnthropicStreamRepair } from './anthropic-stream-repair.js';
import type { AnthropicSpanPlan } from './anthropic-span-plan.js';
import {
  firstAnthropicCacheAnchor,
  finishAnthropicPurgeState,
  type AnthropicCacheState,
} from './anthropic-cache-facts.js';

export async function anthropicStoredSpanRange(
  plan: AnthropicSpanPlan,
  engine: AnthropicStreamRepair,
): Promise<(from: bigint, to: bigint) => Promise<SlotSummary>> {
  const { query, snapshot } = plan;
  const slot = requestFormatSlot(snapshot, engine.source.settings);
  const kept =
    engine.lastThinking < 0
      ? 0n
      : (await query.unitEntryAt(engine.lastThinking)).entry.label;
  const stripped =
    engine.policy.includeInContext === false || engine.policy.strip === 'all';
  const select = (summary: SlotSummary, keep: boolean): SlotSummary => {
    if (summary.kind !== 'anthropic') return summary;
    const variant =
      stripped || (engine.policy.strip === 'allButLast' && !keep) ? 1 : 0;
    return {
      ...summary,
      variants: [summary.variants[variant], summary.variants[variant]],
    };
  };
  const stored = async (from: bigint, to: bigint): Promise<SlotSummary> => {
    const summary = await snapshot.formatSummaryRange(slot, from, to, {
      label: kept,
      select,
    });
    return kept < from || kept >= to ? select(summary, false) : summary;
  };
  return async (from, to) => {
    let summary = identitySlotSummary('anthropic');
    for (const row of query.viewPlan.changedSources) {
      if (row.count !== 0 || row.entry.label < from || row.entry.label >= to)
        continue;
      summary = composeSlotSummaries(
        summary,
        await stored(from, row.entry.label),
      );
      from = row.entry.label + 1n;
    }
    return composeSlotSummaries(summary, await stored(from, to));
  };
}
export function composeAnthropicSpanCache(
  previous: AnthropicCacheState,
  next: AnthropicCacheState,
  offset: number,
): AnthropicCacheState {
  if (next.run === undefined) return previous;
  const local = firstAnthropicCacheAnchor(next);
  const anchor =
    firstAnthropicCacheAnchor(previous) ??
    (local === undefined ? undefined : { ...local, run: local.run + offset });
  const before = finishAnthropicPurgeState(previous);
  const current = next.purge ?? { count: 0, image: false };
  const shift = (value: typeof before.tagged): typeof before.tagged =>
    value === undefined ? undefined : { ...value, run: value.run + offset };
  let expected = before.expected;
  if (!before.image && current.image)
    expected = shift(current.expected) ?? before.last;
  return {
    anchor,
    purge: {
      count: before.count + current.count,
      tagged: before.tagged ?? shift(current.tagged),
      image: before.image || current.image,
      expected,
      last: shift(current.last) ?? before.last,
    },
    run: { ...next.run, ordinal: next.run.ordinal + offset },
  };
}
export function anthropicSummaryRole(
  summary: SlotSummary,
): 'user' | 'assistant' | undefined {
  const state = summary.kind === 'anthropic' ? summary.variants[0].out[0] : 0;
  if (state >= 5) return 'assistant';
  return state >= 2 ? 'user' : undefined;
}
export function anthropicSummaryCount(summary: SlotSummary): number {
  return summary.kind === 'anthropic' ? summary.variants[0].count[0] : 0;
}
