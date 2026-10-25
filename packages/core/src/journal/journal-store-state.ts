/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';
import type { CommitAck } from './groupWriter.js';
import type { PinnedRead } from './pinLease.js';
import { genesisVersion, type Version } from './version.js';
import { FIRST_NEXT_LABEL } from './labels.js';
import type { VersionEdit } from './groupEdits.js';
import type { RightSpine } from './rowTreeBuilder.js';
import type { GroupPlan } from './groupPlanTypes.js';

export function unchangedGroup(
  read: PinnedRead,
  before: Version | undefined,
): CommittedGroup {
  const after = before ?? genesisVersion(FIRST_NEXT_LABEL);
  return {
    ack: {
      commitSeq: after.commitSeq,
      durableEnd: after.durableEnd,
      groupTag: after.groupTag,
    },
    before,
    after,
    read,
    writtenLabels: [],
    unchanged: true,
    close: () => read.close(),
  };
}

export function assertCompactionUsable(
  failure: { readonly error: unknown } | undefined,
): void {
  if (failure !== undefined)
    throw new JournalFormatError(
      'An earlier compaction of this journal failed',
      { cause: failure.error },
    );
}

export function noop(): void {
  // Settles the tail of the commit queue; the caller sees the commit's own outcome.
}

/**
 * A group that was acked, with what a reader of the group needs (design 5.2):
 * the version before and after it, reads bound to the version after, which
 * reach the version before too, and the labels of the rows whose records the
 * group wrote. The reads hold a pin from the moment the group is acked, so a
 * compaction cannot move the group's records before its reader is done;
 * `close` releases it (and `commit` closes it at once).
 */
export interface CommittedGroup {
  readonly ack: CommitAck;
  readonly before: Version | undefined;
  readonly after: Version;
  readonly read: PinnedRead;
  readonly writtenLabels: readonly bigint[];
  readonly resolvedEdits?: readonly VersionEdit[];
  readonly streamedAppend?: boolean;
  readonly unchanged?: boolean;
  close(): void | Promise<void>;
}

/** Labels written by an indexed group; streamed groups return none. */
export function writtenLabelsOf(plan: GroupPlan): bigint[] {
  if (plan.segments === undefined) return plan.newRows.map((row) => row.label);
  const labels: bigint[] = [];
  for (const segment of plan.segments) {
    if (segment.kind === 'fresh') labels.push(segment.label);
    if (segment.kind === 'foreign') labels.push(segment.row.entry.label);
  }
  return labels;
}

export interface SpineEntry {
  readonly rowRoot: number;
  readonly spine: RightSpine;
}
