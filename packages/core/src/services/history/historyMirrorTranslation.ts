/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { SessionEventType } from '../../recording/types.js';
import type { IContent } from './IContent.js';
import type { FoldEvent } from './historyJournalFold.js';
import {
  mirrorHolds,
  type OwnerCounts,
  type SharedRowIndex,
} from './historySharedRowIndex.js';

/** One record to append to a mirror's own journal. */
export interface MirrorWrite {
  readonly type: SessionEventType;
  readonly payload: unknown;
}

/**
 * What one mirror must be given for a shared record. A mirror holds exactly
 * the shared rows whose owner it accepts, so positions in the shared history
 * mean nothing to it; each plan is the narrowest change its journal can fold:
 * - `none`: its rows did not change;
 * - `write`: the record, restricted or renumbered to the mirror's rows;
 * - `trim`: a tail rewind by the number of its rows the record removed;
 * - `appendRow`: the one shared row at `position`, which lands at its tail;
 * - `rebuild`: every row it holds after the record, appended when it held
 *   none and otherwise as one replace transaction.
 * `heldBefore` is the count of the mirror's rows before the record.
 */
export type MirrorPlan =
  | { readonly kind: 'none' }
  | { readonly kind: 'write'; readonly write: MirrorWrite }
  | { readonly kind: 'trim'; readonly heldBefore: number }
  | { readonly kind: 'appendRow'; readonly position: number }
  | { readonly kind: 'rebuild'; readonly heldBefore: number };

export interface MirrorPlanInput {
  /** The shared rows before the record; the plans are made before it folds. */
  readonly index: SharedRowIndex;
  readonly mirrors: readonly string[];
  readonly record: MirrorWrite;
  readonly event: FoldEvent;
  readonly owner: string | undefined;
}

const NONE: MirrorPlan = { kind: 'none' };

function plansFor(
  input: MirrorPlanInput,
  plan: (mirror: string, mirrorId: number) => MirrorPlan,
): Map<string, MirrorPlan> {
  return new Map(
    input.mirrors.map((mirror) => [
      mirror,
      plan(mirror, input.index.idOf(mirror)),
    ]),
  );
}

function ownerId(input: MirrorPlanInput): number | undefined {
  return input.owner === undefined ? undefined : input.index.idOf(input.owner);
}

/** A record that leaves a mirror's rows a prefix of what it held. */
function planTrim(
  input: MirrorPlanInput,
  counts: OwnerCounts,
): Map<string, MirrorPlan> {
  return plansFor(input, (_mirror, id) => ({
    kind: 'trim',
    heldBefore: counts.heldBy(id),
  }));
}

function planCompression(
  input: MirrorPlanInput,
  counts: OwnerCounts,
): Map<string, MirrorPlan> {
  const owner = ownerId(input);
  return plansFor(input, (_mirror, id) => {
    const held = counts.heldBy(id);
    if (!mirrorHolds(id, owner))
      return held > 0 ? { kind: 'trim', heldBefore: held } : NONE;
    return held === 0
      ? { kind: 'rebuild', heldBefore: 0 }
      : { kind: 'write', write: input.record };
  });
}

function planPurge(
  input: MirrorPlanInput,
  counts: OwnerCounts,
): Map<string, MirrorPlan> {
  const owner = ownerId(input);
  return plansFor(input, (_mirror, id) => {
    const held = counts.heldBy(id);
    if (mirrorHolds(id, owner)) return { kind: 'rebuild', heldBefore: held };
    return held > 0 ? { kind: 'trim', heldBefore: held } : NONE;
  });
}

interface DensityShare {
  readonly removedSeqs: number[];
  readonly replacements: Array<{
    replacedSeq: number;
    replacement: IContent;
  }>;
  /** The mirror gains a replacement for a row it never held. */
  rebuild: boolean;
}

