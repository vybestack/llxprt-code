/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { EMPTY_AGGREGATE } from './aggregateComposition.js';
import { JournalFormatError } from './errors.js';
import type { RecordAppender } from './groupAppender.js';
import {
  commitFacts,
  commitState,
  mapReader,
  trailerState,
  type BuildContext,
  type BuiltGroup,
  type TreeResult,
} from './groupBuildShared.js';
import {
  applyDraftRow,
  applyEntryRow,
  finishFacts,
  startFacts,
  type GroupFacts,
} from './groupFacts.js';
import { monotoneInsertOccurrences } from './groupInsertCheck.js';
import { copyForeignRow } from './foreignRows.js';
import type {
  ForeignSegment,
  FreshSegment,
  GroupPlan,
  Segment,
} from './groupPlanTypes.js';
import { writeFresh } from './groupRebuild.js';
import { rootRef } from './groupSegments.js';
import type { MutationCode } from './recordKinds.js';
import { encodeRowDraft } from './rowDraft.js';
import type { RowEntry } from './rowEntry.js';
import { appendRowEntries } from './rowTreeBuilder.js';
import { editRowTree } from './rowTreeEdit.js';
import { slotKindsOf } from './version.js';
import { updateContributions } from './contributionChanges.js';
import { readRowIds } from './rowReads.js';

function freshOf(segments: readonly Segment[]): FreshSegment[] {
  return segments.filter(
    (segment): segment is FreshSegment => segment.kind === 'fresh',
  );
}

/** The rows a group adds, in label order: written fresh, or copied from another journal. */
function addsOf(
  segments: readonly Segment[],
): Array<FreshSegment | ForeignSegment> {
  return segments.filter(
    (segment): segment is FreshSegment | ForeignSegment =>
      segment.kind === 'foreign' ||
      (segment.kind === 'fresh' && segment.role !== 'purge'),
  );
}

/** Adds the facts of one added row; false when the row has to be rebuilt instead. */
async function addFacts(
  ctx: BuildContext,
  plan: GroupPlan,
  facts: GroupFacts,
  segment: FreshSegment | ForeignSegment,
): Promise<boolean> {
  if (segment.kind === 'foreign') {
    // A copied row in the middle of the history is rebuilt (design 5.2): its facts must be added in position order.
    if (segment.role === 'insert') return false;
    await applyEntryRow(segment.row.source, facts, ctx, segment.row.entry);
    return true;
  }
  if (segment.role !== 'insert') {
    await applyDraftRow(facts, ctx, segment.label, segment.draft);
    return true;
  }
  const occurrences = await monotoneInsertOccurrences(
    facts,
    ctx,
    plan.base.slots,
    segment.label,
    segment.draft,
  );
  if (occurrences === undefined) return false;
  for (const occurrence of occurrences) await facts.ids.apply(occurrence);
  return true;
}

/**
 * The facts of the rows a group adds, when they can be added to the trie of
 * the base as they are. `undefined` means some added row has to be rebuilt
 * (design 4.6); the reads that decided it wrote nothing. A group that adds no
 * rows has `facts: undefined` and keeps the roots of its base.
 */
async function incrementalFacts(
  ctx: BuildContext,
  plan: GroupPlan,
  adds: ReadonlyArray<FreshSegment | ForeignSegment>,
  appender: RecordAppender,
): Promise<
  { facts: GroupFacts | undefined; affected: ReadonlySet<bigint> } | undefined
> {
  const affected = new Set<bigint>();
  if (adds.length === 0) return { facts: undefined, affected };
  const facts = await startFacts(
    ctx.access,
    plan.base.roots,
    ctx,
    mapReader(ctx, 'meta'),
    { appender, readGroup: ctx.readGroup },
  );
  if (
    facts.mistralSlots !== 0 &&
    adds.some((segment) => segment.role === 'insert')
  )
    return undefined;
  for (const segment of adds) {
    const ids =
      segment.kind === 'fresh'
        ? segment.draft.ids.map((id) => id.rawId)
        : (await readRowIds(segment.row.source, segment.row.entry)).rawIds;
    for (const id of new Set(ids)) {
      const before = await facts.ids.queries.fact(id);
      if (before?.firstCall !== undefined) affected.add(before.firstCall.label);
      if (before?.firstToolResponse !== undefined)
        affected.add(before.firstToolResponse.label);
    }
    if (!(await addFacts(ctx, plan, facts, segment))) return undefined;
  }
  return { facts: finishFacts(facts), affected };
}

/** What the group changes in the tree of its base: entries that replace live ones, and entries for new labels. */
interface TreeChanges {
  readonly replace: RowEntry[];
  readonly insert: RowEntry[];
}

