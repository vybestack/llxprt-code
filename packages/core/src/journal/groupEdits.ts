/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IdFactQueries } from './idFactQueries.js';
import type { IdOccurrence } from './idFactUpdate.js';
import type { RecordAccess } from './recordAccess.js';
import type { RowDraft } from './rowDraft.js';
import type { RowEntry } from './rowEntry.js';
import type { Version } from './version.js';

/**
 * The index-entry fields a fill sets for one row (design 4.6 and 8.2). A fill
 * writes no row content: the fields come from the caller, who computed them
 * for the active format slots.
 */
export interface EntryFill {
  readonly label: bigint;
  readonly tokens?: RowEntry['tokens'];
  readonly media?: RowEntry['media'];
  readonly stamp?: RowEntry['stamp'];
  readonly summary?: RowEntry['summary'];
  readonly lensRef?: RowEntry['lensRef'];
}

/**
 * The owner of a row that rewrites a live row or sits next to one (design
 * 5.1): this says "the owner of the entry I replace" for a density or purge
 * replacement, and "the owner of the row I follow" for a synthetic insert. A
 * number, 0 for unowned included, names the owner outright.
 */
export const INHERIT_OWNER = 'inherit';

/** A draft whose owner may be inherited; the owner is still required, so a caller always says which. */
export type InheritingDraft = Omit<RowDraft, 'owner'> & {
  readonly owner: number | typeof INHERIT_OWNER;
};

/** A row written for a label that is already live: a density replacement or a purged row. */
export interface LabeledDraft {
  readonly label: bigint;
  readonly draft: InheritingDraft;
}

/** A new owner for the entry of one live row. */
export interface OwnerChange {
  readonly label: bigint;
  readonly owner: number;
}

/**
 * A row of another journal's file, as a mirror takes it (design 5.2 and 5.3):
 * the `ROW` record is copied byte for byte under the label it has there, so a
 * label means the same row in every file. `entry` is the row's entry in the
 * version `source` is bound to, which is where the current owner is read.
 */
export interface SourceRow {
  readonly source: RecordAccess;
  readonly entry: RowEntry;
}

/** One primitive edit of a commit group (design 4.1). The group applies them in order and commits once. */
export type VersionEdit =
  /** Design 4.2: rows at the next labels, with their id facts. */
  | { readonly kind: 'append'; readonly rows: readonly RowDraft[] }
  /** Design 4.3: remove every live row with `label >= cutLabel`; `expectedRemoved` is checked. */
  | {
      readonly kind: 'pop';
      readonly cutLabel: bigint;
      readonly expectedRemoved: number;
    }
  /** Design 4.7: empty roots and a new lineage; `nextLabel` carries on. */
  | { readonly kind: 'clear' }
  /** Design 4.5: the roots of a saved version with the current state map; a new lineage. */
  | { readonly kind: 'restore'; readonly saved: Version }
  /** An entry of the unversioned state map (design 3.5). */
  | {
      readonly kind: 'setState';
      readonly key: string;
      readonly value: Uint8Array;
    }
  /**
   * Design 4.4: every live row below `retainFromLabel` is replaced by the
   * summary row, which takes the label just below the first retained row, or
   * the next label when nothing is retained. `expectedReplaced` is checked.
   */
  | {
      readonly kind: 'compress';
      readonly summary: RowDraft;
      readonly retainFromLabel: bigint;
      readonly expectedReplaced: number;
    }
  /**
   * Design 4.5: the whole history is replaced by the rows of a stream, written
   * as they are produced. No other row edit may follow it in the group.
   */
  | {
      readonly kind: 'replace';
      readonly rows: Iterable<RowDraft> | AsyncIterable<RowDraft>;
    }
  /** Design 4.6: the replacements keep their labels, the removed labels are dropped. */
  | {
      readonly kind: 'density';
      readonly replacements: readonly LabeledDraft[];
      readonly removed: readonly bigint[];
    }
  /** Design 4.6: rows rewritten under their own labels. */
  | { readonly kind: 'purge'; readonly rows: readonly LabeledDraft[] }
  /** Design 4.6: a synthetic row at the midpoint after the live row `afterLabel` (0 for the start). */
  | {
      readonly kind: 'insert';
      readonly afterLabel: bigint;
      readonly draft: InheritingDraft;
    }
  /** Design 5.4: an entry replacement; the `ROW` record is not rewritten. */
  | { readonly kind: 'owner'; readonly changes: readonly OwnerChange[] }
  /**
   * Design 5.2: rows copied from another journal under their own labels,
   * which must not be live. `end` says every label is above the last live
   * row, so the group is an append and keeps its lineage; `anywhere` is an
   * insert and starts a new one. `nextLabel` is the `nextLabel` of the journal
   * the rows come from, so a label is never handed out below a copied one.
   */
  | {
      readonly kind: 'adopt';
      readonly rows: readonly SourceRow[];
      readonly placement: 'end' | 'anywhere';
      readonly nextLabel: bigint;
    }
  /** Design 5.3: the whole history becomes the rows of a stream, copied from another journal. */
  | {
      readonly kind: 'adoptAll';
      readonly rows: AsyncIterable<SourceRow>;
      readonly nextLabel: bigint;
    }
  /** Design 5.2: removes every live row below `belowLabel`; `expectedRemoved` is checked and may be 0. */
  | {
      readonly kind: 'trimHead';
      readonly belowLabel: bigint;
      readonly expectedRemoved: number;
    }
  /** Design 4.6 and 8.2: entry fields for rows; the row set does not change. */
  | { readonly kind: 'fill'; readonly fills: readonly EntryFill[] }
  /** Design 4.9: a named checkpoint of the version the group builds on; a state-only group. */
  | {
      readonly kind: 'checkpoint';
      readonly id: string;
      readonly name: string;
      readonly createdAtMs: number;
    }
  /**
   * Design 4.9: a live checkpoint is deleted. A state-only group: the entry
   * becomes a tombstone (a compaction drops it) and `ckptBytes` gives the
   * checkpoint's `liveBytes` back, so the version it retained is garbage.
   */
  | { readonly kind: 'deleteCheckpoint'; readonly id: string };

/** A row as the occurrence planner sees it: its place, its speaker and its ids with their raw strings. */
export interface PlannedRow {
  readonly label: bigint;
  readonly speaker: number;
  readonly flags: number;
  readonly blockTypes: readonly number[];
  readonly ids: ReadonlyArray<{
    readonly rawId: string;
    readonly kind: number;
    readonly block: number;
    readonly score: number;
    readonly nameLen: number;
  }>;
}

/**
 * Decides where each id of a row is emitted in the normalized stream. That is
 * the normalizer's business (design 6), so the journal takes it as a
 * dependency and only records what it is given. It reads facts through
 * `facts`, which see the writes of the group so far.
 */
export type OccurrencePlanner = (
  row: PlannedRow,
  facts: IdFactQueries,
) => Promise<readonly IdOccurrence[]>;
