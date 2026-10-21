/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { BuildContext, TreeResult } from './groupBuildShared.js';
import { mapReader } from './groupBuildShared.js';
import type { RecordAppender } from './groupAppender.js';
import { startFacts, type GroupFacts } from './groupFacts.js';
import type { GroupPlan, Segment } from './groupPlanTypes.js';
import type { IdFactQueries } from './idFactQueries.js';
import { ID_NS, fact0Key } from './idKeys.js';
import {
  decodeKimiCounts,
  decodeKimiOccurrence,
  KIMI_FIELD,
  KIMI_FLAG,
  kimiKey,
  type KimiOccurrence,
} from './kimiFactCodec.js';
import {
  kimiSourceMapped,
  writeNormalizedRowOccurrences,
} from './normalizedRowOccurrences.js';
import { JournalFormatError } from './errors.js';
import { readRowIds } from './rowReads.js';
import { entryByLabel } from './rowTreeQueries.js';
import { editRowTree } from './rowTreeEdit.js';
import { plannedFromIds } from './unitContributions.js';
import { slotKindsOf } from './version.js';

class KimiPrefixWriter {
  constructor(
    private readonly ctx: BuildContext,
    private readonly plan: GroupPlan,
    private readonly facts: GroupFacts,
    private readonly old: IdFactQueries,
    private readonly appender: RecordAppender,
    private tree: TreeResult,
  ) {}

  private async holder(holder: KimiOccurrence): Promise<void> {
    if ((holder.flags & KIMI_FLAG.unmapped) === 0) return;
    const { ctx, appender, facts } = this;
    await appender.drain();
    const access = ctx.readGroup(appender.nextOffset);
    const root = { offset: this.tree.rowRoot, rows: this.tree.aggregate.rows };
    const entry = await entryByLabel(access, root, holder.position.label);
    if (entry === undefined)
      throw new JournalFormatError('Kimi fallback holder row is absent');
    const row = plannedFromIds(await readRowIds(access, entry));
    const counters = await writeNormalizedRowOccurrences(
      row,
      entry,
      facts.ids,
      ctx,
      { appender, readGroup: ctx.readGroup },
      facts,
    );
    const edited = await editRowTree(
      access,
      appender,
      ctx.algebra(slotKindsOf(this.plan.base.slots)),
      root,
      { replace: [{ ...entry, ...counters }], insert: [] },
    );
    this.tree = {
      ...this.tree,
      rowRoot: edited.childOffset,
      aggregate: edited.aggregate,
      spine: undefined,
    };
  }

  private async id(rawId: string): Promise<void> {
    const source = await this.facts.ids.queries.fact(rawId);
    if (source === undefined || !kimiSourceMapped(rawId, source)) return;
    const identity = this.ctx.idDeps.hasher(ID_NS.fact, fact0Key(rawId));
    const stored = await this.old.getEntry(
      ID_NS.occurrence,
      kimiKey(KIMI_FIELD.counts, 0, identity),
    );
    if (stored === undefined) return;
    const counts = decodeKimiCounts(stored);
    if (counts.eligibleCount !== 0) return;
    for (const [field, count] of [
      [KIMI_FIELD.calls, counts.callCount],
      [KIMI_FIELD.responses, counts.aiResponses + counts.otherResponses],
    ]) {
      for (let ordinal = 1; ordinal <= count; ordinal++) {
        const bytes = await this.old.getEntry(
          ID_NS.occurrence,
          kimiKey(field, ordinal, identity),
        );
        if (bytes === undefined)
          throw new JournalFormatError('Missing old Kimi fallback holder');
        await this.holder(decodeKimiOccurrence(bytes));
      }
    }
  }

  async update(segments: readonly Segment[]): Promise<TreeResult> {
    for (const segment of segments) {
      if (segment.kind !== 'fresh' && segment.kind !== 'foreign') continue;
      const ids =
        segment.kind === 'fresh'
          ? segment.draft.ids.map((id) => id.rawId)
          : (await readRowIds(segment.row.source, segment.row.entry)).rawIds;
      for (const rawId of new Set(ids)) await this.id(rawId);
    }
    return this.tree;
  }
}

export async function updateKimiPrefixes(
  ctx: BuildContext,
  plan: GroupPlan,
  segments: readonly Segment[],
  facts: GroupFacts | undefined,
  appender: RecordAppender,
  initial: TreeResult,
): Promise<TreeResult> {
  if (facts?.kimi !== true || ctx.access === undefined || initial.rowRoot === 0)
    return initial;
  const old = (
    await startFacts(ctx.access, plan.base.roots, ctx, mapReader(ctx, 'meta'))
  ).ids.queries;
  return new KimiPrefixWriter(ctx, plan, facts, old, appender, initial).update(
    segments,
  );
}
