/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { SourceRow, VersionEdit } from './groupEdits.js';
import type { GroupDelta } from './groupDelta.js';
import type { PinnedRead } from './pinLease.js';
import type { RecordAccess } from './recordAccess.js';
import { rootRef } from './groupSegments.js';
import type { JournalStore } from './journalStore.js';
import { acceptedRows } from './mirrorSeed.js';
import { accepts } from './ownerRules.js';
import type { RowEntry } from './rowEntry.js';
import { countRowsBelow } from './rowTreeQueries.js';
import { entriesByLabels } from './row-label-queries.js';
import { entryAt, iterateRowEntries } from './rowTreeReader.js';
import type { Version } from './version.js';

/** The mirror a delta is applied to: its file and the agent whose rows it holds. */
export interface MirrorTarget {
  readonly store: JournalStore;
  readonly owner: number;
  readonly metadataKeys?: readonly string[];
}

/** A primary version with the reads that reach its records. */
export interface PinnedVersion {
  readonly version: Version;
  readonly access: RecordAccess;
}

/**
 * The edits that make a mirror equal to the primary version `pin` (a clear, a
 * replace or a restore, a late attach, a resync): its history is replaced by
 * the rows the mirror accepts. No pin is a primary with no group, which has
 * no row.
 */
export function resyncEdits(
  target: MirrorTarget,
  pin: PinnedVersion | undefined,
): VersionEdit[] {
  if (pin === undefined) return [{ kind: 'clear' }];
  if (target.metadataKeys === undefined || target.metadataKeys.length === 0)
    return [
      {
        kind: 'adoptAll',
        rows: acceptedRows(pin.access, pin.version, target.owner),
        nextLabel: pin.version.nextLabel,
      },
    ];
  const keys = target.metadataKeys;
  return [
    {
      kind: 'prepared',
      admission: [],
      prepare: async (group) => {
        await group.build([
          {
            kind: 'adoptAll',
            rows: acceptedRows(pin.access, pin.version, target.owner),
            nextLabel: pin.version.nextLabel,
          },
        ]);
        await group.copyMetadata(pin.access, pin.version.roots.metaRoot, keys);
      },
    },
  ];
}

/** What the mirror holds now, read once: its tree, its size and its last label. */
interface MirrorState {
  readonly rows: number;
  readonly lastLabel: bigint | undefined;
  readonly countBelow: (label: bigint) => Promise<number>;
}

async function stateOf(read: PinnedRead): Promise<MirrorState> {
  const { version } = read;
  const root = version === undefined ? undefined : rootRef(version);
  if (version === undefined || root === undefined) {
    return {
      rows: 0,
      lastLabel: undefined,
      countBelow: () => Promise.resolve(0),
    };
  }
  const { access } = read;
  return {
    rows: version.rows,
    lastLabel: (await entryAt(access, root, version.rows - 1)).label,
    countBelow: (label) => countRowsBelow(access, root, label),
  };
}

/**
 * The cuts of the delta as edits for the mirror, with the count of rows each
 * takes out, which the edits check. A pop is applied first, then the head
 * trim counts what is left below its label.
 */
async function cutEdits(
  delta: GroupDelta,
  mirror: MirrorState,
): Promise<VersionEdit[]> {
  const edits: VersionEdit[] = [];
  const { popFrom, trimBelow } = delta;
  if (popFrom !== undefined) {
    const expectedRemoved = mirror.rows - (await mirror.countBelow(popFrom));
    if (expectedRemoved > 0) {
      edits.push({ kind: 'pop', cutLabel: popFrom, expectedRemoved });
    }
  }
  if (trimBelow !== undefined) {
    const limit =
      popFrom === undefined || trimBelow < popFrom ? trimBelow : popFrom;
    const expectedRemoved = await mirror.countBelow(limit);
    if (expectedRemoved > 0) {
      edits.push({ kind: 'trimHead', belowLabel: trimBelow, expectedRemoved });
    }
  }
  return edits;
}

/** What one label needs from the mirror: nothing, a removal, a copy, or both for a row that was rewritten. */
interface LabelChange {
  readonly drop: boolean;
  readonly copy: RowEntry | undefined;
}

function isCut(delta: GroupDelta, label: bigint): boolean {
  const popped = delta.popFrom !== undefined && label >= delta.popFrom;
  const trimmed = delta.trimBelow !== undefined && label < delta.trimBelow;
  return popped || trimmed;
}

/**
 * Compares one label in the version before the group and the version after
 * it, for the owner `owner` (design 5.2). The mirror held the row before when
 * the owner then accepted it and no cut took it; it should hold it after when
 * the owner now accepts it. A row that is held both times is replaced only
 * when its record is a different one: an owner change between two owners the
 * mirror accepts does not touch it.
 */
