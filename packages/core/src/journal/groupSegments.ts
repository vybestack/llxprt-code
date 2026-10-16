/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';
import type {
  EntrySegment,
  ExistingSegment,
  FreshSegment,
  GroupPlan,
  PlanContext,
  Segment,
} from './groupPlanTypes.js';
import { labelBetween } from './labels.js';
import type { RecordAccess } from './recordAccess.js';
import type { RowEntry } from './rowEntry.js';
import { countRowsBelow } from './rowTreeQueries.js';
import { entryAt, type RowTreeRootRef } from './rowTreeReader.js';
import type { Version } from './version.js';

export function requireAccess(ctx: PlanContext): RecordAccess {
  if (ctx.access === undefined) {
    throw new JournalFormatError('The journal has no committed group to read');
  }
  return ctx.access;
}

export function rootRef(version: Version): RowTreeRootRef | undefined {
  return version.roots.rowRoot === 0
    ? undefined
    : { offset: version.roots.rowRoot, rows: version.rows };
}

function requireRoot(version: Version): RowTreeRootRef {
  const root = rootRef(version);
  if (root === undefined) {
    throw new JournalFormatError(`Version ${version.commitSeq} has no rows`);
  }
  return root;
}

function compareLabels(left: bigint, right: bigint): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * The row sequence of the group as segments, made from the base, the rows it
 * keeps and the rows it adds. It is made once, by the first edit that cannot
 * be expressed as a change at the end of the sequence.
 */
export function ensureSegments(plan: GroupPlan): Segment[] {
  if (plan.segments !== undefined) return plan.segments;
  const segments: Segment[] = [];
  if (plan.base.rows > 0) {
    segments.push({
      kind: 'existing',
      source: plan.base,
      from: 0,
      to: plan.base.rows,
    });
  }
  if (plan.range !== undefined) {
    segments.push({ kind: 'existing', ...plan.range });
    // Rows of another version follow the base, so the tree is not a path copy of the base.
    plan.rebuilt = true;
  }
  for (const { label, draft } of plan.newRows) {
    segments.push({ kind: 'fresh', label, draft, role: 'append' });
  }
  plan.segments = segments;
  plan.range = undefined;
  plan.newRows = [];
  return segments;
}

/** A group that keeps its rows but cannot be undone by restoring an ancestor starts a lineage (design 4.3). */
export function leaveLineage(plan: GroupPlan): void {
  plan.parent = undefined;
  plan.lineageId = undefined;
  plan.walkable = false;
}

export function rejectAfterStream(segments: readonly Segment[]): void {
  if (segments.some((segment) => segment.kind === 'stream')) {
    throw new JournalFormatError(
      'A replace takes the whole history, so no other row edit may follow it in its group',
    );
  }
}

/** The row an edit finds by label: an entry of the file, or a row written in this group. */
export type RowRef =
  | { readonly entry: RowEntry }
  | { readonly fresh: FreshSegment };

/** What a row becomes; undefined removes it. */
export type RowTransform = (ref: RowRef) => Promise<Segment | undefined>;

/** The live row named `label` when it lies in rows `from` up to `to` of the root, with its ordinal. */
async function liveRowIn(
  access: RecordAccess,
  root: RowTreeRootRef,
  label: bigint,
  range: { readonly from: number; readonly to: number },
): Promise<{ entry: RowEntry; ordinal: number } | undefined> {
  const ordinal = await countRowsBelow(access, root, label);
  if (ordinal < range.from || ordinal >= range.to) return undefined;
  const entry = await entryAt(access, root, ordinal);
  return entry.label === label ? { entry, ordinal } : undefined;
}

