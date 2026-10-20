/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { JournalFormatError } from '../../journal/errors.js';
import type { DraftBlock, DraftId, RowDraft } from '../../journal/rowDraft.js';
import type { StoredRow } from '../../journal/rowReads.js';
import {
  CHRONOLOGY_SEQ_NONE,
  ROW_FLAG,
  ROW_BLOCK_TYPE,
  ROW_ID_KIND,
  ROW_SPEAKER,
} from '../../journal/rowRecord.js';
import { sanitizeParams } from './historyCloneUtils.js';
import { isCuratedContent } from './historyCuration.js';
import {
  invalidateResponsesStatefulChain,
  type ContentBlock,
  type ContentMetadata,
  type IContent,
  type ToolResponseBlock,
} from './IContent.js';

/** The `type` byte of a block directory entry (design 2.7 leaves the values to the codec). */
export const BLOCK_TYPE = ROW_BLOCK_TYPE satisfies Record<
  ContentBlock['type'],
  number
>;

const BLOCK_TYPE_NAME = Object.fromEntries(
  Object.entries(BLOCK_TYPE).map(([name, code]) => [code, name]),
) as Record<number, ContentBlock['type']>;

const SPEAKER_NAME = ['human', 'ai', 'tool'] as const;

/** Owner 0 is "unowned" (design 5.1). */
export const UNOWNED_ROW = 0;

export interface EncodeRowOptions {
  /** The owner dictionary id the row is written with. */
  readonly owner: number;
  /**
   * The row was written after a rewrite that broke the Responses stateful
   * chain; reading it back then drops `responsesStored`
   * (`invalidateResponsesStatefulChain`).
   */
  readonly invalidateResponses?: boolean;
}

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder('utf-8', { fatal: true });

/**
 * Metadata that has no place in the metadata piece: the chronology marker
 * lives in the row header, and the two purge fields exist only for the
 * request in flight and hold object identities (`IContent.ts`).
 */
const UNSTORED_METADATA = [
  'chronology',
  'semanticMediaPurgeBoundary',
  'semanticMediaPurgeCacheWriteEvidence',
] as const satisfies ReadonlyArray<keyof ContentMetadata>;

function storableMetadata(
  metadata: ContentMetadata | undefined,
): ContentMetadata | undefined {
  if (metadata === undefined) return undefined;
  const rest = { ...metadata };
  for (const key of UNSTORED_METADATA) delete rest[key];
  return rest;
}

function responseScore(response: ToolResponseBlock): number {
  // The best-response rule of the current normalizer (`score + 1`, never negative).
  return (
    (response.isComplete === true ? 2 : 0) -
    (response.error ? 1 : 0) +
    (response.result !== undefined && response.result !== null ? 1 : 0) +
    1
  );
}

function idsOf(blocks: readonly ContentBlock[]): DraftId[] {
  const ids: DraftId[] = [];
  blocks.forEach((block, index) => {
    if (block.type === 'tool_call' && block.id !== '') {
      ids.push({
        rawId: block.id,
        kind: ROW_ID_KIND.call,
        block: index,
        score: 0,
        nameLen: Buffer.byteLength(block.name),
      });
    } else if (block.type === 'tool_response' && block.callId !== '') {
      ids.push({
        rawId: block.callId,
        kind: ROW_ID_KIND.response,
        block: index,
        score: responseScore(block),
        nameLen: Buffer.byteLength(block.toolName),
      });
    }
  });
  return ids;
}

function isBlankText(block: ContentBlock): boolean {
  if (block.type === 'text') return block.text.trim() === '';
  if (block.type === 'code') return block.code.trim() === '';
  return false;
}

/** R7 (design 6.2): what a row emits once its responses and media are stripped. */
function hasSelfUnit(content: IContent): boolean {
  if (!content.blocks.some((block) => block.type === 'tool_response')) {
    return true;
  }
  return (
    content.speaker !== 'tool' &&
    content.blocks.some(
      (block) => block.type !== 'tool_response' && block.type !== 'media',
    )
  );
}

function isResponseParent(content: IContent): boolean {
  const metadata = content.metadata;
  if (content.speaker !== 'ai' || metadata?.responsesStored !== true) {
    return false;
  }
  return typeof metadata.id === 'string' && metadata.id !== ''
    ? hasSelfUnit(content)
    : false;
}

function withoutTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === '/') end -= 1;
  return url.slice(0, end);
}

/** The hash of a recorded endpoint URL without trailing slashes; 0 is the wildcard (design 3.5). */
function parentEndpointOf(content: IContent): bigint {
  const url = withoutTrailingSlashes(content.metadata?.providerBaseURL ?? '');
  if (url === '') return 0n;
  return createHash('sha256').update(url).digest().readBigUInt64BE(0);
}

function flagsOf(content: IContent, options: EncodeRowOptions): number {
  const blocks = content.blocks;
  const has = (test: (block: ContentBlock) => boolean): boolean =>
    blocks.some(test);
  const flagIf = (condition: boolean, bit: number): number =>
    condition ? bit : 0;
  return (
    flagIf(isCuratedContent(content), ROW_FLAG.curated) |
    flagIf(
      has((b) => b.type === 'thinking'),
      ROW_FLAG.hasThinking,
    ) |
    flagIf(
      has((b) => b.type === 'tool_call'),
      ROW_FLAG.hasToolCall,
    ) |
    flagIf(
      has((b) => b.type === 'tool_response'),
      ROW_FLAG.hasToolResponse,
    ) |
    flagIf(
      has((b) => b.type === 'media'),
      ROW_FLAG.hasMedia,
    ) |
    flagIf(
      has(
        (b) =>
          b.type === 'media' &&
          typeof b.mimeType === 'string' &&
          b.mimeType.startsWith('image/'),
      ),
      ROW_FLAG.hasImage,
    ) |
    flagIf(
      has((b) => b.type !== 'thinking' && !isBlankText(b)),
      ROW_FLAG.hasCacheableBlock,
    ) |
    flagIf(content.metadata?.cacheAnchor === true, ROW_FLAG.cacheAnchor) |
    flagIf(content.metadata?.synthetic === true, ROW_FLAG.synthetic) |
    flagIf(options.invalidateResponses === true, ROW_FLAG.invalidateResponses) |
    flagIf(isResponseParent(content), ROW_FLAG.responseParent)
  );
}

function speakerCode(speaker: IContent['speaker']): number {
  const code = ROW_SPEAKER[speaker] as number | undefined;
  if (code === undefined) {
    throw new JournalFormatError(`Unknown speaker ${String(speaker)}`);
  }
  return code;
}

function encodeBlock(block: ContentBlock): DraftBlock {
  const type = BLOCK_TYPE[block.type] as number | undefined;
  if (type === undefined) {
    throw new JournalFormatError(
      `Unknown block type ${String((block as { type: unknown }).type)}`,
    );
  }
  return { type, bytes: ENCODER.encode(JSON.stringify(serializable(block))) };
}

/**
 * Tool payloads come from tools and servers, so they can refer to themselves.
 * They are stored as `sanitizeParams` yields them, the form the old store
 * wrote and the provider paths expect.
 */
function serializable(block: ContentBlock): ContentBlock {
  if (block.type === 'tool_call')
    return { ...block, parameters: sanitizeParams(block.parameters) };
  if (block.type === 'tool_response')
    return { ...block, result: sanitizeParams(block.result) };
  return block;
}

/**
 * Converts one history entry to the row the journal stores (design 2.4). The
 * conversion holds this one entry's serialized blocks and nothing of any
 * other row. Blocks are the JSON `JSON.stringify` yields for them, so a block
 * read back is the object that was written.
 */
