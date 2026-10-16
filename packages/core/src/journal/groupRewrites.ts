/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';
import type {
  EntryFill,
  LabeledDraft,
  OwnerChange,
  VersionEdit,
} from './groupEdits.js';
import type {
  FreshRole,
  FreshSegment,
  GroupPlan,
  PlanContext,
  Segment,
} from './groupPlanTypes.js';
import {
  cutPrefix,
  cutSuffix,
  ensureSegments,
  firstLabelOf,
  insertSegment,
  leaveLineage,
  rejectAfterStream,
  requireAccess,
  transformRows,
  type RowRef,
  type RowTransform,
} from './groupSegments.js';
import { allocateAppendLabels, compressionLabel } from './labels.js';
import type { RowDraft } from './rowDraft.js';
import type { RowEntry } from './rowEntry.js';
import { readRowIds } from './rowReads.js';
import { ROW_FLAG, type RowIdTuple } from './rowRecord.js';

const U32_LIMIT = 0x1_0000_0000;

/** The edit kinds that change rows other than by appending or popping at the end. */
export type RewriteEdit = Extract<
  VersionEdit,
  {
    kind:
      | 'compress'
      | 'replace'
      | 'density'
      | 'purge'
      | 'insert'
      | 'owner'
      | 'fill';
  }
>;

export function isRewriteEdit(edit: VersionEdit): edit is RewriteEdit {
  switch (edit.kind) {
    case 'compress':
    case 'replace':
    case 'density':
    case 'purge':
    case 'insert':
    case 'owner':
    case 'fill':
      return true;
    default:
      return false;
  }
}

function assertOwner(owner: number): void {
  if (!Number.isInteger(owner) || owner < 0 || owner >= U32_LIMIT) {
    throw new JournalFormatError(
      `Owner ${owner} is not an owner id (an integer from 0 to 2^32 - 1; 0 is unowned)`,
    );
  }
}

function labelsOf(rows: ReadonlyArray<{ readonly label: bigint }>): bigint[] {
  const labels = rows.map((row) => row.label);
  if (new Set(labels).size !== labels.length) {
    throw new JournalFormatError('One label is named twice in one edit');
  }
  return labels;
}

function requireRows(count: number, what: string): void {
  if (count === 0) throw new JournalFormatError(`${what} names no rows`);
}

/** The plan after an edit that adds the rows of `drafts` at the end, with labels from `nextLabel`. */
export function appendSegments(
  plan: GroupPlan,
  rows: readonly RowDraft[],
): void {
  const segments = ensureSegments(plan);
  rejectAfterStream(segments);
  const { labels, nextLabel } = allocateAppendLabels(
    plan.nextLabel,
    rows.length,
  );
  rows.forEach((draft, index) =>
    segments.push({
      kind: 'fresh',
      label: labels[index],
      draft,
      role: 'append',
    }),
  );
  plan.nextLabel = nextLabel;
}

export async function popSegments(
  ctx: PlanContext,
  plan: GroupPlan,
  cut: bigint,
  expectedRemoved: number,
): Promise<void> {
  const removed = await cutSuffix(ctx, plan, cut);
  if (removed !== expectedRemoved) {
    throw new JournalFormatError(
      `Pop to label ${cut} removes ${removed} rows, not the expected ${expectedRemoved}`,
    );
  }
  plan.args ??= { cut, removed };
}

function ownerTransform(owner: number): RowTransform {
  return (ref: RowRef): Promise<Segment | undefined> =>
    Promise.resolve(
      'entry' in ref
        ? { kind: 'entry', entry: { ...ref.entry, owner } }
        : { ...ref.fresh, draft: { ...ref.fresh.draft, owner } },
    );
}

async function applyOwner(
  ctx: PlanContext,
  plan: GroupPlan,
  changes: readonly OwnerChange[],
): Promise<void> {
  requireRows(changes.length, 'An owner change');
  labelsOf(changes);
  for (const change of changes) assertOwner(change.owner);
  leaveLineage(plan);
  await transformRows(
    ctx,
    plan,
    new Map(changes.map((c) => [c.label, ownerTransform(c.owner)])),
  );
}

function filled(entry: RowEntry, fill: EntryFill): RowEntry {
  return {
    ...entry,
    tokens: fill.tokens ?? entry.tokens,
    media: fill.media ?? entry.media,
    stamp: fill.stamp ?? entry.stamp,
    summary: fill.summary ?? entry.summary,
    lensRef: fill.lensRef ?? entry.lensRef,
  };
}

function fillTransform(fill: EntryFill): RowTransform {
  return (ref) => {
    if (!('entry' in ref)) {
      return Promise.reject(
        new JournalFormatError(
          `Row ${fill.label} is written in this group, so it has nothing to fill yet`,
        ),
      );
    }
    return Promise.resolve({ kind: 'entry', entry: filled(ref.entry, fill) });
  };
}

async function applyFill(
  ctx: PlanContext,
  plan: GroupPlan,
  fills: readonly EntryFill[],
): Promise<void> {
  requireRows(fills.length, 'A fill');
  labelsOf(fills);
  await transformRows(
    ctx,
    plan,
    new Map(fills.map((fill) => [fill.label, fillTransform(fill)])),
  );
}

function sameIdTuple(
  stored: RowIdTuple,
  storedRawId: string,
  next: RowDraft['ids'][number],
): boolean {
  const sameKey = storedRawId === next.rawId && stored.kind === next.kind;
  const samePlace = stored.block === next.block;
  const sameWeight =
    stored.score === next.score && stored.nameLen === next.nameLen;
  return sameKey && samePlace && sameWeight;
}

