/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { rm } from 'node:fs/promises';
import type { SourceRow } from '../../journal/groupEdits.js';
import { sha256KeyHash } from '../../journal/idKeys.js';
import type { JournalStore } from '../../journal/journalStore.js';
import { resolveJournalDependencies } from '../../journal/journalWriterOpen.js';
import { acceptedRows } from '../../journal/mirrorSeed.js';
import { cloneVersion } from '../../journal/versionCopy.js';
import { HistoryAttachmentError } from './attachHistoryJournal.js';
import {
  JournalSession,
  type JournalSessionOptions,
} from './journalSession.js';

const DISPOSED = 'History journal store is disposed';

function requireLive(isCancelled: () => boolean): void {
  if (isCancelled()) throw new Error(DISPOSED);
}

/**
 * Clones the published version of `source` into a new journal file at
 * `targetPath` (design 4.8) and opens it. The clone is a journal of its own: a
 * later write to either file does not reach the other. A journal with no
 * committed group clones into an empty one. A cancellation, before the copy or
 * after it, leaves no file behind.
 */
export async function cloneJournalHistory(
  source: JournalSession,
  targetPath: string,
  options: JournalSessionOptions | undefined,
  isCancelled: () => boolean,
): Promise<JournalSession> {
  requireLive(isCancelled);
  const published = source.store.published;
  try {
    if (published === undefined) {
      return await JournalSession.create(targetPath, options);
    }
    await cloneVersion(source.store.recordAccess(), published, targetPath, {
      journal: await resolveJournalDependencies(options?.journal),
      hasher: sha256KeyHash,
    });
    requireLive(isCancelled);
    return await JournalSession.open(targetPath, options);
  } catch (error) {
    await rm(targetPath, { force: true });
    throw error;
  }
}

export interface JournalAttachmentOptions {
  /** True when the destination's history, if it has any, is to be replaced. */
  readonly replace: boolean;
  /** The mirror owner whose rows are taken (unowned rows included); every row when absent. */
  readonly owner?: number;
  readonly isCancelled: () => boolean;
}

export interface JournalAttachmentCommit {
  readonly committedRows: number;
  readonly destinationRewound: boolean;
}

async function* liveRows(
  source: JournalStore,
  isCancelled: () => boolean,
  owner: number | undefined,
): AsyncGenerator<SourceRow> {
  const version = source.published;
  if (version === undefined) return;
  const access = source.recordAccess();
  const rows =
    owner === undefined
      ? allRows(source, access)
      : acceptedRows(access, version, owner);
  for await (const row of rows) {
    requireLive(isCancelled);
    yield row;
  }
}

async function* allRows(
  source: JournalStore,
  access: ReturnType<JournalStore['recordAccess']>,
): AsyncGenerator<SourceRow> {
  for await (const entry of source.rows()) yield { source: access, entry };
}

/**
 * Makes the history of `destination` the rows of `source` (design 5.3), as one
 * group: a failure or a cancellation before the group is acknowledged leaves
 * the previous history as it was, with the owners the rows carry. A
 * destination that holds history is only touched when `replace` says so.
 */
export async function attachJournalHistory(
  source: JournalStore,
  destination: JournalStore,
  options: JournalAttachmentOptions,
): Promise<JournalAttachmentCommit> {
  try {
    requireLive(options.isCancelled);
    const rewound = (destination.published?.rows ?? 0) > 0;
    if (rewound && !options.replace) {
      throw new Error(
        'The destination holds history; attaching it must replace that history',
      );
    }
    await destination.commit([
      {
        kind: 'adoptAll',
        rows: liveRows(source, options.isCancelled, options.owner),
        nextLabel: source.published?.nextLabel ?? 1n,
      },
    ]);
    return {
      committedRows: destination.published?.rows ?? 0,
      destinationRewound: rewound,
    };
  } catch (cause) {
    throw new HistoryAttachmentError(cause, 0, false);
  }
}
