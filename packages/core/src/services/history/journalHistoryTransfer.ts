/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { rm } from 'node:fs/promises';
import { JournalFormatError } from '../../journal/errors.js';
import type { SourceRow, VersionEdit } from '../../journal/groupEdits.js';
import { sha256KeyHash } from '../../journal/idKeys.js';
import type { JournalStore } from '../../journal/journalStore.js';
import { resolveJournalDependencies } from '../../journal/journalWriterOpen.js';
import { acceptedRows } from '../../journal/mirrorSeed.js';
import { OwnerDictionary } from '../../journal/ownerDictionary.js';
import { UNOWNED } from '../../journal/ownerRules.js';
import type { RecordAccess } from '../../journal/recordAccess.js';
import { cloneVersion } from '../../journal/versionTransfer.js';
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
  const read = await source.store.openRead();
  try {
    if (read.version === undefined) {
      return await JournalSession.create(targetPath, options);
    }
    await cloneVersion(read.access, read.version, targetPath, {
      journal: await resolveJournalDependencies(options?.journal),
      hasher: sha256KeyHash,
    });
    requireLive(isCancelled);
    return await JournalSession.open(targetPath, options);
  } catch (error) {
    await rm(targetPath, { force: true });
    throw error;
  } finally {
    await read.close();
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

/**
 * Source owner ids to destination owner ids (design 5.1). Two journals number
 * their owners independently, so an owner crosses by its origin string. The
 * edits register the origins the destination does not have yet; they go in
 * the group that copies the rows.
 */
interface OwnerMapping {
  readonly edits: readonly VersionEdit[];
  readonly ids: ReadonlyMap<number, number>;
}

/** Maps the origin of `owner`, or every origin of the source when no owner is named. */
async function mapOwners(
  source: JournalStore,
  destination: JournalStore,
  owner: number | undefined,
): Promise<OwnerMapping> {
  const from = await OwnerDictionary.load(source);
  const into = await OwnerDictionary.load(destination);
  const wanted: Array<[number, string]> = [];
  if (owner === undefined) {
    wanted.push(...from.entries());
  } else if (owner !== UNOWNED) {
    const origin = from.originOf(owner);
    if (origin === undefined) {
      throw new JournalFormatError(
        `The source owner dictionary has no owner ${owner}`,
      );
    }
    wanted.push([owner, origin]);
  }
  const edits: VersionEdit[] = [];
  const ids = new Map<number, number>();
  for (const [id, origin] of wanted) {
    const registration = into.prepare(origin);
    into.confirm(registration);
    edits.push(...registration.edits);
    ids.set(id, registration.id);
  }
  return { edits, ids };
}

function ownedByDestination(
  row: SourceRow,
  ids: ReadonlyMap<number, number>,
): SourceRow {
  const { owner } = row.entry;
  if (owner === UNOWNED) return row;
  const mapped = ids.get(owner);
  if (mapped === undefined) {
    throw new JournalFormatError(
      `Row ${row.entry.label} names owner ${owner}, which the source owner dictionary does not have`,
    );
  }
  return { source: row.source, entry: { ...row.entry, owner: mapped } };
}

async function* liveRows(
  source: JournalStore,
  isCancelled: () => boolean,
  owner: number | undefined,
  ids: ReadonlyMap<number, number>,
): AsyncGenerator<SourceRow> {
  const read = await source.openRead();
  try {
    const { version } = read;
    if (version === undefined) return;
    const rows =
      owner === undefined
        ? allRows(source, read.access)
        : acceptedRows(read.access, version, owner);
    for await (const row of rows) {
      requireLive(isCancelled);
      yield ownedByDestination(row, ids);
    }
  } finally {
    await read.close();
  }
}

async function* allRows(
  source: JournalStore,
  access: RecordAccess,
): AsyncGenerator<SourceRow> {
  for await (const entry of source.rows()) yield { source: access, entry };
}

/**
 * Makes the history of `destination` the rows of `source` (design 5.3), as one
 * group: a failure or a cancellation before the group is acknowledged leaves
 * the previous history as it was. Owners cross by their origin strings into the
 * destination's own dictionary. A
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
    const owners = await mapOwners(source, destination, options.owner);
    await destination.commit([
      ...owners.edits,
      {
        kind: 'adoptAll',
        rows: liveRows(source, options.isCancelled, options.owner, owners.ids),
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