/** Whether a rewritten row leaves the facts of its id tuples, its speaker and its parent entry as they were. */
async function keepsIndexFacts(
  ctx: PlanContext,
  entry: RowEntry,
  draft: RowDraft,
): Promise<boolean> {
  const { header, rawIds } = await readRowIds(requireAccess(ctx), entry);
  const sameIds =
    header.ids.length === draft.ids.length &&
    header.ids.every((tuple, index) =>
      sameIdTuple(tuple, rawIds[index], draft.ids[index]),
    );
  const parent = ROW_FLAG.responseParent;
  const sameParentFlag = (header.flags & parent) === (draft.flags & parent);
  const sameSpeakerAndParent =
    header.speaker === draft.speaker &&
    header.parentEndpoint === draft.parentEndpoint;
  return sameIds && sameParentFlag && sameSpeakerAndParent;
}

function rewriteTransform(
  ctx: PlanContext,
  label: bigint,
  draft: RowDraft,
  role: 'purge' | 'replacement',
): RowTransform {
  return async (ref) => {
    if (!('entry' in ref)) return { ...ref.fresh, draft };
    const kept =
      role === 'purge' && (await keepsIndexFacts(ctx, ref.entry, draft));
    const chosen: FreshRole = kept ? 'purge' : 'replacement';
    return { kind: 'fresh', label, draft, role: chosen, replaces: ref.entry };
  };
}

async function applyPurge(
  ctx: PlanContext,
  plan: GroupPlan,
  rows: readonly LabeledDraft[],
): Promise<void> {
  requireRows(rows.length, 'A purge');
  labelsOf(rows);
  leaveLineage(plan);
  await transformRows(
    ctx,
    plan,
    new Map(
      rows.map(({ label, draft }) => [
        label,
        rewriteTransform(ctx, label, draft, 'purge'),
      ]),
    ),
  );
}

async function applyDensity(
  ctx: PlanContext,
  plan: GroupPlan,
  replacements: readonly LabeledDraft[],
  removed: readonly bigint[],
): Promise<void> {
  requireRows(replacements.length + removed.length, 'A density edit');
  const labels = [...labelsOf(replacements), ...removed];
  if (new Set(labels).size !== labels.length) {
    throw new JournalFormatError('One label is named twice in one edit');
  }
  leaveLineage(plan);
  const drop: RowTransform = () => Promise.resolve(undefined);
  const transforms = new Map<bigint, RowTransform>([
    ...removed.map((label): [bigint, RowTransform] => [label, drop]),
    ...replacements.map(({ label, draft }): [bigint, RowTransform] => [
      label,
      rewriteTransform(ctx, label, draft, 'replacement'),
    ]),
  ]);
  await transformRows(ctx, plan, transforms);
}

async function applyInsert(
  ctx: PlanContext,
  plan: GroupPlan,
  afterLabel: bigint,
  draft: RowDraft,
): Promise<void> {
  leaveLineage(plan);
  await insertSegment(ctx, plan, afterLabel, (label) => ({
    kind: 'fresh',
    label,
    draft,
    role: 'insert',
  }));
}

async function applyCompress(
  ctx: PlanContext,
  plan: GroupPlan,
  edit: Extract<RewriteEdit, { kind: 'compress' }>,
): Promise<void> {
  leaveLineage(plan);
  const replaced = await cutPrefix(ctx, plan, edit.retainFromLabel);
  if (replaced === 0) {
    throw new JournalFormatError(
      `Compression below label ${edit.retainFromLabel} replaces no rows`,
    );
  }
  if (replaced !== edit.expectedReplaced) {
    throw new JournalFormatError(
      `Compression below label ${edit.retainFromLabel} replaces ${replaced} rows, not the expected ${edit.expectedReplaced}`,
    );
  }
  const segments = ensureSegments(plan);
  const retained = await firstLabelOf(ctx, segments);
  let label = compressionLabel(retained, plan.nextLabel);
  if (retained === undefined) {
    const allocated = allocateAppendLabels(plan.nextLabel, 1);
    label = allocated.labels[0];
    plan.nextLabel = allocated.nextLabel;
  }
  const summary: FreshSegment = {
    kind: 'fresh',
    label,
    draft: edit.summary,
    role: 'summary',
  };
  segments.unshift(summary);
  plan.args = { cut: edit.retainFromLabel, removed: replaced };
}

function applyReplace(
  plan: GroupPlan,
  rows: Iterable<RowDraft> | AsyncIterable<RowDraft>,
): void {
  leaveLineage(plan);
  plan.range = undefined;
  plan.newRows = [];
  plan.segments = [{ kind: 'stream', rows }];
}

/** Applies one of the edits that change rows in the middle of the history or rewrite them. */
export async function applyRewrite(
  ctx: PlanContext,
  plan: GroupPlan,
  edit: RewriteEdit,
): Promise<void> {
  switch (edit.kind) {
    case 'compress':
      return applyCompress(ctx, plan, edit);
    case 'replace':
      return applyReplace(plan, edit.rows);
    case 'density':
      return applyDensity(ctx, plan, edit.replacements, edit.removed);
    case 'purge':
      return applyPurge(ctx, plan, edit.rows);
    case 'insert':
      return applyInsert(ctx, plan, edit.afterLabel, edit.draft);
    case 'owner':
      return applyOwner(ctx, plan, edit.changes);
    case 'fill':
      return applyFill(ctx, plan, edit.fills);
    default: {
      const unknown: never = edit;
      throw new JournalFormatError(`Unknown edit ${JSON.stringify(unknown)}`);
    }
  }
}
