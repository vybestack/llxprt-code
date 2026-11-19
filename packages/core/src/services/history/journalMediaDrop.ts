/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { releaseRead } from '../../journal/pinLease.js';
import type { HistoryMediaOwner } from './historyBatchContracts.js';
import {
  historyMutationFailure,
  rollbackMutationEffects,
} from './historyMutationEffects.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import {
  isMediaReferenceBlock,
  type ContentBlock,
  type IContent,
  type MediaDroppedBlock,
  type MediaReferenceBlock,
} from './IContent.js';
import type { PositionedContent } from './journalHistoryEdits.js';
import type { JournalHistoryStore } from './journalHistoryStore.js';
import {
  prepareMediaReplacement,
  snapshotReferences,
} from './journalMediaReferences.js';
import { decodeStoredRow } from './journalRowCodec.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';

/**
 * One stored media block whose bytes are dropped: the row by its position or
 * by its journal label (stable across in-place edits), and the block index.
 */
export type HistoryMediaDrop =
  | { readonly position: number; readonly blockIndex: number }
  | { readonly label: bigint; readonly blockIndex: number };

export interface HistoryDropMediaRequest {
  readonly drops: readonly HistoryMediaDrop[];
  /** ISO time recorded on every dropped block. */
  readonly droppedAt: string;
  readonly owner?: HistoryMediaOwner;
  readonly ownership?: RowOwnership;
}

/**
 * The reference that replaces a stored image: where it was read from, what
 * it was and when its bytes were dropped. Only a referenced block with an
 * origin can be dropped; anything else is a caller bug.
 */
export function droppedBlockOf(
  block: ContentBlock,
  droppedAt: string,
): MediaDroppedBlock {
  if (!isMediaReferenceBlock(block))
    throw new Error('Only a stored media reference can be dropped');
  const origin = block.origin;
  if (origin === undefined)
    throw new Error(
      `Stored media ${block.contentId} has no origin to keep as a reference`,
    );
  return {
    type: 'media_dropped',
    origin,
    mimeType: block.mimeType,
    byteLength: block.byteLength,
    contentId: block.contentId,
    droppedAt,
  };
}

async function positionOf(
  saved: VersionSnapshot,
  drop: HistoryMediaDrop,
): Promise<number> {
  if ('position' in drop) return drop.position;
  const position = await saved.rowsBelow(drop.label);
  if (
    position >= saved.rows ||
    (await saved.entryAt(position)).label !== drop.label
  )
    throw new Error(
      `History has no row labelled ${drop.label} to drop media from`,
    );
  return position;
}

async function byPosition(
  saved: VersionSnapshot,
  drops: readonly HistoryMediaDrop[],
): Promise<ReadonlyMap<number, ReadonlySet<number>>> {
  const positions = new Map<number, Set<number>>();
  for (const drop of drops) {
    const position = await positionOf(saved, drop);
    const blocks = positions.get(position) ?? new Set<number>();
    blocks.add(drop.blockIndex);
    positions.set(position, blocks);
  }
  return positions;
}

function droppedRow(
  row: IContent,
  blocks: ReadonlySet<number>,
  droppedAt: string,
): IContent {
  for (const index of blocks)
    if (index < 0 || index >= row.blocks.length)
      throw new Error(`Row has no block ${index} to drop`);
  return {
    ...row,
    blocks: row.blocks.map((block, index) =>
      blocks.has(index) ? droppedBlockOf(block, droppedAt) : block,
    ),
  };
}

async function* currentReferences(
  store: JournalHistoryStore,
): AsyncGenerator<MediaReferenceBlock, void, unknown> {
  const snapshot = await store.settledSnapshot(() => Promise.resolve());
  let failure: { readonly error: unknown } | undefined;
  try {
    yield* snapshotReferences(snapshot);
  } catch (error) {
    failure = { error };
    throw error;
  } finally {
    await releaseRead(snapshot, failure);
  }
}

/** Makes `owner` hold exactly the media the current rows reference. */
async function followRows(
  store: JournalHistoryStore,
  owner: HistoryMediaOwner,
  ownership: RowOwnership | undefined,
): Promise<void> {
  const effect = await prepareMediaReplacement(
    owner,
    currentReferences(store),
    ownership,
  );
  try {
    await effect.publish();
  } catch (error) {
    throw historyMutationFailure(
      error,
      await rollbackMutationEffects([effect]),
    );
  }
  await effect.finalize?.();
}

/**
 * Replaces the named media blocks of stored rows with `media_dropped`
 * references in one in-place purge group (design 4.6): only the affected
 * rows are read and rewritten, under their own labels and owners. The owner
 * then holds exactly the media the rows still reference, so a blob no row
 * references any more loses its reservation and one another row still
 * references keeps it. A failure restores the version the drop started from.
 */
export async function dropMediaOnJournal(
  store: JournalHistoryStore,
  request: HistoryDropMediaRequest,
): Promise<number> {
  if (request.drops.length === 0) return 0;
  await store.waitForDurable();
  const mark = store.captureCompensation();
  try {
    const saved = await mark.saved;
    if (saved.rows !== store.getLength())
      throw new Error('History changed while its media was being dropped');
    const positions = await byPosition(saved, request.drops);
    const changes: PositionedContent[] = [];
    for (const [position, blocks] of positions) {
      if (!Number.isSafeInteger(position) || position >= saved.rows)
        throw new Error(`History has no row ${position} to drop media from`);
      const entry = await saved.entryAt(position);
      const row = decodeStoredRow(
        await saved.readRow(entry),
        store.resumeBoundary,
      );
      changes.push({
        position,
        content: droppedRow(row, blocks, request.droppedAt),
      });
    }
    try {
      store.purge(changes);
      await store.waitForDurable();
      if (request.owner !== undefined)
        await followRows(store, request.owner, request.ownership);
    } catch (error) {
      const failures: unknown[] = [];
      try {
        await store.compensate(mark, error);
      } catch (failure) {
        failures.push(failure);
      }
      throw historyMutationFailure(error, failures);
    }
    return request.drops.length;
  } finally {
    await store.releaseCompensation(mark);
    await store.settleFanout();
  }
}