export function encodeContentRow(
  content: IContent,
  options: EncodeRowOptions,
): RowDraft {
  const chronology = content.metadata?.chronology;
  const metadata = storableMetadata(content.metadata);
  const contentKeys = Object.keys(content).filter(
    (key) => key === 'speaker' || key === 'blocks' || key === 'metadata',
  );
  const defaultKeys =
    content.metadata === undefined
      ? 'speaker,blocks'
      : 'speaker,blocks,metadata';
  const order = contentKeys.join(',') === defaultKeys ? {} : { contentKeys };
  return {
    owner: options.owner,
    speaker: speakerCode(content.speaker),
    flags: flagsOf(content, options),
    chronologySeq:
      chronology === undefined ? CHRONOLOGY_SEQ_NONE : BigInt(chronology.seq),
    chronologyUserTurn: chronology?.userTurn ?? 0,
    chronologyStep: chronology?.step ?? 0,
    chronologyRecordedAt: chronology?.recordedAt ?? 0,
    parentEndpoint: isResponseParent(content) ? parentEndpointOf(content) : 0n,
    ids: idsOf(content.blocks),
    meta: ENCODER.encode(
      JSON.stringify(
        metadata === undefined
          ? { speaker: content.speaker, ...order }
          : {
              speaker: content.speaker,
              ...order,
              metadata,
              ...(chronology === undefined
                ? {}
                : {
                    chronologyIndex: Object.keys(content.metadata ?? {})
                      .filter(
                        (key) =>
                          key !== 'semanticMediaPurgeBoundary' &&
                          key !== 'semanticMediaPurgeCacheWriteEvidence',
                      )
                      .indexOf('chronology'),
                  }),
            },
      ),
    ),
    blocks: content.blocks.map(encodeBlock),
  };
}

interface MetaPiece {
  readonly speaker: IContent['speaker'];
  readonly contentKeys?: readonly string[];
  readonly metadata?: ContentMetadata;
  readonly chronologyIndex?: number;
}

function decodedMetadata(
  piece: MetaPiece,
  header: StoredRow['header'],
): ContentMetadata | undefined {
  if (header.chronologySeq === CHRONOLOGY_SEQ_NONE) return piece.metadata;
  const entries = Object.entries(piece.metadata ?? {});
  const index = piece.chronologyIndex;
  if (
    index === undefined ||
    !Number.isInteger(index) ||
    index < 0 ||
    index > entries.length
  ) {
    throw new JournalFormatError('Invalid chronology metadata position');
  }
  entries.splice(index, 0, [
    'chronology',
    {
      seq: Number(header.chronologySeq),
      userTurn: header.chronologyUserTurn,
      step: header.chronologyStep,
      recordedAt: header.chronologyRecordedAt,
    },
  ]);
  return Object.fromEntries(entries);
}

function decodeBlock(bytes: Uint8Array, type: number): ContentBlock {
  const block = JSON.parse(DECODER.decode(bytes)) as ContentBlock;
  if (BLOCK_TYPE_NAME[type] !== block.type) {
    throw new JournalFormatError(
      `A block stored as type ${type} holds a ${String(block.type)} block`,
    );
  }
  return block;
}

/**
 * Converts a stored row back to a history entry. The row is already whole in
 * memory (`readStoredRow`); this builds its objects and keeps nothing else.
 */
export function decodeStoredRow(
  row: StoredRow,
  resumeBoundary?: bigint,
): IContent {
  const { header } = row;
  const piece = JSON.parse(DECODER.decode(row.meta)) as MetaPiece;
  if (SPEAKER_NAME[header.speaker] !== piece.speaker) {
    throw new JournalFormatError(
      `Row ${header.label} has speaker code ${header.speaker} and metadata for ${String(piece.speaker)}`,
    );
  }
  const content: IContent = {
    speaker: piece.speaker,
    blocks: row.blocks.map((bytes, index) =>
      decodeBlock(bytes, header.blocks[index].type),
    ),
  };
  const metadata = decodedMetadata(piece, header);
  if (metadata !== undefined) content.metadata = metadata;
  const decoded =
    (header.flags & ROW_FLAG.invalidateResponses) !== 0
      ? invalidateResponsesStatefulChain([content])[0]
      : applyResumeBoundary(header.label, content, resumeBoundary);
  return Object.assign(
    Object.fromEntries(
      (piece.contentKeys ?? Object.keys(decoded)).map((key) => [
        key,
        Reflect.get(decoded, key),
      ]),
    ),
    decoded,
  );
}

/**
 * The read rule of a resumed history (D-S08-3): a row written by an earlier
 * process, which is a row with a label below `resumeBoundary`, loses its
 * stored Responses chain marker, because the chain belongs to the process that
 * made the request. Rows are immutable, so every reader applies this to what
 * it decodes; without a boundary the content is returned as stored.
 */
export function applyResumeBoundary(
  label: bigint,
  content: IContent,
  resumeBoundary: bigint | undefined,
): IContent {
  return resumeBoundary !== undefined && label < resumeBoundary
    ? invalidateResponsesStatefulChain([content])[0]
    : content;
}