async function splitExisting(
  access: RecordAccess,
  segment: ExistingSegment,
  pending: Map<bigint, RowTransform>,
  out: Segment[],
): Promise<void> {
  const root = requireRoot(segment.source);
  const first = (await entryAt(access, root, segment.from)).label;
  const last = (await entryAt(access, root, segment.to - 1)).label;
  const inside = [...pending.entries()]
    .filter(([label]) => label >= first && label <= last)
    .sort(([left], [right]) => compareLabels(left, right));
  let from = segment.from;
  for (const [label, transform] of inside) {
    const live = await liveRowIn(access, root, label, {
      from,
      to: segment.to,
    });
    if (live === undefined) continue;
    pending.delete(label);
    if (live.ordinal > from) {
      out.push({ ...segment, from, to: live.ordinal });
    }
    const replaced = await transform({ entry: live.entry });
    if (replaced !== undefined) out.push(replaced);
    from = live.ordinal + 1;
  }
  if (from < segment.to) out.push({ ...segment, from });
}

async function transformSingle(
  segment: EntrySegment | FreshSegment,
  pending: Map<bigint, RowTransform>,
  out: Segment[],
): Promise<void> {
  const label = segment.kind === 'entry' ? segment.entry.label : segment.label;
  const transform = pending.get(label);
  if (transform === undefined) {
    out.push(segment);
    return;
  }
  pending.delete(label);
  const replaced = await transform(
    segment.kind === 'entry' ? { entry: segment.entry } : { fresh: segment },
  );
  if (replaced !== undefined) out.push(replaced);
}

/**
 * Applies a transform to each of the named rows, wherever they are in the
 * sequence. Every label must be live: a label that no segment holds throws,
 * before anything is written.
 */
export async function transformRows(
  ctx: PlanContext,
  plan: GroupPlan,
  transforms: ReadonlyMap<bigint, RowTransform>,
): Promise<void> {
  const segments = ensureSegments(plan);
  rejectAfterStream(segments);
  const access = requireAccess(ctx);
  const pending = new Map(transforms);
  const out: Segment[] = [];
  for (const segment of segments) {
    if (pending.size === 0) {
      out.push(segment);
    } else if (segment.kind === 'existing') {
      await splitExisting(access, segment, pending, out);
    } else if (segment.kind === 'stream') {
      out.push(segment);
    } else {
      await transformSingle(segment, pending, out);
    }
  }
  if (pending.size > 0) {
    const [missing] = pending.keys();
    throw new JournalFormatError(`Row ${missing} is not live in this group`);
  }
  plan.segments = out;
}

/** Where a synthetic row goes: before segment `at`, with the label of the next live row (or `nextLabel`) above it. */
interface InsertSlot {
  readonly at: number;
  readonly upper: bigint;
}

async function slotInExisting(
  access: RecordAccess,
  segment: ExistingSegment,
  afterLabel: bigint,
): Promise<{ split: number; upper: bigint } | undefined> {
  const root = requireRoot(segment.source);
  const through = await countRowsBelow(access, root, afterLabel + 1n);
  const split = Math.min(Math.max(through, segment.from), segment.to);
  if (split >= segment.to) return undefined;
  return { split, upper: (await entryAt(access, root, split)).label };
}

async function findInsertSlot(
  access: RecordAccess,
  plan: GroupPlan,
  segments: Segment[],
  afterLabel: bigint,
): Promise<InsertSlot> {
  for (const [index, segment] of segments.entries()) {
    if (segment.kind === 'existing') {
      const found = await slotInExisting(access, segment, afterLabel);
      if (found === undefined) continue;
      if (found.split === segment.from) {
        return { at: index, upper: found.upper };
      }
      segments.splice(
        index,
        1,
        { ...segment, to: found.split },
        { ...segment, from: found.split },
      );
      return { at: index + 1, upper: found.upper };
    }
    const label = segment.kind === 'entry' ? segment.entry.label : undefined;
    const own = segment.kind === 'fresh' ? segment.label : label;
    if (own !== undefined && own > afterLabel) {
      return { at: index, upper: own };
    }
  }
  return { at: segments.length, upper: plan.nextLabel };
}

/** Puts a row at the midpoint after `afterLabel`; throws when the neighbours leave no label between them. */
export async function insertSegment(
  ctx: PlanContext,
  plan: GroupPlan,
  afterLabel: bigint,
  make: (label: bigint) => FreshSegment,
): Promise<void> {
  const segments = ensureSegments(plan);
  rejectAfterStream(segments);
  const slot = await findInsertSlot(
    requireAccess(ctx),
    plan,
    segments,
    afterLabel,
  );
  const label = labelBetween(afterLabel, slot.upper);
  if (label === undefined) {
    throw new JournalFormatError(
      `No label lies between ${afterLabel} and ${slot.upper}; relabelling the run is not supported`,
    );
  }
  segments.splice(slot.at, 0, make(label));
}

