/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  INHERIT_OWNER,
  type InheritingDraft,
  type LabeledDraft,
  type VersionEdit,
} from '../../journal/groupEdits.js';
import type { RowDraft } from '../../journal/rowDraft.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { DensityMutationPayload } from '../../recording/types.js';
import type { IContent } from './IContent.js';
import { encodeContentRow, UNOWNED_ROW } from './journalRowCodec.js';

/** A row at `position` of the history, rewritten as `content` (a purge). */
export interface PositionedContent {
  readonly position: number;
  readonly content: IContent;
}

/** The row at `position` of the history, given a new owner. */
export interface PositionedOwner {
  readonly position: number;
  readonly owner: number;
}

/** A row that rewrites a live row keeps that row's owner (design 4.6). */
export function inheritingDraft(content: IContent): InheritingDraft {
  const draft: RowDraft = encodeContentRow(content, { owner: UNOWNED_ROW });
  return { ...draft, owner: INHERIT_OWNER };
}

/** Positions must be distinct whole numbers inside the history; returns them sorted. */
export function checkedPositions<T extends { readonly position: number }>(
  changes: readonly T[],
  rows: number,
): T[] {
  const seen = new Set<number>();
  for (const { position } of changes) {
    if (!Number.isInteger(position) || position < 0 || position >= rows) {
      throw new Error(`Position ${position} is outside the ${rows} rows`);
    }
    if (seen.has(position)) {
      throw new Error(`Position ${position} is named twice`);
    }
    seen.add(position);
  }
  return [...changes].sort((a, b) => a.position - b.position);
}

/** The labels of the rows at the given positions of the snapshot, in the order asked. */
export async function labelsAt(
  snapshot: VersionSnapshot,
  positions: readonly number[],
): Promise<bigint[]> {
  const labels: bigint[] = [];
  for (const position of positions) {
    labels.push((await snapshot.entryAt(position)).label);
  }
  return labels;
}

/**
 * The label of the one live row that carries each chronology number. A number
 * that names no row or more than one row is refused: the density caller
 * addressed a row it could not have meant (design 4.3 on addressing by
 * number).
 */
export async function labelsOfChronology(
  snapshot: VersionSnapshot,
  wanted: ReadonlySet<number>,
): Promise<Map<number, bigint>> {
  const seqs = new Map<bigint, number>();
  for (const seq of wanted) seqs.set(BigInt(seq), seq);
  const found = new Map<number, bigint[]>();
  for await (const entry of snapshot.entries()) {
    const seq = seqs.get(entry.chronologySeq);
    if (seq === undefined) continue;
    found.set(seq, [...(found.get(seq) ?? []), entry.label]);
  }
  const labels = new Map<number, bigint>();
  for (const seq of wanted) {
    const rows = found.get(seq) ?? [];
    if (rows.length === 0) {
      throw new Error(`Density: no row has chronology number ${seq}`);
    }
    if (rows.length > 1) {
      throw new Error(
        `Density: chronology number ${seq} names ${rows.length} rows`,
      );
    }
    labels.set(seq, rows[0]);
  }
  return labels;
}

function labelFor(labels: ReadonlyMap<number, bigint>, seq: number): bigint {
  const label = labels.get(seq);
  if (label === undefined) {
    throw new Error(`Density: no label for chronology number ${seq}`);
  }
  return label;
}

/**
 * A density mutation as the edit it becomes. The replacement wins when a
 * number is both removed and replaced, as it did in the fold.
 */
export interface PlannedDensity {
  /** Rows the density takes out of the history. */
  readonly removedRows: number;
  /** A density that changes nothing writes no group. */
  readonly empty: boolean;
  readonly build: (snapshot: VersionSnapshot) => Promise<VersionEdit[]>;
}

export function planDensity(payload: DensityMutationPayload): PlannedDensity {
  const replaced = new Set<number>();
  const replacements = payload.replacements.map((entry) => {
    if (replaced.has(entry.replacedSeq)) {
      throw new Error(
        `Density replaces chronology number ${entry.replacedSeq} twice`,
      );
    }
    replaced.add(entry.replacedSeq);
    return {
      seq: entry.replacedSeq,
      draft: inheritingDraft(entry.replacement),
    };
  });
  const removed = new Set(
    payload.removedSeqs.filter((seq) => !replaced.has(seq)),
  );
  return {
    removedRows: removed.size,
    empty: replacements.length === 0 && removed.size === 0,
    build: async (snapshot) => {
      const labels = await labelsOfChronology(
        snapshot,
        new Set([...replaced, ...removed]),
      );
      const labeled: LabeledDraft[] = replacements.map(({ seq, draft }) => ({
        label: labelFor(labels, seq),
        draft,
      }));
      return [
        {
          kind: 'density',
          replacements: labeled,
          removed: [...removed].map((seq) => labelFor(labels, seq)),
        },
      ];
    },
  };
}
