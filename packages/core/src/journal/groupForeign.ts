/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';
import type { SourceRow } from './groupEdits.js';
import type {
  ExistingSegment,
  ForeignSegment,
  GroupPlan,
  PlanContext,
  Segment,
} from './groupPlanTypes.js';
import {
  cutPrefix,
  ensureSegments,
  leaveLineage,
  rejectAfterStream,
  requireAccess,
  requireRoot,
  singleLabel,
} from './groupSegments.js';
import { countRowsBelow } from './rowTreeQueries.js';
import { entryAt } from './rowTreeReader.js';

function labelOf(row: SourceRow): bigint {
  return row.entry.label;
}

function assertAscending(rows: readonly SourceRow[]): void {
  for (let at = 1; at < rows.length; at++) {
    if (labelOf(rows[at]) <= labelOf(rows[at - 1])) {
      throw new JournalFormatError(
        `Rows copied in one edit must have ascending labels, but ${labelOf(rows[at])} follows ${labelOf(rows[at - 1])}`,
      );
    }
  }
}

function foreignSegment(
  row: SourceRow,
  role: ForeignSegment['role'],
): ForeignSegment {
  return { kind: 'foreign', row, role };
}

function liveError(label: bigint): JournalFormatError {
  return new JournalFormatError(
    `Label ${label} is live, so a row cannot be copied in under it`,
  );
}

/** Where the merge stands: the rows still to place, and whether one went in front of a kept row. */
interface MergeState {
  readonly rows: readonly SourceRow[];
  readonly role: ForeignSegment['role'];
  next: number;
  inside: boolean;
}

function take(state: MergeState): SourceRow {
  const row = state.rows[state.next];
  state.next += 1;
  return row;
}

function pending(state: MergeState): SourceRow | undefined {
  return state.rows[state.next];
}

/** Places the rows that belong in front of the single-row segment `label`. */
function mergeBeforeSingle(
  state: MergeState,
  label: bigint,
  out: Segment[],
): void {
  for (let row = pending(state); row !== undefined; row = pending(state)) {
    if (labelOf(row) > label) return;
    if (labelOf(row) === label) throw liveError(label);
    out.push(foreignSegment(take(state), state.role));
    state.inside = true;
  }
}

/** The rows that belong inside `segment`, each splitting it, found with one descent per row. */
async function mergeIntoExisting(
  ctx: PlanContext,
  state: MergeState,
  segment: ExistingSegment,
  out: Segment[],
): Promise<void> {
  const access = requireAccess(ctx);
  const root = requireRoot(segment.source);
  const last = (await entryAt(access, root, segment.to - 1)).label;
  let from = segment.from;
  for (let row = pending(state); row !== undefined; row = pending(state)) {
    const label = labelOf(row);
    if (label > last) break;
    const below = await countRowsBelow(access, root, label);
    const at = Math.min(Math.max(below, from), segment.to);
    if ((await entryAt(access, root, at)).label === label) {
      throw liveError(label);
    }
    if (at > from) out.push({ ...segment, from, to: at });
    out.push(foreignSegment(take(state), state.role));
    state.inside = true;
    from = at;
  }
  if (from < segment.to) out.push({ ...segment, from });
}

/**
 * Merges the rows into the segments in one pass, so a group that copies in
 * thousands of rows costs one descent for each and not a scan of the
 * sequence for each. Returns whether any row went in front of a row that the
 * group keeps, which is what separates an insert from an append.
 */
async function mergeForeignRows(
  ctx: PlanContext,
  segments: readonly Segment[],
  state: MergeState,
): Promise<Segment[]> {
  const out: Segment[] = [];
  for (const segment of segments) {
    if (pending(state) === undefined) {
      out.push(segment);
    } else if (segment.kind === 'existing') {
      await mergeIntoExisting(ctx, state, segment, out);
    } else if (segment.kind === 'stream' || segment.kind === 'foreignStream') {
      out.push(segment);
    } else {
      mergeBeforeSingle(state, singleLabel(segment), out);
      out.push(segment);
    }
  }
  for (let row = pending(state); row !== undefined; row = pending(state)) {
    out.push(foreignSegment(take(state), state.role));
  }
  return out;
}

/** Design 5.2: copies the rows in under their labels. */
export async function applyAdopt(
  ctx: PlanContext,
  plan: GroupPlan,
  edit: {
    readonly rows: readonly SourceRow[];
    readonly placement: 'end' | 'anywhere';
    readonly nextLabel: bigint;
  },
): Promise<void> {
  if (edit.rows.length === 0) {
    throw new JournalFormatError('An adopt names no rows');
  }
  assertAscending(edit.rows);
  const segments = ensureSegments(plan);
  rejectAfterStream(segments);
  const state: MergeState = {
    rows: edit.rows,
    role: edit.placement === 'end' ? 'append' : 'insert',
    next: 0,
    inside: false,
  };
  const merged = await mergeForeignRows(ctx, segments, state);
  if (edit.placement === 'end' && state.inside) {
    throw new JournalFormatError(
      'Rows copied to the end must have labels above every live row',
    );
  }
  if (edit.placement === 'anywhere') leaveLineage(plan);
  plan.segments = merged;
  if (edit.nextLabel > plan.nextLabel) plan.nextLabel = edit.nextLabel;
}

/** Design 5.3: the whole history is the copied rows of a stream. */
export function applyAdoptAll(
  plan: GroupPlan,
  rows: AsyncIterable<SourceRow>,
  nextLabel: bigint,
): void {
  leaveLineage(plan);
  plan.range = undefined;
  plan.newRows = [];
  plan.segments = [{ kind: 'foreignStream', rows, nextLabel }];
}

/** Design 5.2: removes the rows below a label, however many there are. */
export async function applyTrimHead(
  ctx: PlanContext,
  plan: GroupPlan,
  belowLabel: bigint,
  expectedRemoved: number,
): Promise<void> {
  leaveLineage(plan);
  const removed = await cutPrefix(ctx, plan, belowLabel);
  if (removed !== expectedRemoved) {
    throw new JournalFormatError(
      `Trimming below label ${belowLabel} removes ${removed} rows, not the expected ${expectedRemoved}`,
    );
  }
  plan.args = { cut: belowLabel, removed };
}
