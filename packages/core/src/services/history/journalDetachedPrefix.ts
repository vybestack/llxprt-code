/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { bytesEqual } from '../../journal/bytes.js';
import type { RowDraft } from '../../journal/rowDraft.js';
import type { StoredRow } from '../../journal/rowReads.js';

/**
 * The draft that writes `stored` again under a new label: the same fields,
 * ids and bytes, with no content decoded. This is how the unchanged head of a
 * detached result is carried into a `replace` group.
 */
export function draftOfStoredRow(stored: StoredRow): RowDraft {
  const { header } = stored;
  return {
    owner: header.owner,
    speaker: header.speaker,
    flags: header.flags,
    chronologySeq: header.chronologySeq,
    chronologyUserTurn: header.chronologyUserTurn,
    chronologyStep: header.chronologyStep,
    chronologyRecordedAt: header.chronologyRecordedAt,
    parentEndpoint: header.parentEndpoint,
    ids: header.ids.map((tuple, index) => ({
      rawId: stored.rawIds[index],
      kind: tuple.kind,
      block: tuple.block,
      score: tuple.score,
      nameLen: tuple.nameLen,
    })),
    meta: stored.meta,
    blocks: stored.blocks.map((bytes, index) => ({
      type: header.blocks[index].type,
      bytes,
    })),
  };
}

const SCALAR_FIELDS = [
  'owner',
  'speaker',
  'flags',
  'chronologySeq',
  'chronologyUserTurn',
  'chronologyStep',
  'chronologyRecordedAt',
  'parentEndpoint',
] as const satisfies ReadonlyArray<keyof RowDraft & keyof StoredRow['header']>;

/** True when writing `draft` would store exactly the bytes and fields of `stored`. */
export function draftEqualsStored(draft: RowDraft, stored: StoredRow): boolean {
  const { header } = stored;
  return (
    SCALAR_FIELDS.every((field) => draft[field] === header[field]) &&
    idsEqual(draft, stored) &&
    bytesEqual(draft.meta, stored.meta) &&
    blocksEqual(draft, stored)
  );
}

function blocksEqual(draft: RowDraft, stored: StoredRow): boolean {
  const { blocks } = stored.header;
  return (
    draft.blocks.length === stored.blocks.length &&
    draft.blocks.every(
      (block, index) =>
        block.type === blocks[index].type &&
        bytesEqual(block.bytes, stored.blocks[index]),
    )
  );
}

function idsEqual(draft: RowDraft, stored: StoredRow): boolean {
  const { ids } = stored.header;
  return (
    draft.ids.length === ids.length &&
    draft.ids.every((id, index) =>
      idEqual(id, ids[index], stored.rawIds[index]),
    )
  );
}

const ID_TUPLE_FIELDS = ['kind', 'block', 'score', 'nameLen'] as const;

function idEqual(
  id: RowDraft['ids'][number],
  tuple: StoredRow['header']['ids'][number],
  rawId: string,
): boolean {
  return (
    id.rawId === rawId &&
    ID_TUPLE_FIELDS.every((field) => id[field] === tuple[field])
  );
}
