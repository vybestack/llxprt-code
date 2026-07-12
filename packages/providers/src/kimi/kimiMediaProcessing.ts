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
  buildKimiFileReferenceText,
  type BoundedCache,
  type KimiUploadOptions,
  isKimiUploadable,
} from './kimiFileUpload.js';

const logger = new DebugLogger('llxprt:kimi:media');

function collectUploadableMedia(
  contents: IContent[],
  options: KimiUploadOptions,
): {
  blocks: MediaBlock[];
  locations: Array<{ contentIndex: number; blockIndex: number }>;
} {
  const blocks: MediaBlock[] = [];
  const locations: Array<{ contentIndex: number; blockIndex: number }> = [];

  contents.forEach((content, contentIndex) => {
    content.blocks.forEach((block, blockIndex) => {
      if (block.type === 'media' && isKimiUploadable(block, options)) {
        blocks.push(block);
        locations.push({ contentIndex, blockIndex });
      }
    });
  });

  return { blocks, locations };
}

export interface KimiMediaProcessingResult {
  /** Original reference when unchanged; a cloned array when media was replaced. */
  contents: IContent[];
  fileReferenceText: string;
}

export async function processKimiMedia(
  client: OpenAI,
  contents: IContent[],
  cache?: BoundedCache<string>,
  options: KimiUploadOptions = {},
): Promise<KimiMediaProcessingResult> {
  const { blocks, locations } = collectUploadableMedia(contents, options);

  if (blocks.length === 0) {
    return { contents, fileReferenceText: '' };
  }

  let uploadResults: Awaited<ReturnType<typeof uploadKimiFiles>>;
  try {
    uploadResults = await uploadKimiFiles(client, blocks, cache, options);
  } catch (error) {
    logger.warn(
      () =>
        `Kimi media upload unexpectedly rejected, falling back to inline: ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
    return { contents, fileReferenceText: '' };
  }

  const pdfFileIds: string[] = [];
  const replacements = new Map<MediaBlock, ContentBlock>();

  for (const result of uploadResults) {
    if (!result.failed && result.fileId) {
      if (classifyMediaBlock(result.block) === 'video') {
        replacements.set(result.block, {
          ...result.block,
          data: `ms://${result.fileId}`,
          encoding: 'url',
        });
      } else {
        pdfFileIds.push(result.fileId);
        const filename = result.block.filename ?? 'document.pdf';
        const replacement: TextBlock = {
          type: 'text',
          text: `[Uploaded PDF: ${filename} (file id: ${result.fileId})]`,
        };
        replacements.set(result.block, replacement);
      }
    }
  }

  if (replacements.size === 0) {
    logger.debug(
      () => 'All Kimi media uploads failed; leaving contents unchanged',
    );
    return { contents, fileReferenceText: '' };
  }

  const newContents = contents.map((content) => ({ ...content }));
  for (const { contentIndex, blockIndex } of locations) {
    const originalBlock = contents[contentIndex].blocks[blockIndex];
    const replacement =
      originalBlock.type === 'media'
        ? replacements.get(originalBlock)
        : undefined;
    if (replacement) {
      const targetContent = newContents[contentIndex];
      const newBlocks = [...targetContent.blocks];
      newBlocks[blockIndex] = replacement;
      targetContent.blocks = newBlocks;
    }
  }

  return {
    contents: newContents,
    fileReferenceText: buildKimiFileReferenceText(pdfFileIds),
  };
}
