/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type OpenAI from 'openai';
import type {
  ContentBlock,
  IContent,
  MediaBlock,
  TextBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { classifyMediaBlock } from '../utils/mediaUtils.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import {
  uploadKimiFiles,
  type BoundedCache,
  type KimiUploadOptions,
  isKimiUploadable,
} from './kimiFileUpload.js';

const logger = new DebugLogger('llxprt:kimi:media');

/**
 * What an uploaded media block becomes in the chat body. A video keeps its
 * block and points at the Moonshot file; a document turns into a text line.
 */
export type KimiMediaReplacement =
  | { readonly kind: 'video'; readonly fileId: string }
  | {
      readonly kind: 'pdf';
      readonly filename: string;
      readonly fileId: string;
    };

export interface KimiUploadRecord {
  get(key: string): unknown;
  set(key: string, value: KimiMediaReplacement): void;
}

/**
 * The key of one media block in a request's upload record: the position of its
 * row among the block-bearing rows of the call, and of the block in the row.
 * Both passes read the same rows in the same order, so the position names the
 * same block each time and two equal blocks never share an upload.
 */
function mediaId(rowOrdinal: number, blockIndex: number): string {
  return `kimi-media:${rowOrdinal}:${blockIndex}`;
}

function replacementOf(
  block: MediaBlock,
  fileId: string,
): KimiMediaReplacement {
  return classifyMediaBlock(block) === 'video'
    ? { kind: 'video', fileId }
    : { kind: 'pdf', filename: block.filename ?? 'document.pdf', fileId };
}

function isReplacement(value: unknown): value is KimiMediaReplacement {
  if (typeof value !== 'object' || value === null) return false;
  const { kind, fileId } = value as Record<string, unknown>;
  return (kind === 'video' || kind === 'pdf') && typeof fileId === 'string';
}

function replacementBlock(
  block: MediaBlock,
  replacement: KimiMediaReplacement,
): ContentBlock {
  if (replacement.kind === 'video') {
    return {
      ...block,
      data: `ms://${replacement.fileId}`,
      encoding: 'url',
    };
  }
  const text: TextBlock = {
    type: 'text',
    text: `[Uploaded PDF: ${replacement.filename} (file id: ${replacement.fileId})]`,
  };
  return text;
}

interface UploadableMedia {
  readonly block: MediaBlock;
  readonly blockIndex: number;
}

function uploadableMediaOf(
  row: IContent,
  options: KimiUploadOptions,
): UploadableMedia[] {
  const found: UploadableMedia[] = [];
  row.blocks.forEach((block, blockIndex) => {
    if (block.type === 'media' && isKimiUploadable(block, options)) {
      found.push({ block, blockIndex });
    }
  });
  return found;
}

/**
 * Uploads the uploadable media of one row, in block order, and records each
 * successful upload in `uploads` under the block's position. Returns how many
 * blocks were recorded. A failed upload rejects, as it does for a whole
 * history, and records nothing for that block.
 *
 * Rows are handed in one at a time in history order and the uploads of a row
 * run one after the other, so the upload order, the dedupe through `cache` or
 * the file lifecycle, and the cache insertion order are those of a pass over
 * the whole history.
 */
export async function uploadKimiRowMedia(
  client: OpenAI,
  row: IContent,
  rowOrdinal: number,
  uploads: KimiUploadRecord,
  cache?: BoundedCache<string>,
  options: KimiUploadOptions = {},
): Promise<number> {
  const media = uploadableMediaOf(row, options);
  if (media.length === 0) return 0;
  const results = await uploadKimiFiles(
    client,
    media.map((entry) => entry.block),
    cache,
    options,
  );
  let recorded = 0;
  results.forEach((result, position) => {
    if (result.failed || !result.fileId) return;
    uploads.set(
      mediaId(rowOrdinal, media[position].blockIndex),
      replacementOf(result.block, result.fileId),
    );
    recorded++;
  });
  if (recorded === 0) {
    logger.debug(() => 'All Kimi media uploads failed; leaving row unchanged');
  }
  return recorded;
}

/**
 * The row with its uploaded media replaced by the references recorded for it.
 * The row itself when nothing in it was uploaded; otherwise a copy with a new
 * block list, so the history's row is never modified.
 */
export function applyKimiRowMedia(
  row: IContent,
  rowOrdinal: number,
  uploads: KimiUploadRecord,
): IContent {
  let blocks: ContentBlock[] | undefined;
  row.blocks.forEach((block, blockIndex) => {
    if (block.type !== 'media') return;
    const stored = uploads.get(mediaId(rowOrdinal, blockIndex));
    if (stored === undefined) return;
    if (!isReplacement(stored)) {
      throw new Error('Kimi upload record holds an unexpected value');
    }
    blocks ??= [...row.blocks];
    blocks[blockIndex] = replacementBlock(block, stored);
  });
  return blocks === undefined ? row : { ...row, blocks };
}
