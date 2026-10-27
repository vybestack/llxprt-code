/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { INHERIT_OWNER, type VersionEdit } from '../../journal/groupEdits.js';
import type { MirrorCheckpoint } from '../../journal/mirrorCheckpoint.js';
import { mapRowStream } from '../../journal/mapped-row-stream.js';
import type { GroupPreparation } from '../../journal/preparedGroup.js';

import type { RowDraft } from '../../journal/rowDraft.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { IContent } from './IContent.js';
import type {
  HistoryCompensationMark,
  HistoryMutationMark,
  HistoryPublicationScope,
} from './historyStorePort.js';
import {
  labelsAt,
  type PositionedOrigin,
  type PositionedOwner,
} from './journalHistoryEdits.js';
import type { JournalHistoryStore } from './journalHistoryStore.js';
import type { JournalOwners, ResolvedOwner } from './journalOwners.js';
import { encodeContentRow } from './journalRowCodec.js';

export function replacementEditBuilder(
  owners: () => JournalOwners,
): (
  rows: Iterable<IContent> | AsyncIterable<IContent>,
  origin: string | undefined,
) => EditBuilder {
  return (rows, origin) => replacementEdits(owners(), rows, origin);
}
export function preparedDetachedEdit(
  prepare: GroupPreparation,
  ownerEdits: readonly VersionEdit[],
  appendOnly: boolean,
): VersionEdit {
  return {
    kind: 'prepared',
    prepare,
    admission: [
      ...ownerEdits,
      { kind: appendOnly ? 'append' : 'replace', rows: [] },
    ],
  };
}

/** Builds the edits of one queued operation against the version the previous operation published. */
export type EditBuilder = (snapshot: VersionSnapshot) => Promise<VersionEdit[]>;

/** What a compensation puts back: the version the queue had reached when the mark was captured. */
export interface JournalCheckpointVersions {
  readonly snapshot: VersionSnapshot;
  readonly mirrors: MirrorCheckpoint;
}

export class JournalCompensationMark implements HistoryCompensationMark {
  constructor(
    readonly store: JournalHistoryStore,
    readonly captured: Promise<JournalCheckpointVersions>,
    readonly mutationSequence: number,
  ) {}

  get saved(): Promise<VersionSnapshot> {
    return this.captured.then(({ snapshot }) => snapshot);
  }
}

/**
 * The publication bookkeeping of one store: how many groups it has accepted
 * (the position a mutation mark names) and how many publication scopes are
 * open. Mirrors follow every acked group, and a compensation is a `restore`
 * group they follow like any other (design 5.2), so a scope holds nothing
 * back; it only counts.
 */
export class JournalPublication {
  private readonly compensation = new Set<JournalCompensationMark>();

  capture(
    store: JournalHistoryStore,
    saved: Promise<JournalCheckpointVersions>,
  ): JournalCompensationMark {
    const mark = new JournalCompensationMark(store, saved, this.current);
    this.compensation.add(mark);
    return mark;
  }

  async release(mark: JournalCompensationMark): Promise<void> {
    if (!this.compensation.delete(mark)) return;
    const saved = await mark.captured;
    const results = await Promise.allSettled([
      saved.snapshot.close(),
      saved.mirrors.close(),
    ]);
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(
        failures,
        'Compensation checkpoint cleanup failed',
      );
  }

  async close(): Promise<void> {
    for (const mark of this.compensation) await this.release(mark);
  }

  private depth = 0;
  /** Groups accepted so far, acked or not. */
  private admitted = 0;
  private current = 0;

  accepted(): void {
    this.current = ++this.admitted;
  }

  compensated(mark: JournalCompensationMark): void {
    this.current = mark.mutationSequence;
  }

  open(): HistoryPublicationScope {
    this.depth++;
    let closed = false;
    return {
      close: () => {
        if (closed) return;
        closed = true;
        this.depth--;
      },
    };
  }

  /** Names the position after the last group accepted; a later group makes the mark stale. */
  mark(binding: JournalHistoryStore): HistoryMutationMark {
    return { binding, lastSeq: this.current };
  }

  isCurrent(binding: JournalHistoryStore, mark: HistoryMutationMark): boolean {
    return mark.binding === binding && mark.lastSeq === this.current;
  }
}

/** The drafts of `rows`, each encoded when the writer asks for it. The stream never checks a signal: a group that stops after its first byte poisons the writer, so a cancellation is acted on before the group and after its ack. */
export function encodedRows(
  rows: Iterable<IContent> | AsyncIterable<IContent>,
  owner: number,
): AsyncGenerator<RowDraft> {
  return mapRowStream(rows, (content) => encodeContentRow(content, { owner }));
}

/** The edit that gives the rows at `sorted[].position` the numeric owners named (no row is rewritten, design 5.4). */
export function ownerChangeEdits(
  sorted: readonly PositionedOwner[],
): EditBuilder {
  return async (snapshot) => {
    const labels = await labelsAt(
      snapshot,
      sorted.map(({ position }) => position),
    );
    return [
      {
        kind: 'owner',
        changes: labels.map((label, at) => ({
          label,
          owner: sorted[at].owner,
        })),
      },
    ];
  };
}

/** Like {@link ownerChangeEdits}, naming origins; an unknown origin gets the next id, recorded in the same group. */
export function originChangeEdits(
  sorted: readonly PositionedOrigin[],
  owners: () => JournalOwners,
): EditBuilder {
  return async (snapshot) => {
    const labels = await labelsAt(
      snapshot,
      sorted.map(({ position }) => position),
    );
    const edits: VersionEdit[] = [];
    const owned: Array<{ label: bigint; owner: number }> = [];
    for (const [at, label] of labels.entries()) {
      const resolved = await owners().resolve(sorted[at].origin);
      edits.push(...resolved.edits);
      owned.push({ label, owner: resolved.id });
    }
    return [...edits, { kind: 'owner', changes: owned }];
  };
}

/**
 * The edit that inserts `draft` after the row whose chronology number is
 * `afterSeq`. The row takes the owner of `origin`, else the owner of the row
 * it follows (design 5.1). `owners` is read when the group is built, because a
 * resume can replace the store's owners while the operation waits.
 */
export function syntheticInsertEdits(
  draft: RowDraft,
  afterSeq: number,
  origin: string | undefined,
  owners: () => JournalOwners,
): EditBuilder {
  return async (snapshot) => {
    const anchor = BigInt(afterSeq);
    for await (const entry of snapshot.entries()) {
      if (entry.chronologySeq !== anchor) continue;
      const owner: {
        readonly id: number | typeof INHERIT_OWNER;
        readonly edits: ResolvedOwner['edits'];
      } =
        origin === undefined
          ? { id: INHERIT_OWNER, edits: [] }
          : await owners().resolve(origin);
      return [
        ...owner.edits,
        {
          kind: 'insert',
          afterLabel: entry.label,
          draft: { ...draft, owner: owner.id },
        },
      ];
    }
    throw new Error(
      `Synthetic insert anchor: no row has chronology number ${afterSeq}`,
    );
  };
}

export function replacementEdits(
  owners: JournalOwners,
  rows: Iterable<IContent> | AsyncIterable<IContent>,
  origin: string | undefined,
): EditBuilder {
  return async () => {
    const owner = await owners.resolve(origin);
    return [
      ...owner.edits,
      { kind: 'replace', rows: encodedRows(rows, owner.id) },
    ];
  };
}
