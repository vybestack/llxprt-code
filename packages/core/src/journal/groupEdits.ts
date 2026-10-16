/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IdFactQueries } from './idFactQueries.js';
import type { IdOccurrence } from './idFactUpdate.js';
import type { RowDraft } from './rowDraft.js';
import type { Version } from './version.js';

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
  /** Design 4.9: a named checkpoint of the version the group builds on; a state-only group. */
  | {
      readonly kind: 'checkpoint';
      readonly id: string;
      readonly name: string;
      readonly createdAtMs: number;
    };

/** A row as the occurrence planner sees it: its place, its speaker and its ids with their raw strings. */
export interface PlannedRow {
  readonly label: bigint;
  readonly speaker: number;
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