/** What one step of trimming the sequence removed, and whether the next segment is to be looked at. */
interface TrimStep {
  readonly removed: number;
  readonly more: boolean;
}

const TRIM_DONE: TrimStep = { removed: 0, more: false };

function labelOfSingle(segment: EntrySegment | FreshSegment): bigint {
  return segment.kind === 'entry' ? segment.entry.label : segment.label;
}

async function trimLastSegment(
  access: RecordAccess,
  segments: Segment[],
  cut: bigint,
): Promise<TrimStep> {
  const at = segments.length - 1;
  const segment = segments[at];
  if (segment.kind === 'stream') return TRIM_DONE;
  if (segment.kind !== 'existing') {
    if (labelOfSingle(segment) < cut) return TRIM_DONE;
    segments.pop();
    return { removed: 1, more: true };
  }
  const below = await countRowsBelow(access, requireRoot(segment.source), cut);
  const kept = Math.min(Math.max(below, segment.from), segment.to);
  const removed = segment.to - kept;
  if (kept > segment.from) {
    segments[at] = { ...segment, to: kept };
    return { removed, more: false };
  }
  segments.pop();
  return { removed, more: true };
}

/** Removes every row with a label at or above `cut` from the end of the sequence and returns how many went. */
export async function cutSuffix(
  ctx: PlanContext,
  plan: GroupPlan,
  cut: bigint,
): Promise<number> {
  const segments = ensureSegments(plan);
  rejectAfterStream(segments);
  const access = requireAccess(ctx);
  let removed = 0;
  let more = true;
  while (more && segments.length > 0) {
    const step = await trimLastSegment(access, segments, cut);
    removed += step.removed;
    more = step.more;
  }
  return removed;
}

async function trimFirstSegment(
  access: RecordAccess,
  segments: Segment[],
  cut: bigint,
): Promise<TrimStep> {
  const segment = segments[0];
  if (segment.kind === 'stream') return TRIM_DONE;
  if (segment.kind !== 'existing') {
    if (labelOfSingle(segment) >= cut) return TRIM_DONE;
    segments.shift();
    return { removed: 1, more: true };
  }
  const below = await countRowsBelow(access, requireRoot(segment.source), cut);
  const kept = Math.min(Math.max(below, segment.from), segment.to);
  const removed = kept - segment.from;
  if (kept < segment.to) {
    segments[0] = { ...segment, from: kept };
    return { removed, more: false };
  }
  segments.shift();
  return { removed, more: true };
}

/** Removes every row below `cut` from the start of the sequence and returns how many went. */
export async function cutPrefix(
  ctx: PlanContext,
  plan: GroupPlan,
  cut: bigint,
): Promise<number> {
  const segments = ensureSegments(plan);
  rejectAfterStream(segments);
  const access = requireAccess(ctx);
  let removed = 0;
  let more = true;
  while (more && segments.length > 0) {
    const step = await trimFirstSegment(access, segments, cut);
    removed += step.removed;
    more = step.more;
  }
  return removed;
}

/** The label of the first row of the sequence, or undefined when it is empty. */
export async function firstLabelOf(
  ctx: PlanContext,
  segments: readonly Segment[],
): Promise<bigint | undefined> {
  if (segments.length === 0) return undefined;
  const first = segments[0];
  switch (first.kind) {
    case 'entry':
      return first.entry.label;
    case 'fresh':
      return first.label;
    case 'existing':
      return (
        await entryAt(requireAccess(ctx), requireRoot(first.source), first.from)
      ).label;
    case 'stream':
      throw new JournalFormatError('A replace has no label before it runs');
    default: {
      const unknown: never = first;
      throw new JournalFormatError(
        `Unknown segment ${JSON.stringify(unknown)}`,
      );
    }
  }
}
