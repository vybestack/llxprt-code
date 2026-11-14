/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { Aggregate } from './aggregate.js';
import { EMPTY_AGGREGATE, type SlotKinds } from './aggregateComposition.js';
import type { Triple } from './bytes.js';
import { MUTATION, type MutationCode } from './recordKinds.js';
import type { SlotTable } from './slotTable.js';
import type { TrailerHeader } from './trailerRecord.js';

/** The four roots a trailer names; 0 is an empty structure (design 2.5). */
export interface VersionRoots {
  readonly rowRoot: number;
  readonly idRoot: number;
  readonly metaRoot: number;
  readonly stateRoot: number;
}

/**
 * One version of a journal: the roots of the row tree, id trie, meta map and
 * state map with the lineage links, the commit sequence and the group tag
 * that name it (design 2.5 and 4.3). `commitSeq` and `groupTag` together
 * identify the version, so one that was lost and rewritten cannot be taken
 * for the original (design 5.2).
 */
export interface Version {
  /** Offset of the trailer that carries this version; 0 for the version before the first group. */
  readonly selfOffset: number;
  readonly commitSeq: number;
  readonly groupTag: bigint;
  /** What the group that wrote this version did; undefined before the first group. */
  readonly mutation: MutationCode | undefined;
  readonly mutationArg0: bigint;
  readonly mutationArg1: bigint;
  readonly roots: VersionRoots;
  /** The lineage id, which is the `commitSeq` of the trailer that started it. */
  readonly lineage: bigint;
  /** Parent hops since the lineage start. */
  readonly lineageDepth: number;
  /** The trailer this version extends, 0 for a lineage start. */
  readonly parent: number;
  /** Ancestors 8, 64 and 512 parent hops back, 0 where there are none. */
  readonly skip: Triple<number>;
  readonly rows: number;
  readonly nextLabel: bigint;
  readonly firstLabel: bigint;
  readonly lastRowOffset: number;
  readonly lastOwner: number;
  readonly ckptBytes: number;
  readonly aggregate: Aggregate;
  readonly slots: SlotTable;
  readonly durableEnd: number;
}

export function versionOf(trailer: TrailerHeader): Version {
  return {
    selfOffset: trailer.selfOffset,
    commitSeq: trailer.commitSeq,
    groupTag: trailer.groupTag,
    mutation: trailer.mutation,
    mutationArg0: trailer.mutationArg0,
    mutationArg1: trailer.mutationArg1,
    roots: {
      rowRoot: trailer.rowRoot,
      idRoot: trailer.idRoot,
      metaRoot: trailer.metaRoot,
      stateRoot: trailer.stateRoot,
    },
    lineage: trailer.lineage,
    lineageDepth: trailer.lineageDepth,
    parent: trailer.parent,
    skip: trailer.skip,
    rows: trailer.rootAggregate.rows,
    nextLabel: trailer.nextLabel,
    firstLabel: trailer.firstLabel,
    lastRowOffset: trailer.lastRowOffset,
    lastOwner: trailer.lastOwner,
    ckptBytes: trailer.ckptBytes,
    aggregate: trailer.rootAggregate,
    slots: trailer.slots,
    durableEnd: trailer.durableEnd,
  };
}

export function sameVersion(left: Version, right: Version): boolean {
  return left.commitSeq === right.commitSeq && left.groupTag === right.groupTag;
}

const NO_FORMAT_SLOT = {
  formatKeyHash: 0n,
  formatRev: 0,
  gen: 0,
  imageKeyHash: 0n,
  imageGen: 0,
  summaryKind: null,
  filledThrough: 0,
} as const;
const NO_FAMILY_SLOT = { familyKeyHash: 0n, estimatorRev: 0, gen: 0 } as const;

/** A slot table with nothing assigned. */
export const EMPTY_SLOT_TABLE: SlotTable = {
  formatSlots: [NO_FORMAT_SLOT, NO_FORMAT_SLOT, NO_FORMAT_SLOT],
  familySlots: [NO_FAMILY_SLOT, NO_FAMILY_SLOT, NO_FAMILY_SLOT, NO_FAMILY_SLOT],
};

/** The version before the first group: no rows, no roots, no ancestor. */
export function genesisVersion(firstNextLabel: bigint): Version {
  return {
    selfOffset: 0,
    commitSeq: 0,
    groupTag: 0n,
    mutation: undefined,
    mutationArg0: 0n,
    mutationArg1: 0n,
    roots: { rowRoot: 0, idRoot: 0, metaRoot: 0, stateRoot: 0 },
    lineage: 0n,
    lineageDepth: 0,
    parent: 0,
    skip: [0, 0, 0],
    rows: 0,
    nextLabel: firstNextLabel,
    firstLabel: 0n,
    lastRowOffset: 0,
    lastOwner: 0,
    ckptBytes: 0,
    aggregate: EMPTY_AGGREGATE,
    slots: EMPTY_SLOT_TABLE,
    durableEnd: 0,
  };
}

/** A version with no rows that keeps `from`'s slot table, for a group that clears or rebuilds. */
export function emptiedVersion(from: Version): Version {
  return {
    ...from,
    roots: { ...from.roots, rowRoot: 0, idRoot: 0, metaRoot: 0 },
    rows: 0,
    firstLabel: 0n,
    lastRowOffset: 0,
    lastOwner: 0,
    aggregate: EMPTY_AGGREGATE,
  };
}

/**
 * Design 4.3: only a group that leaves every earlier row set a prefix of the
 * next keeps its lineage. Append, pop, fill and a state-only group do. Every
 * other group starts a new lineage, because restoring an older ancestor
 * after it would silently undo it.
 */
export function mutationKeepsLineage(code: MutationCode): boolean {
  return (
    code === MUTATION.append ||
    code === MUTATION.pop ||
    code === MUTATION.fill ||
    code === MUTATION.state
  );
}

/** The summary kind of each format slot, which the aggregate composition needs. */
export function slotKindsOf(slots: SlotTable): SlotKinds {
  const [first, second, third] = slots.formatSlots;
  return [first.summaryKind, second.summaryKind, third.summaryKind];
}

export function hasActiveSlot(slots: SlotTable): boolean {
  return slotKindsOf(slots).some((kind) => kind !== null);
}
