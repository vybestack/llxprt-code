/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';
import type { VersionEdit } from './groupEdits.js';
import { allocateAppendLabels } from './labels.js';
import { nearestAncestorWithRows, type VersionReader } from './lineageChain.js';
import type { RecordAccess } from './recordAccess.js';
import { MUTATION, type MutationCode } from './recordKinds.js';
import type { RowDraft } from './rowDraft.js';
import { countRowsBelow } from './rowTreeQueries.js';
import type { RowTreeRootRef } from './rowTreeReader.js';
import {
  emptiedVersion,
  genesisVersion,
  sameVersion,
  type Version,
} from './version.js';

/** Rows of an existing tree that a group keeps without writing their records again: rows `[from, to)` of `source`. */
export interface ExistingRange {
  readonly source: Version;
  readonly from: number;
  readonly to: number;
}

export interface NewRow {
  readonly label: bigint;
  readonly draft: RowDraft;
}

/**
 * What a group has decided so far. The version it builds on, `base`, is a
 * real version whose roots are reused as they are; the rows after it are
 * `range` (existing entries, no new record) followed by `newRows`. A pop that
 * lands inside a group re-appends part of one (design 4.3 step 4), and a pop
 * that must rebuild is an empty `base` with the whole kept prefix as `range`.
 */
export interface GroupPlan {
  base: Version;
  /** True while `base` is on the lineage of the published version, so pops may walk it. */
  walkable: boolean;
  range: ExistingRange | undefined;
  newRows: NewRow[];
  /** The trailer the new one extends; undefined starts a lineage. */
  parent: Version | undefined;
  /** The lineage the new trailer joins; undefined makes its own `commitSeq` the id. */
  lineageId: bigint | undefined;
  nextLabel: bigint;
  stateSets: Map<string, Uint8Array>;
  ckptDelta: number;
  pop: { cut: bigint; removed: number } | undefined;
  rebuilt: boolean;
}

export interface PlanContext {
  /** Undefined until the first group commits. */
  readonly access: RecordAccess | undefined;
  readonly published: Version | undefined;
  readonly readVersion: VersionReader;
  /** The `nextLabel` of a journal with no group. */
  readonly firstNextLabel: bigint;
}

function requireAccess(ctx: PlanContext): RecordAccess {
  if (ctx.access === undefined) {
    throw new JournalFormatError('The journal has no committed group to read');
  }
  return ctx.access;
}

function rootRef(version: Version): RowTreeRootRef | undefined {
  return version.roots.rowRoot === 0
    ? undefined
    : { offset: version.roots.rowRoot, rows: version.rows };
}

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
    pop: undefined,
    rebuilt: false,
  };
}

function startNewLineage(plan: GroupPlan): void {
  plan.parent = undefined;
  plan.lineageId = undefined;
  plan.walkable = false;
  plan.range = undefined;
  plan.newRows = [];
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
  plan.pop ??= { cut, removed };
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
  const value = JSON.stringify({
    name: edit.name,
    trailerOffset: published.selfOffset,
    commitSeq: published.commitSeq,
    createdAtMs: edit.createdAtMs,
    liveBytes,
  });
  plan.stateSets.set(`ckpt:${edit.id}`, new TextEncoder().encode(value));
  plan.ckptDelta += liveBytes;
}

async function applyEdit(
  ctx: PlanContext,
  plan: GroupPlan,
  edit: VersionEdit,
): Promise<void> {
  switch (edit.kind) {
    case 'append':
      applyAppend(plan, edit.rows);
      break;
    case 'pop':
      await applyPop(ctx, plan, edit.cutLabel, edit.expectedRemoved);
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
    default:
      throw new JournalFormatError(`Unknown edit ${JSON.stringify(edit)}`);
  }
}

/**
 * The mutation the trailer names. A clear or a restore decides the group;
 * otherwise the first append or pop does; a group of state edits only is a
 * `state` group. A checkpoint is state-only by definition (design 4.9).
 */
export function mutationOf(edits: readonly VersionEdit[]): MutationCode {
  if (edits.length === 0) {
    throw new JournalFormatError('A commit group needs at least one edit');
  }
  const kinds = edits.map((edit) => edit.kind);
  const clears = kinds.includes('clear');
  const restores = kinds.includes('restore');
  if (clears && restores) {
    throw new JournalFormatError('A group cannot both clear and restore');
  }
  if (clears) return MUTATION.clear;
  if (restores) return MUTATION.restore;
  const versioned = kinds.find((kind) => kind === 'append' || kind === 'pop');
  if (kinds.includes('checkpoint') && versioned !== undefined) {
    throw new JournalFormatError(
      'A checkpoint group changes only the state map',
    );
  }
  if (versioned === undefined) return MUTATION.state;
  return versioned === 'append' ? MUTATION.append : MUTATION.pop;
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
