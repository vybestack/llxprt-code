/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionReader } from './lineageChain.js';
import type { RecordAccess } from './recordAccess.js';
import type { SourceRow } from './groupEdits.js';
import type { RowDraft } from './rowDraft.js';
import type { RowEntry } from './rowEntry.js';
import type { Version } from './version.js';

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

/** The two trailer arguments of a pop or a compression: the cut label and how many rows it took. */
export interface MutationArgs {
  readonly cut: bigint;
  readonly removed: number;
}

/**
 * Why a row is written in this group, which decides how its facts are kept
 * (design 4.6). `append` and `insert` add a row; `purge` rewrites a row whose
 * id tuples, parent flag and endpoint are the same, so its facts stand;
 * `replacement` is a density rewrite and `summary` a compression summary, both
 * of which rebuild the facts.
 */
export type FreshRole =
  | 'append'
  | 'insert'
  | 'purge'
  | 'replacement'
  | 'summary';

/** A run of rows of a committed tree, unchanged. */
export interface ExistingSegment extends ExistingRange {
  readonly kind: 'existing';
}

/** A row whose record is already in the file but whose index entry changed (an owner change, a fill). */
export interface EntrySegment {
  readonly kind: 'entry';
  readonly entry: RowEntry;
}

/** A row whose record is written in this group. */
export interface FreshSegment {
  readonly kind: 'fresh';
  readonly label: bigint;
  readonly draft: RowDraft;
  readonly role: FreshRole;
  /** For a `purge`: the entry of the row it rewrites, whose derived fields it keeps. */
  readonly replaces?: RowEntry;
}

/** A row copied from another journal under its own label (design 5.2). It is an addition, never a replacement. */
export interface ForeignSegment {
  readonly kind: 'foreign';
  readonly row: SourceRow;
  /** `append` at the end of the history; `insert` anywhere else, which rebuilds the facts. */
  readonly role: 'append' | 'insert';
}

/** The rows of an adopt-all, copied as the stream produces them. */
export interface ForeignStreamSegment {
  readonly kind: 'foreignStream';
  readonly rows: AsyncIterable<SourceRow>;
  readonly nextLabel: bigint;
}

/** The rows of a replace, written as the stream produces them. */
export interface StreamSegment {
  readonly kind: 'stream';
  readonly rows: Iterable<RowDraft> | AsyncIterable<RowDraft>;
}

/** One piece of the row sequence a group builds, in label order. */
export type Segment =
  | ExistingSegment
  | EntrySegment
  | FreshSegment
  | StreamSegment
  | ForeignSegment
  | ForeignStreamSegment;

/**
 * What a group has decided so far. The version it builds on, `base`, is a
 * real version whose roots are reused as they are; the rows after it are
 * `range` (existing entries, no new record) followed by `newRows`. A pop that
 * lands inside a group re-appends part of one (design 4.3 step 4), and a pop
 * that must rebuild is an empty `base` with the whole kept prefix as `range`.
 *
 * The first edit that changes rows other than at the end (design 4.4 to 4.6)
 * turns these three into `segments`, which describe the whole row sequence.
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
  args: MutationArgs | undefined;
  rebuilt: boolean;
  segments: Segment[] | undefined;
}

export interface PlanContext {
  /** Undefined until the first group commits. */
  readonly access: RecordAccess | undefined;
  readonly published: Version | undefined;
  readonly readVersion: VersionReader;
  /** The `nextLabel` of a journal with no group. */
  readonly firstNextLabel: bigint;
  /** An entry of the state map of the published version. */
  readonly readState: (key: string) => Promise<Uint8Array | undefined>;
}
