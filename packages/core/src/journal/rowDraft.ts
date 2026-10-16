/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { frameLength } from './frame.js';
import type { FrameBody } from './frame.js';
import type { GroupRecord } from './groupAppender.js';
import { RECORD_KIND } from './recordKinds.js';
import { SLOT_SUMMARY_BYTES } from './slotSummary.js';
import type { RowEntry } from './rowEntry.js';
import {
  encodeIdPiece,
  encodeRowHeader,
  hashId,
  type RowBlockEntry,
  type RowHeader,
  type RowIdTuple,
} from './rowRecord.js';

/** One tool call or response id of a row, with the raw string a rebuild needs. */
export interface DraftId {
  readonly rawId: string;
  readonly kind: number;
  readonly block: number;
  readonly score: number;
  readonly nameLen: number;
}

export interface DraftBlock {
  readonly type: number;
  readonly bytes: Uint8Array;
}

/**
 * A row as the caller hands it over, before the store gives it a label. The
 * owner is a required field (design 5.1): unowned is spelled `owner: 0`.
 */
export interface RowDraft {
  readonly owner: number;
  readonly speaker: number;
  readonly flags: number;
  readonly chronologySeq: bigint;
  readonly chronologyUserTurn: number;
  readonly chronologyStep: number;
  readonly chronologyRecordedAt: number;
  readonly parentEndpoint: bigint;
  readonly ids: readonly DraftId[];
  /** The metadata piece of the body. */
  readonly meta: Uint8Array;
  readonly blocks: readonly DraftBlock[];
}

export interface EncodedRow {
  readonly header: RowHeader;
  readonly record: GroupRecord;
  readonly recordLength: number;
}

function blockDirectory(
  start: number,
  blocks: readonly DraftBlock[],
): RowBlockEntry[] {
  let offset = start;
  return blocks.map((block) => {
    const entry = { offset, length: block.bytes.length, type: block.type };
    offset += block.bytes.length;
    return entry;
  });
}

function tupleOf(id: DraftId): RowIdTuple {
  return {
    idHash: hashId(id.rawId),
    kind: id.kind,
    block: id.block,
    score: id.score,
    nameLen: id.nameLen,
  };
}

/** The `ROW` record of a draft at `label`: the id piece, the metadata piece, then the blocks (design 2.4). */
export function encodeRowDraft(label: bigint, draft: RowDraft): EncodedRow {
  const idPiece = encodeIdPiece(draft.ids.map((id) => id.rawId));
  const header: RowHeader = {
    label,
    owner: draft.owner,
    speaker: draft.speaker,
    flags: draft.flags,
    idsLen: idPiece.length,
    metaLen: draft.meta.length,
    chronologySeq: draft.chronologySeq,
    chronologyUserTurn: draft.chronologyUserTurn,
    chronologyStep: draft.chronologyStep,
    chronologyRecordedAt: draft.chronologyRecordedAt,
    parentEndpoint: draft.parentEndpoint,
    blocks: blockDirectory(idPiece.length + draft.meta.length, draft.blocks),
    ids: draft.ids.map(tupleOf),
  };
  const chunks = [idPiece, draft.meta, ...draft.blocks.map((b) => b.bytes)];
  const body: FrameBody = {
    length: chunks.reduce((total, chunk) => total + chunk.length, 0),
    chunks,
  };
  const kindHeader = encodeRowHeader(header);
  return {
    header,
    record: { kind: RECORD_KIND.ROW, kindHeader, body },
    recordLength: frameLength(kindHeader.length, body.length),
  };
}

const EMPTY_SUMMARY = new Uint8Array(SLOT_SUMMARY_BYTES);
const UNSTAMPED = { gen: 0, imageGen: 0 };

/**
 * The entry of a row that was just written at `recordOffset`. Everything that
 * is derived from other rows or from a format slot starts at zero: the
 * summaries and token counts are filled when a slot is active (design 8.2),
 * and the call counts and the answered count come with the normalizer.
 */
export function entryForNewRow(
  encoded: EncodedRow,
  recordOffset: number,
): RowEntry {
  const { header } = encoded;
  return {
    label: header.label,
    recordOffset,
    recordLength: encoded.recordLength,
    speaker: header.speaker,
    flags: header.flags,
    reconBlocks: 0,
    answered: 0,
    chronologySeq: header.chronologySeq,
    chronologyUserTurn: header.chronologyUserTurn,
    chronologyStep: header.chronologyStep,
    chronologyRecordedAt: header.chronologyRecordedAt,
    owner: header.owner,
    callBlocks: 0,
    unmappedBlocks: 0,
    lensRef: [0, 0, 0],
    summary: [EMPTY_SUMMARY, EMPTY_SUMMARY, EMPTY_SUMMARY],
    media: { mediaChars: 0, imageChars: [0, 0, 0], pdfBytes: [0, 0, 0] },
    tokens: [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    stamp: [UNSTAMPED, UNSTAMPED, UNSTAMPED],
  };
}