/** Encodes every added row, then writes their records; the entries that replace live ones are collected beside the new ones. */
async function writeChanges(
  appender: RecordAppender,
  segments: readonly Segment[],
): Promise<TreeChanges> {
  const encoded = new Map(
    freshOf(segments).map((segment) => [
      segment,
      encodeRowDraft(segment.label, segment.draft),
    ]),
  );
  const replace: RowEntry[] = [];
  const insert: RowEntry[] = [];
  for (const segment of segments) {
    if (segment.kind === 'entry') {
      replace.push(segment.entry);
    } else if (segment.kind === 'foreign') {
      insert.push(await copyForeignRow(appender, segment.row));
    } else if (segment.kind === 'fresh') {
      const record = encoded.get(segment);
      if (record === undefined) {
        throw new JournalFormatError(`Row ${segment.label} was not encoded`);
      }
      const entry = await writeFresh(appender, segment, record);
      (segment.role === 'purge' ? replace : insert).push(entry);
    }
  }
  return { replace, insert };
}

function byLabel(left: RowEntry, right: RowEntry): number {
  if (left.label === right.label) return 0;
  return left.label < right.label ? -1 : 1;
}

async function treeFor(
  ctx: BuildContext,
  plan: GroupPlan,
  appender: RecordAppender,
  changes: TreeChanges,
): Promise<TreeResult> {
  const { base } = plan;
  const touched = [...changes.replace, ...changes.insert].sort(byLabel);
  if (touched.length === 0) {
    return {
      rowRoot: base.roots.rowRoot,
      aggregate: base.rows === 0 ? EMPTY_AGGREGATE : base.aggregate,
      spine: undefined,
      firstLabel: base.firstLabel,
      lastRowOffset: base.lastRowOffset,
      lastOwner: base.lastOwner,
    };
  }
  const algebra = ctx.algebra(slotKindsOf(base.slots));
  const spine = base.rows > 0 ? await ctx.spineFor(base) : undefined;
  const baseLast = spine?.leaf[spine.leaf.length - 1];
  const tail =
    baseLast === undefined ||
    (changes.replace.length === 0 &&
      changes.insert.every((entry) => entry.label > baseLast.label));
  let root;
  let rightSpine;
  if (tail) {
    const built = await appendRowEntries(
      appender,
      algebra,
      spine,
      [...changes.insert].sort(byLabel),
    );
    root = built.root;
    rightSpine = built.spine;
  } else {
    const ref = rootRef(base);
    if (ref === undefined || ctx.access === undefined) {
      throw new JournalFormatError(
        'An edit needs the tree of a committed version',
      );
    }
    root = await editRowTree(ctx.access, appender, algebra, ref, changes);
  }
  const newest = touched[touched.length - 1];
  const last =
    baseLast === undefined || newest.label >= baseLast.label
      ? newest
      : baseLast;
  return {
    rowRoot: root.childOffset,
    aggregate: root.aggregate,
    spine: rightSpine,
    firstLabel:
      base.rows > 0 && base.firstLabel < touched[0].label
        ? base.firstLabel
        : touched[0].label,
    lastRowOffset: last.recordOffset,
    lastOwner: last.owner,
  };
}

/**
 * A group whose rows are a path copy of its base (design 4.6): entries of
 * the base replaced in place (an owner change, a fill, a purge that keeps its
 * id tuples), synthetic rows added in the middle, and rows appended. The row
 * tree is edited by path copying and the id trie takes only the facts of the
 * added rows. Returns undefined, with nothing written, when an inserted row
 * has to be rebuilt, so the caller can rebuild the whole history instead.
 */
export async function buildIncremental(
  ctx: BuildContext,
  plan: GroupPlan,
  segments: readonly Segment[],
  mutation: MutationCode,
  appender: RecordAppender,
): Promise<BuiltGroup | undefined> {
  const collected = await incrementalFacts(
    ctx,
    plan,
    addsOf(segments),
    appender,
  );
  if (collected === undefined) return undefined;
  const chainBase = await ctx.chainFor(plan.parent);
  const changes = await writeChanges(appender, segments);
  const queries =
    collected.facts?.ids.queries ??
    (await startFacts(ctx.access, plan.base.roots, ctx, mapReader(ctx, 'meta')))
      .ids.queries;
  await updateContributions(
    ctx,
    plan,
    segments,
    collected.affected,
    changes,
    queries,
    collected.facts === undefined
      ? undefined
      : { facts: collected.facts, appender },
  );
  const { idRoot, metaRoot } = await commitFacts(
    collected.facts,
    plan,
    appender,
  );
  const tree = await treeFor(ctx, plan, appender, changes);
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
