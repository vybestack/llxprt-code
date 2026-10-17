/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionEdit } from '../../journal/groupEdits.js';
import type { RowDraft } from '../../journal/rowDraft.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { IContent } from './IContent.js';
import type {
  HistoryMutationMark,
  HistoryPublicationScope,
} from './historyStorePort.js';
import {
  labelsAt,
  type PositionedOrigin,
  type PositionedOwner,
} from './journalHistoryEdits.js';
import type { JournalHistoryStore } from './journalHistoryStore.js';
import type { JournalOwners } from './journalOwners.js';
import { encodeContentRow } from './journalRowCodec.js';

/** Builds the edits of one queued operation against the version the previous operation published. */
export type EditBuilder = (snapshot: VersionSnapshot) => Promise<VersionEdit[]>;

/** What a compensation puts back: the version the queue had reached when the mark was captured. */
export interface JournalCompensationMark {
  readonly store: JournalHistoryStore;
  readonly saved: Promise<VersionSnapshot>;
}

/**
 * The publication bookkeeping of one store: how many groups it has accepted
 * (the position a mutation mark names) and how many publication scopes are
 * open. Mirrors follow every acked group, and a compensation is a `restore`
 * group they follow like any other (design 5.2), so a scope holds nothing
 * back; it only counts.
 */
export class JournalPublication {
  private depth = 0;
  /** Groups accepted so far, acked or not. */
  private admitted = 0;

  accepted(): void {
    this.admitted++;
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
    return { binding, lastSeq: this.admitted };
  }

  isCurrent(binding: JournalHistoryStore, mark: HistoryMutationMark): boolean {
    return mark.binding === binding && mark.lastSeq === this.admitted;
  }
}

/** The drafts of `rows`, each encoded when the writer asks for it. The stream never checks a signal: a group that stops after its first byte poisons the writer, so a cancellation is acted on before the group and after its ack. */
export async function* encodedRows(
  rows: Iterable<IContent> | AsyncIterable<IContent>,
  owner: number,
): AsyncGenerator<RowDraft> {
  for await (const content of rows) {
    yield encodeContentRow(content, { owner });
  }
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
  owners: JournalOwners,
): EditBuilder {
  return async (snapshot) => {
    const labels = await labelsAt(
      snapshot,
      sorted.map(({ position }) => position),
    );
    const edits: VersionEdit[] = [];
    const owned: Array<{ label: bigint; owner: number }> = [];
    for (const [at, label] of labels.entries()) {
      const resolved = await owners.resolve(sorted[at].origin);
      edits.push(...resolved.edits);
      owned.push({ label, owner: resolved.id });
    }
    return [...edits, { kind: 'owner', changes: owned }];
  };
}
