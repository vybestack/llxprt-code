/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  CHECKPOINT_TOMBSTONE,
  checkpointKey,
  encodeCheckpointDescriptor,
  parseCheckpointEntry,
} from './checkpointDescriptor.js';
import { JournalFormatError } from './errors.js';
import type { VersionEdit } from './groupEdits.js';
import type { GroupPlan, PlanContext } from './groupPlanTypes.js';
import {
  appendSegments,
  applyRewrite,
  isRewriteEdit,
  popSegments,
} from './groupRewrites.js';
import { requireAccess, rootRef } from './groupSegments.js';
import { allocateAppendLabels } from './labels.js';
import { nearestAncestorWithRows } from './lineageChain.js';
import { MUTATION, type MutationCode } from './recordKinds.js';
import type { RowDraft } from './rowDraft.js';
import { countRowsBelow } from './rowTreeQueries.js';
import {
  emptiedVersion,
  genesisVersion,
  sameVersion,
  type Version,
} from './version.js';

function startPlan(ctx: PlanContext): GroupPlan {
  const base = ctx.published ?? genesisVersion(ctx.firstNextLabel);
  return {
    base,
    walkable: ctx.published !== undefined,
    range: undefined,
    newRows: [],
    parent: ctx.published,
    lineageId: ctx.published?.lineage,
    nextLabel: base.nextLabel,
    stateSets: new Map(),
    ckptDelta: 0,
    args: undefined,
    rebuilt: false,
    segments: undefined,
  };
}

function startNewLineage(plan: GroupPlan): void {
  plan.parent = undefined;
  plan.lineageId = undefined;
  plan.walkable = false;
  plan.range = undefined;
  plan.newRows = [];
  plan.segments = undefined;
}

function applyAppend(plan: GroupPlan, rows: readonly RowDraft[]): void {
  const { labels, nextLabel } = allocateAppendLabels(
    plan.nextLabel,
    rows.length,
  );
  rows.forEach((draft, index) =>
    plan.newRows.push({ label: labels[index], draft }),
  );
  plan.nextLabel = nextLabel;
}

/** Drops pending rows at or above `cut`, newest first, and returns how many. */
async function dropPending(
  ctx: PlanContext,
  plan: GroupPlan,
  cut: bigint,
): Promise<number> {
  let removed = 0;
  while (
    plan.newRows.length > 0 &&
    plan.newRows[plan.newRows.length - 1].label >= cut
  ) {
    plan.newRows.pop();
    removed += 1;
  }
  if (plan.newRows.length > 0 || plan.range === undefined) return removed;
  const { source, from, to } = plan.range;
  const below = await countRowsBelow(requireAccess(ctx), rootRef(source), cut);
  const kept = Math.min(Math.max(below, from), to);
  plan.range = kept > from ? { source, from, to: kept } : undefined;
  return removed + (to - kept);
}

function hasPending(plan: GroupPlan): boolean {
  return plan.newRows.length > 0 || plan.range !== undefined;
}

/** Case 5 of design 4.3: no ancestor of the lineage has so few rows, so the first `keep` rows are rebuilt. */
function rebuildFirst(plan: GroupPlan, keep: number): void {
  const source = plan.base;
  startNewLineage(plan);
  plan.base = emptiedVersion(source);
  plan.range = keep > 0 ? { source, from: 0, to: keep } : undefined;
  plan.rebuilt = true;
}

/** Cases 3 and 4 of design 4.3, given the ancestor `ancestor` that has at most `keep` rows. */
async function restoreAncestor(
  ctx: PlanContext,
  plan: GroupPlan,
  ancestor: Version,
  keep: number,
): Promise<void> {
  const source = plan.base;
  plan.base = ancestor;
  plan.lineageId = ancestor.lineage;
  if (ancestor.rows === keep) {
    // The new trailer takes V's place, so it extends V's parent.
    plan.parent =
      ancestor.parent === 0
        ? undefined
        : await ctx.readVersion(ancestor.parent);
    return;
  }
  plan.parent = ancestor;
  plan.range = { source, from: ancestor.rows, to: keep };
}

async function popBase(
  ctx: PlanContext,
  plan: GroupPlan,
  cut: bigint,
): Promise<number> {
  const keep = await countRowsBelow(
    requireAccess(ctx),
    rootRef(plan.base),
    cut,
  );
  const removed = plan.base.rows - keep;
  if (removed === 0) return 0;
  const ancestor = plan.walkable
    ? await nearestAncestorWithRows(ctx.readVersion, plan.base, keep)
    : undefined;
  if (ancestor === undefined) rebuildFirst(plan, keep);
  else await restoreAncestor(ctx, plan, ancestor, keep);
  return removed;
}

async function applyPop(
  ctx: PlanContext,
  plan: GroupPlan,
  cut: bigint,
  expectedRemoved: number,
): Promise<void> {
  let removed = await dropPending(ctx, plan, cut);
  if (!hasPending(plan)) removed += await popBase(ctx, plan, cut);
  if (removed !== expectedRemoved) {
    throw new JournalFormatError(
      `Pop to label ${cut} removes ${removed} rows, not the expected ${expectedRemoved}`,
    );
  }
  plan.args ??= { cut, removed };
}

async function applyRestore(
  ctx: PlanContext,
  plan: GroupPlan,
  saved: Version,
): Promise<void> {
  const found = await ctx.readVersion(saved.selfOffset);
  if (!sameVersion(found, saved)) {
    throw new JournalFormatError(
      `Version ${saved.commitSeq} at offset ${saved.selfOffset} is not the one in the file (it carries commitSeq ${found.commitSeq})`,
    );
  }
  startNewLineage(plan);
  plan.base = found;
}

