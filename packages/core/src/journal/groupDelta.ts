/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionEdit } from './groupEdits.js';
import type { CommittedGroup } from './journalStore.js';
import { identityOf, type PrimaryIdentity } from './mirrorIdentity.js';
import type { RecordAccess } from './recordAccess.js';
import type { Version } from './version.js';

/**
 * What one acked primary group did, written with labels so that every mirror
 * can apply it to its own file (design 5.2). It is built from the group's
 * edits and the labels of the rows the group wrote, and it holds no row, so
 * it stays the size of the group however long the history is.
 */
export interface GroupDelta {
  /** The primary version the group made. A mirror that applies the delta records it. */
  readonly identity: PrimaryIdentity;
  readonly before: Version | undefined;
  readonly after: Version;
  /** Reads bound to `after`, valid while the group's pin is held. They reach `before`, because a version only points back. */
  readonly access: RecordAccess;
  /** A clear, a replace or a restore: the mirror takes the accepted rows of `after` again. */
  readonly resync: boolean;
  /** The lowest label any pop of the group cut at: rows at or above it are gone. */
  readonly popFrom: bigint | undefined;
  /** The highest label any compression of the group retained from: rows below it are gone. */
  readonly trimBelow: bigint | undefined;
  /**
   * Every label the group wrote, replaced, dropped or gave a new owner,
   * ascending and without repeats. A row outside this list and outside the two
   * cuts is exactly as it was, so the mirror needs nothing for it.
   */
  readonly touched: readonly bigint[];
  readonly appendedFrom?: number;
}

function lowest(values: readonly bigint[]): bigint | undefined {
  return values.length === 0
    ? undefined
    : values.reduce((low, value) => (value < low ? value : low));
}

function highest(values: readonly bigint[]): bigint | undefined {
  return values.length === 0
    ? undefined
    : values.reduce((high, value) => (value > high ? value : high));
}

/** The labels an edit names itself: the rows of a density, a purge or an owner change. */
function namedLabels(edit: VersionEdit): readonly bigint[] {
  switch (edit.kind) {
    case 'density':
      return [...edit.replacements.map((r) => r.label), ...edit.removed];
    case 'purge':
      return edit.rows.map((row) => row.label);
    case 'owner':
      return edit.changes.map((change) => change.label);
    default:
      return [];
  }
}

function ascending(labels: Iterable<bigint>): bigint[] {
  return [...new Set(labels)].sort((left, right) => {
    if (left === right) return 0;
    return left < right ? -1 : 1;
  });
}

export function deltaOf(
  group: CommittedGroup,
  edits: readonly VersionEdit[],
): GroupDelta {
  const resync = edits.some(
    (edit) =>
      edit.kind === 'clear' ||
      edit.kind === 'replace' ||
      edit.kind === 'restore',
  );
  const cuts = edits.flatMap((edit) =>
    edit.kind === 'pop' ? [edit.cutLabel] : [],
  );
  const retains = edits.flatMap((edit) =>
    edit.kind === 'compress' ? [edit.retainFromLabel] : [],
  );
  const rowsBefore = group.before?.rows ?? 0;
  const streamedAppend = group.streamedAppend === true;
  return {
    identity: identityOf(group.after),
    before: group.before,
    after: group.after,
    access: group.read.access,
    resync,
    popFrom: lowest(cuts),
    trimBelow: highest(retains),
    touched: ascending([...group.writtenLabels, ...edits.flatMap(namedLabels)]),
    appendedFrom: streamedAppend ? rowsBefore : undefined,
  };
}
