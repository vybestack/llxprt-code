/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { releaseRead } from '../../journal/pinLease.js';
import type { HistoryMediaOwner } from './historyBatchContracts.js';
import {
  historyMutationFailure,
  rollbackMutationEffects,
} from './historyMutationEffects.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import {
  invalidateResponsesStatefulChain,
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
import {
  mediaOriginFor,
  normalizeBase64Source,
} from '../../storage/media-admission-service.js';
import { ROW_FLAG, ROW_SPEAKER } from '../../journal/rowRecord.js';
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
 * it was and when its bytes were dropped. A referenced block must carry the
 * origin admission stamped; base64 bytes still inline in `row` get the origin
 * admission would have stamped. Anything else is a caller bug.
 */
export function droppedBlockOf(
  block: ContentBlock,
  droppedAt: string,
  row: IContent,
): MediaDroppedBlock {
  if (block.type === 'media' && block.encoding === 'base64') {
    const source = normalizeBase64Source(block.data);
    return {
      type: 'media_dropped',
      origin: mediaOriginFor(block, row, droppedAt),
      mimeType: block.mimeType,
      byteLength: source.decodedByteLength,
      contentId: source.contentId,
      droppedAt,
    };
  }
  if (!isMediaReferenceBlock(block))
    throw new Error('Only stored media bytes can be dropped');
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
      blocks.has(index) ? droppedBlockOf(block, droppedAt, row) : block,
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
 * Stored Responses parents at or after the first dropped row hold the image
 * bytes server-side; they lose `responsesStored` so the next Responses request
 * resends history from there without the bytes. Only row headers are walked;
 * a row is read only when it is a parent.
 */
async function staleResponseParents(
  saved: VersionSnapshot,
  first: number,
  dropped: ReadonlyMap<number, ReadonlySet<number>>,
  resumeBoundary: bigint | undefined,
): Promise<PositionedContent[]> {
  const stale: PositionedContent[] = [];
  let position = first;
  for await (const entry of saved.entries(first)) {
    const at = position++;
    if (
      dropped.has(at) ||
      entry.speaker !== ROW_SPEAKER.ai ||
      ((entry.flags & ROW_FLAG.responseParent) === 0 &&
        decodeStoredRow(await saved.readMetadata(entry), resumeBoundary)
          .metadata?.responsesStored !== true)
    )
      continue;
    const row = decodeStoredRow(await saved.readRow(entry), resumeBoundary);
    if (row.metadata?.responsesStored === true)
      stale.push({
        position: at,
        content: invalidateResponsesStatefulChain([row])[0],
      });
  }
  return stale;
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
        content: invalidateResponsesStatefulChain([
          droppedRow(row, blocks, request.droppedAt),
        ])[0],
      });
    }
    changes.push(
      ...(await staleResponseParents(
        saved,
        Math.min(...positions.keys()),
        positions,
        store.resumeBoundary,
      )),
    );
    changes.sort((left, right) => left.position - right.position);
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
