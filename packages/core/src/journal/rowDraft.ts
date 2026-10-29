/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { frameLength } from './frame.js';
import {
  ROW_PIECE_CRC_BYTES,
  rowSourceParts,
  rowPieceParts,
} from './rowPiece.js';
import type { FrameBody } from './frame.js';
import type { GroupRecord } from './groupAppender.js';
import { RECORD_KIND } from './recordKinds.js';
import { SLOT_SUMMARY_BYTES } from './slotSummary.js';
import { ENTRY_FLAG, type RowEntry } from './rowEntry.js';
import {
  encodeIdPiece,
  encodeRowHeader,
  hashId,
  ROW_BLOCK_TYPE,
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
  /** A cold, bounded byte source replaces inline bytes for an expanded prompt. */
  readonly source?: FrameBody;
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
    const length = block.source?.length ?? block.bytes.length;
    const entry = { offset, length, type: block.type };
    offset += length + ROW_PIECE_CRC_BYTES;
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
    blocks: blockDirectory(
      idPiece.length + draft.meta.length + 2 * ROW_PIECE_CRC_BYTES,
      draft.blocks,
    ),
    ids: draft.ids.map(tupleOf),
  };
  const inline = (bytes: Uint8Array): FrameBody => ({
    length: bytes.length,
    chunks: [bytes],
  });
  const sources = [
    inline(idPiece),
    inline(draft.meta),
    ...draft.blocks.map((block) => block.source ?? inline(block.bytes)),
  ];
  const body: FrameBody = {
    length: sources.reduce(
      (total, source) => total + source.length + ROW_PIECE_CRC_BYTES,
      0,
    ),
    chunks: draft.blocks.some((block) => block.source !== undefined)
      ? rowSourceParts(sources)
      : rowPieceParts([
          idPiece,
          draft.meta,
          ...draft.blocks.map((block) => block.bytes),
        ]),
  };
  const kindHeader = encodeRowHeader(header);
  return {
    header,
    record: { kind: RECORD_KIND.ROW, kindHeader, body },
    recordLength: frameLength(kindHeader.length, body.length),
  };
}

function countBlocks(blocks: readonly RowBlockEntry[], type: number): number {
  return blocks.reduce(
    (count, block) => count + (block.type === type ? 1 : 0),
    0,
  );
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
  encoded: Pick<EncodedRow, 'header' | 'recordLength'>,
  recordOffset: number,
  transcriptId = 0n,
): RowEntry {
  const { header } = encoded;
  return {
    transcriptId,
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
    toolCallBlocks: countBlocks(header.blocks, ROW_BLOCK_TYPE.tool_call),
    responseBlocks: countBlocks(header.blocks, ROW_BLOCK_TYPE.tool_response),
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

/**
 * The entry of a row that rewrites the row `previous`, such as a purge that
 * keeps its id tuples (design 4.6). What the normalizer derived from the ids
 * stays; the numbers computed from the content, the summaries, token counts,
 * media metrics and `LENS` references, start missing again, because the
 * content changed.
 */
export function entryForRewrittenRow(
  encoded: EncodedRow,
  recordOffset: number,
  previous: RowEntry,
  transcriptId = 0n,
): RowEntry {
  const fresh = entryForNewRow(encoded, recordOffset, transcriptId);
  return {
    ...fresh,
    flags: fresh.flags | (previous.flags & ENTRY_FLAG.pairSensitive),
    reconBlocks: previous.reconBlocks,
    answered: previous.answered,
    callBlocks: previous.callBlocks,
    unmappedBlocks: previous.unmappedBlocks,
  };
}