/** Record a density-touched shared row in a mirror's share of the pass. */
function shareDensityRow(
  input: MirrorPlanInput,
  mirror: string,
  share: DensityShare,
  touched: {
    readonly seq: number;
    readonly rowOrigin: number | undefined;
    readonly next: DensityShare['replacements'][number] | undefined;
    readonly owner: number | undefined;
  },
): void {
  const id = input.index.idOf(mirror);
  const { seq, rowOrigin, next, owner } = touched;
  if (mirrorHolds(id, rowOrigin)) {
    if (next !== undefined && mirrorHolds(id, owner))
      share.replacements.push(next);
    else share.removedSeqs.push(seq);
  } else if (
    next !== undefined &&
    owner !== undefined &&
    mirrorHolds(id, owner)
  )
    share.rebuild = true;
}

/**
 * The density pass restricted to each mirror's own rows. A replacement
 * belongs to the pass's owner, or to the owner of the row it replaces when
 * the pass names none.
 */
function planDensity(
  input: MirrorPlanInput,
  event: Extract<FoldEvent, { readonly kind: 'density' }>,
  counts: () => OwnerCounts,
): Map<string, MirrorPlan> {
  const replacements = new Map(
    event.replacements.map((entry) => [entry.replacedSeq, entry]),
  );
  const removed = new Set(event.removedSeqs);
  const owner = ownerId(input);
  const shares = new Map<string, DensityShare>(
    input.mirrors.map((mirror) => [
      mirror,
      { removedSeqs: [], replacements: [], rebuild: false },
    ]),
  );
  for (const row of input.index.rows()) {
    const seq = row.chronologySeq;
    if (seq === null) continue;
    const next = replacements.get(seq);
    if (next !== undefined || removed.has(seq))
      for (const [mirror, share] of shares)
        shareDensityRow(input, mirror, share, {
          seq,
          rowOrigin: row.origin,
          next,
          owner,
        });
  }
  return new Map(
    Array.from(shares, ([mirror, share]) => [
      mirror,
      densityPlan(input, share, counts, mirror),
    ]),
  );
}

function densityPlan(
  input: MirrorPlanInput,
  share: DensityShare,
  counts: () => OwnerCounts,
  mirror: string,
): MirrorPlan {
  if (share.rebuild)
    return {
      kind: 'rebuild',
      heldBefore: counts().heldBy(input.index.idOf(mirror)),
    };
  if (share.removedSeqs.length === 0 && share.replacements.length === 0)
    return NONE;
  return {
    kind: 'write',
    write: {
      type: 'density_mutation',
      payload: {
        ...(input.record.payload as object),
        removedSeqs: share.removedSeqs,
        replacements: share.replacements,
      },
    },
  };
}

interface InsertScan {
  /** Rows the mirror holds at or before the anchor. */
  held: number;
  /** Chronology marker of the last of them, if it has one. */
  lastSeq: number | null | undefined;
}

/** How many rows each mirror holds in [0, end) and the marker of the last one. */
function scanBefore(
  input: MirrorPlanInput,
  end: number,
): Map<string, InsertScan> {
  const scans = new Map<string, InsertScan>(
    input.mirrors.map((mirror) => [mirror, { held: 0, lastSeq: undefined }]),
  );
  let position = 0;
  for (const row of input.index.rows()) {
    if (position++ >= end) break;
    for (const mirror of input.mirrors) {
      const scan = scans.get(mirror);
      if (
        scan === undefined ||
        !mirrorHolds(input.index.idOf(mirror), row.origin)
      )
        continue;
      scan.held++;
      scan.lastSeq = row.chronologySeq;
    }
  }
  return scans;
}

/** Mirrors whose first row carrying `seq` within [0, end) is the one at `last`. */
function anchorsAreFirst(
  input: MirrorPlanInput,
  end: number,
  scans: ReadonlyMap<string, InsertScan>,
): Set<string> {
  const hits = new Map<string, number>();
  let position = 0;
  for (const row of input.index.rows()) {
    if (position++ >= end) break;
    for (const mirror of input.mirrors) {
      const scan = scans.get(mirror);
      if (
        scan?.lastSeq === row.chronologySeq &&
        scan.lastSeq !== null &&
        mirrorHolds(input.index.idOf(mirror), row.origin)
      )
        hits.set(mirror, (hits.get(mirror) ?? 0) + 1);
    }
  }
  return new Set(input.mirrors.filter((mirror) => hits.get(mirror) === 1));
}