function changeFor(
  delta: GroupDelta,
  owner: number,
  label: bigint,
  was: RowEntry | undefined,
  now: RowEntry | undefined,
): LabelChange {
  const held =
    was !== undefined && accepts(owner, was.owner) && !isCut(delta, label);
  const wanted = now !== undefined && accepts(owner, now.owner);
  const rewritten = held && wanted && was.recordOffset !== now.recordOffset;
  return {
    drop: held && (!wanted || rewritten),
    copy: wanted && (!held || rewritten) ? now : undefined,
  };
}

interface LabelChanges {
  readonly dropped: bigint[];
  readonly copied: SourceRow[];
}

async function labelChanges(
  delta: GroupDelta,
  owner: number,
): Promise<LabelChanges> {
  const beforeRoot =
    delta.before === undefined ? undefined : rootRef(delta.before);
  const afterRoot = rootRef(delta.after);
  const dropped: bigint[] = [];
  const copied: SourceRow[] = [];
  const before = entriesByLabels(delta.access, beforeRoot, delta.touched);
  const after = entriesByLabels(delta.access, afterRoot, delta.touched);
  try {
    for (const label of delta.touched) {
      const was = await before.next();
      const now = await after.next();
      const change = changeFor(delta, owner, label, was.value, now.value);
      if (change.drop) dropped.push(label);
      if (change.copy !== undefined) {
        copied.push({ source: delta.access, entry: change.copy });
      }
    }
  } finally {
    await before.return(undefined);
    await after.return(undefined);
  }
  return { dropped, copied };
}

/**
 * The edits that bring the mirror from the primary version before the group to
 * the version after it (design 5.2), or none when the group changes nothing
 * the mirror holds. Every label the delta names is compared in both versions,
 * so one rule covers append, pop, compress, replace, density, purge, insert and
 * owner change, whatever the group combined. The cost is the labels of the
 * group and not the history.
 */
export async function mirrorEdits(
  delta: GroupDelta,
  target: MirrorTarget,
): Promise<VersionEdit[]> {
  const read = await target.store.openRead();
  try {
    const edits = await editsFor(delta, target, await stateOf(read));
    const metadataChanged =
      (target.metadataKeys?.length ?? 0) > 0 &&
      (delta.before?.roots.metaRoot ?? 0) !== delta.after.roots.metaRoot;
    if (!metadataChanged || edits.some((edit) => edit.kind === 'prepared'))
      return edits;
    return [
      {
        kind: 'prepared',
        admission: [],
        prepare: async (group) => {
          if (edits.length > 0) await group.build(edits);
          await group.copyMetadata(
            delta.access,
            delta.after.roots.metaRoot,
            target.metadataKeys ?? [],
          );
        },
      },
    ];
  } finally {
    await read.close();
  }
}

async function editsFor(
  delta: GroupDelta,
  target: MirrorTarget,
  mirror: MirrorState,
): Promise<VersionEdit[]> {
  if (delta.resync) {
    if (delta.after.rows === 0 && mirror.rows === 0) return [];
    return resyncEdits(target, { version: delta.after, access: delta.access });
  }
  if (delta.appendedFrom !== undefined) {
    const from = delta.appendedFrom;
    return [
      {
        kind: 'prepared',
        admission: [],
        prepare: async (group) => {
          await group.adopt(
            (async function* (): AsyncGenerator<SourceRow> {
              const root = rootRef(delta.after);
              if (root === undefined)
                throw new Error('Streamed append has no row root');
              for await (const entry of iterateRowEntries(
                delta.access,
                root,
                from,
              )) {
                if (accepts(target.owner, entry.owner))
                  yield { source: delta.access, entry };
              }
            })(),
            delta.after.nextLabel,
          );
          if (
            (delta.before?.roots.metaRoot ?? 0) !== delta.after.roots.metaRoot
          )
            await group.copyMetadata(
              delta.access,
              delta.after.roots.metaRoot,
              target.metadataKeys ?? [],
            );
        },
      },
    ];
  }
  const edits = await cutEdits(delta, mirror);
  const { dropped, copied } = await labelChanges(delta, target.owner);
  if (dropped.length > 0) {
    edits.push({ kind: 'density', replacements: [], removed: dropped });
  }
  if (copied.length > 0) {
    const first = copied[0].entry.label;
    const atEnd = mirror.lastLabel === undefined || first > mirror.lastLabel;
    edits.push({
      kind: 'adopt',
      rows: copied,
      placement: atEnd ? 'end' : 'anywhere',
      nextLabel: delta.after.nextLabel,
    });
  }
  return edits;
}
