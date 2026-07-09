/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type OpenAI from 'openai';
import type {
  IContent,
  MediaBlock,
  TextBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { classifyMediaBlock } from '../utils/mediaUtils.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import {
  uploadKimiFiles,
  buildKimiFileReferenceText,
  type BoundedCache,
} from './kimiFileUpload.js';

const logger = new DebugLogger('llxprt:kimi:media');

/**
 * Check whether a media block is a PDF that should be routed through Kimi's
 * Files API (base64-embedded, not already a URL).
 */
function isUploadablePdf(block: MediaBlock): boolean {
  return classifyMediaBlock(block) === 'pdf' && block.encoding === 'base64';
}

/**
 * Walk all contents and collect PDF media blocks that should be uploaded via
 * the Files API. Returns both the flat list and the locations (content index +
 * block index) so the caller can replace them in place.
 */
function collectUploadablePdfs(contents: IContent[]): {
  blocks: MediaBlock[];
  locations: Array<{ contentIndex: number; blockIndex: number }>;
} {
  const blocks: MediaBlock[] = [];
  const locations: Array<{ contentIndex: number; blockIndex: number }> = [];

  contents.forEach((content, ci) => {
    content.blocks.forEach((block, bi) => {
      if (block.type === 'media' && isUploadablePdf(block)) {
        blocks.push(block);
        locations.push({ contentIndex: ci, blockIndex: bi });
      }
    });
  });

  return { blocks, locations };
}

export interface KimiMediaProcessingResult {
  /** Transformed contents (shallow-cloned; PDF blocks replaced with text references). */
  contents: IContent[];
  /** System-message text fragment referencing uploaded file ids, or '' if none. */
  fileReferenceText: string;
}

/**
 * Process media blocks for Kimi: upload PDFs via the Files API and replace them
 * with short text references in the contents, returning a system-message
 * fragment that lists the uploaded file ids.
 *
 * When no uploadable PDFs are found, or when uploads fail, the contents are
 * returned unchanged so the existing inline/placeholder behavior applies.
 *
 * @param client - The live OpenAI-compatible client.
 * @param contents - The conversation contents to scan.
 * @param cache - Optional de-dup cache shared across turns.
 */
export async function processKimiMedia(
  client: OpenAI,
  contents: IContent[],
  cache?: BoundedCache<string>,
): Promise<KimiMediaProcessingResult> {
  const { blocks, locations } = collectUploadablePdfs(contents);

  if (blocks.length === 0) {
    return { contents, fileReferenceText: '' };
  }

  let uploadResults: Awaited<ReturnType<typeof uploadKimiFiles>>;
  try {
    uploadResults = await uploadKimiFiles(client, blocks, cache);
  } catch (error) {
    logger.warn(
      () =>
        `Kimi media upload unexpectedly rejected, falling back to inline: ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
    return { contents, fileReferenceText: '' };
  }
  const successfulFileIds: string[] = [];
  const replacementsByBlock = new Map<MediaBlock, string>();

  for (const result of uploadResults) {
    if (result.failed || !result.fileId) {
      continue;
    }
    successfulFileIds.push(result.fileId);
    const filename = result.block.filename ?? 'document.pdf';
    replacementsByBlock.set(
      result.block,
      `[Uploaded PDF: ${filename} (file id: ${result.fileId})]`,
    );
  }

  if (successfulFileIds.length === 0) {
    logger.debug(
      () =>
        'All Kimi PDF uploads failed; leaving contents unchanged for inline fallback',
    );
    return { contents, fileReferenceText: '' };
  }

  // Shallow-clone contents and replace uploaded PDF blocks with text references.
  const newContents = contents.map((c) => ({ ...c }));
  const applicableLocations = locations.filter(
    ({ contentIndex, blockIndex }) => {
      const originalBlock = contents[contentIndex].blocks[blockIndex];
      return (
        originalBlock.type === 'media' && replacementsByBlock.has(originalBlock)
      );
    },
  );

  for (const { contentIndex, blockIndex } of applicableLocations) {
    const originalBlock = contents[contentIndex].blocks[
      blockIndex
    ] as MediaBlock;
    const replacementText = replacementsByBlock.get(originalBlock);
    const replacementBlock: TextBlock = {
      type: 'text',
      text: replacementText!,
    };
    const targetContent = newContents[contentIndex];
    const newBlocks = [...targetContent.blocks];
    newBlocks[blockIndex] = replacementBlock;
    targetContent.blocks = newBlocks;
  }

  return {
    contents: newContents,
    fileReferenceText: buildKimiFileReferenceText(successfulFileIds),
  };
}