/**
 * An insert after the row carrying `afterSeq`. The inserted row goes to the
 * mirrors that hold its owner: appended when it lands at their tail, inserted
 * after the last of their rows before it when that row's marker finds it, and
 * otherwise by rebuilding the mirror.
 */
function planInsert(
  input: MirrorPlanInput,
  event: Extract<FoldEvent, { readonly kind: 'syntheticInsert' }>,
  counts: () => OwnerCounts,
): Map<string, MirrorPlan> {
  const anchor = input.index.firstChronology(event.afterSeq);
  if (anchor === -1) return plansFor(input, () => NONE);
  const owner =
    input.owner === undefined
      ? input.index.rowAt(anchor).origin
      : input.index.idOf(input.owner);
  const scans = scanBefore(input, anchor + 1);
  const addressable = anchorsAreFirst(input, anchor + 1, scans);
  return plansFor(input, (mirror, id): MirrorPlan => {
    if (!mirrorHolds(id, owner)) return NONE;
    const scan = scans.get(mirror);
    const heldBefore = counts().heldBy(id);
    if (scan?.held === heldBefore)
      return { kind: 'appendRow', position: anchor + 1 };
    if (
      scan !== undefined &&
      scan.held > 0 &&
      typeof scan.lastSeq === 'number' &&
      addressable.has(mirror)
    )
      return {
        kind: 'write',
        write: {
          type: 'synthetic_insert',
          payload: {
            ...(input.record.payload as object),
            afterSeq: scan.lastSeq,
          },
        },
      };
    return { kind: 'rebuild', heldBefore };
  });
}

/** A rebinding keeps the row's owner, so only the mirrors holding it hear of it. */
function planBind(
  input: MirrorPlanInput,
  event: Extract<FoldEvent, { readonly kind: 'chronologyBind' }>,
): Map<string, MirrorPlan> {
  const target = event.binding.rowIndex;
  if (target >= input.index.length) return plansFor(input, () => NONE);
  const targetOwner = input.index.rowAt(target).origin;
  const ranks = new Map<string, number>(
    input.mirrors.map((mirror) => [mirror, 0]),
  );
  let position = 0;
  for (const row of input.index.rows()) {
    if (position++ >= target) break;
    for (const mirror of input.mirrors)
      if (mirrorHolds(input.index.idOf(mirror), row.origin))
        ranks.set(mirror, (ranks.get(mirror) ?? 0) + 1);
  }
  return plansFor(input, (mirror, id): MirrorPlan => {
    if (!mirrorHolds(id, targetOwner)) return NONE;
    return {
      kind: 'write',
      write: {
        type: input.record.type,
        payload: {
          ...(input.record.payload as object),
          rowIndex: ranks.get(mirror) ?? 0,
        },
      },
    };
  });
}

/**
 * Plan what each mirror needs for one shared record, from the shared rows as
 * they are before the record folds. Positions are counted by scanning the
 * disk rows in bounded chunks, so nothing the size of the history is held.
 */
export function planMirrors(input: MirrorPlanInput): Map<string, MirrorPlan> {
  const { event } = input;
  let memo: OwnerCounts | undefined;
  const counts = (): OwnerCounts => (memo ??= input.index.counts());
  switch (event.kind) {
    case 'rewind':
      return planTrim(input, counts());
    case 'compressed':
      return planCompression(input, counts());
    case 'semanticPurge':
      return planPurge(input, counts());
    case 'density':
      return planDensity(input, event, counts);
    case 'syntheticInsert':
      return planInsert(input, event, counts);
    case 'chronologyBind':
      return planBind(input, event);
    default:
      return plansFor(input, () => NONE);
  }
}
