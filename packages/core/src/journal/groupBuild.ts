/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { EMPTY_AGGREGATE } from './aggregateComposition.js';
import { JournalFormatError } from './errors.js';
import type { RecordAppender } from './groupAppender.js';
import {
  commitFacts,
  commitState,
  mapReader,
  trailerState,
  writeRows,
  type BuildContext,
  type BuiltGroup,
  type TreeResult,
} from './groupBuildShared.js';
import { collectFacts, existingEntries } from './groupFacts.js';
import type { GroupPlan } from './groupPlanTypes.js';
import { buildFromSegments } from './groupSegmentBuild.js';
import type { MutationCode } from './recordKinds.js';
import { encodeRowDraft } from './rowDraft.js';
import type { RowEntry } from './rowEntry.js';
import { appendRowEntries } from './rowTreeBuilder.js';
import { hasActiveSlot, slotKindsOf } from './version.js';

export { mapReader } from './groupBuildShared.js';
export type { BuildContext, BuiltGroup } from './groupBuildShared.js';

/** The rows a group puts in the tree, in label order, with the first and last seen. */
class RowStream {
  first: RowEntry | undefined;
  last: RowEntry | undefined;

  constructor(
    private readonly kept: AsyncGenerator<RowEntry> | undefined,
    private readonly written: readonly RowEntry[],
  ) {}

  async *entries(): AsyncGenerator<RowEntry> {
    if (this.kept !== undefined) {
      for await (const entry of this.kept) yield this.note(entry);
    }
    for (const entry of this.written) yield this.note(entry);
  }

  private note(entry: RowEntry): RowEntry {
    this.first ??= entry;
    this.last = entry;
    return entry;
  }
}

async function buildTree(
  ctx: BuildContext,
  plan: GroupPlan,
  appender: RecordAppender,
  written: readonly RowEntry[],
): Promise<TreeResult> {
  const { base } = plan;
  const kept = existingEntries(ctx.access, plan.range);
  if (kept === undefined && written.length === 0) {
    return {
      rowRoot: base.roots.rowRoot,
      aggregate: base.rows === 0 ? EMPTY_AGGREGATE : base.aggregate,
      spine: undefined,
      firstLabel: base.firstLabel,
      lastRowOffset: base.lastRowOffset,
      lastOwner: base.lastOwner,
    };
  }
  const stream = new RowStream(kept, written);
  const spine = base.rows > 0 ? await ctx.spineFor(base) : undefined;
  const algebra = ctx.algebra(slotKindsOf(base.slots));
  const tree = await appendRowEntries(
    appender,
    algebra,
    spine,
    stream.entries(),
  );
  const { first, last } = stream;
  if (first === undefined || last === undefined) {
    throw new JournalFormatError('A row append wrote no entries');
  }
  return {
    rowRoot: tree.root.childOffset,
    aggregate: tree.root.aggregate,
    spine: tree.spine,
    firstLabel: base.rows > 0 ? base.firstLabel : first.label,
    lastRowOffset: last.recordOffset,
    lastOwner: last.owner,
  };
}

function hasPendingRows(plan: GroupPlan): boolean {
  return plan.range !== undefined || plan.newRows.length > 0;
}

/**
 * Everything a group writes except the trailer, and the trailer's state.
 * Reads and encoding come first, so a failure there leaves the file untouched
 * (the writer keeps working); then the records are appended in the order row
 * records, id trie, meta map, row tree, state map.
 */
export async function buildGroup(
  ctx: BuildContext,
  plan: GroupPlan,
  mutation: MutationCode,
  appender: RecordAppender,
): Promise<BuiltGroup> {
  if (plan.segments !== undefined) {
    return buildFromSegments(ctx, plan, plan.segments, mutation, appender);
  }
  const pending = hasPendingRows(plan);
  if (pending && hasActiveSlot(plan.base.slots)) {
    throw new JournalFormatError(
      'A format slot is active, and filling its summaries is not part of this append',
    );
  }
  const encoded = plan.newRows.map(({ label, draft }) =>
    encodeRowDraft(label, draft),
  );
  const facts = pending
    ? await collectFacts(ctx.access, plan, ctx, mapReader(ctx, 'meta'), {
        appender,
        readGroup: ctx.readGroup,
      })
    : undefined;
  const chainBase = await ctx.chainFor(plan.parent);
  const written = await writeRows(appender, encoded);
  const { idRoot, metaRoot } = await commitFacts(facts, plan, appender);
  const tree = await buildTree(ctx, plan, appender, written);
  const stateRoot = await commitState(ctx, plan, appender);
  return {
    state: trailerState(ctx, plan, mutation, chainBase, {
      ...tree,
      idRoot,
      metaRoot,
      stateRoot,
      nextLabel: plan.nextLabel,
    }),
    spine: tree.spine,
    chainBase,
  };
}