function applyCheckpoint(
  ctx: PlanContext,
  plan: GroupPlan,
  edit: Extract<VersionEdit, { kind: 'checkpoint' }>,
): void {
  const { published } = ctx;
  if (published === undefined) {
    throw new JournalFormatError('A checkpoint needs a committed version');
  }
  const liveBytes = published.aggregate.liveBytes;
  plan.stateSets.set(
    checkpointKey(edit.id),
    encodeCheckpointDescriptor({
      name: edit.name,
      trailerOffset: published.selfOffset,
      commitSeq: published.commitSeq,
      createdAtMs: edit.createdAtMs,
      liveBytes,
    }),
  );
  plan.ckptDelta += liveBytes;
}

async function applyDeleteCheckpoint(
  ctx: PlanContext,
  plan: GroupPlan,
  id: string,
): Promise<void> {
  const key = checkpointKey(id);
  const held = plan.stateSets.get(key) ?? (await ctx.readState(key));
  const descriptor =
    held === undefined ? undefined : parseCheckpointEntry(held);
  if (descriptor === undefined) {
    throw new JournalFormatError(
      `There is no checkpoint ${JSON.stringify(id)}`,
    );
  }
  plan.stateSets.set(key, CHECKPOINT_TOMBSTONE);
  plan.ckptDelta -= descriptor.liveBytes;
}

async function applyEdit(
  ctx: PlanContext,
  plan: GroupPlan,
  edit: VersionEdit,
): Promise<void> {
  if (isRewriteEdit(edit)) {
    await applyRewrite(ctx, plan, edit);
    return;
  }
  switch (edit.kind) {
    case 'append':
      if (plan.segments === undefined) applyAppend(plan, edit.rows);
      else appendSegments(plan, edit.rows);
      break;
    case 'pop':
      if (plan.segments === undefined) {
        await applyPop(ctx, plan, edit.cutLabel, edit.expectedRemoved);
      } else {
        await popSegments(ctx, plan, edit.cutLabel, edit.expectedRemoved);
      }
      break;
    case 'clear':
      startNewLineage(plan);
      plan.base = emptiedVersion(plan.base);
      break;
    case 'restore':
      await applyRestore(ctx, plan, edit.saved);
      break;
    case 'setState':
      plan.stateSets.set(edit.key, edit.value);
      break;
    case 'checkpoint':
      applyCheckpoint(ctx, plan, edit);
      break;
    case 'deleteCheckpoint':
      await applyDeleteCheckpoint(ctx, plan, edit.id);
      break;
    default:
      throw new JournalFormatError(`Unknown edit ${JSON.stringify(edit)}`);
  }
}

/** The mutation code of an edit that starts a lineage by changing rows (design 4.10). */
const REWRITE_MUTATION = {
  compress: MUTATION.compress,
  replace: MUTATION.replace,
  density: MUTATION.density,
  purge: MUTATION.purge,
  insert: MUTATION.insert,
  owner: MUTATION.owner,
} as const;

function isLineageRewrite(
  kind: VersionEdit['kind'],
): kind is keyof typeof REWRITE_MUTATION {
  return kind in REWRITE_MUTATION;
}

/**
 * The edit kind that decides the mutation code: a copy of rows from another
 * journal is named for what it does to the history (design 5.2).
 */
function mutationKind(edit: VersionEdit): VersionEdit['kind'] {
  switch (edit.kind) {
    case 'adopt':
      return edit.placement === 'end' ? 'append' : 'insert';
    case 'adoptAll':
      return 'replace';
    case 'trimHead':
      return 'compress';
    default:
      return edit.kind;
  }
}

/**
 * The mutation the trailer names. A clear or a restore decides the group.
 * Otherwise the first edit that starts a lineage by changing rows does (a
 * compression, replace, density, purge, insert or owner change), then the
 * first append or pop, then a fill; a group of state edits only is a `state`
 * group. A checkpoint is state-only by definition (design 4.9).
 */
export function mutationOf(edits: readonly VersionEdit[]): MutationCode {
  if (edits.length === 0) {
    throw new JournalFormatError('A commit group needs at least one edit');
  }
  const kinds = edits.map(mutationKind);
  const clears = kinds.includes('clear');
  const restores = kinds.includes('restore');
  if (clears && restores) {
    throw new JournalFormatError('A group cannot both clear and restore');
  }
  if (clears) return MUTATION.clear;
  if (restores) return MUTATION.restore;
  const changesRows = kinds.some(
    (kind) =>
      kind !== 'setState' &&
      kind !== 'checkpoint' &&
      kind !== 'deleteCheckpoint',
  );
  if (
    (kinds.includes('checkpoint') || kinds.includes('deleteCheckpoint')) &&
    changesRows
  ) {
    throw new JournalFormatError(
      'A checkpoint group changes only the state map',
    );
  }
  const rewrite = kinds.find(isLineageRewrite);
  if (rewrite !== undefined) return REWRITE_MUTATION[rewrite];
  const versioned = kinds.find((kind) => kind === 'append' || kind === 'pop');
  if (versioned !== undefined) {
    return versioned === 'append' ? MUTATION.append : MUTATION.pop;
  }
  return kinds.includes('fill') ? MUTATION.fill : MUTATION.state;
}

export async function planGroup(
  ctx: PlanContext,
  edits: readonly VersionEdit[],
): Promise<GroupPlan> {
  mutationOf(edits);
  const plan = startPlan(ctx);
  for (const edit of edits) await applyEdit(ctx, plan, edit);
  return plan;
}
