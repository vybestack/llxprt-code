/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  IContent,
  MediaBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { AnthropicMessageBlock } from './AnthropicMessageNormalizer.js';
import {
  mediaBlockToAnthropicImage,
  mediaBlockToAnthropicDocument,
} from './AnthropicHumanMessageConverter.js';
import { anthropicWireMedia } from './anthropic-measured-media.js';
import type { MediaStage } from './message-table/wire-builder.js';
import type { ImageDimensionBudget } from '@vybestack/llxprt-code-tools/utils/imageDimensionBudget.js';
import { sanitizeWireBlockImages } from './AnthropicImageSanitizer.js';

async function* recoveredPieces(
  pieces: AsyncIterable<AnthropicWirePiece>,
  budget: ImageDimensionBudget | undefined,
  observeRecovery: ((count: number) => void) | undefined,
): AsyncGenerator<AnthropicWirePiece> {
  for await (const piece of pieces) {
    if (typeof piece === 'string' || budget === undefined) {
      yield piece;
      continue;
    }
    const recovered = sanitizeWireBlockImages(piece, budget);
    observeRecovery?.(recovered.replacedCount);
    yield recovered.block;
  }
}

export type AnthropicWirePiece = string | AnthropicMessageBlock;

function mediaParts(
  block: AnthropicMessageBlock,
): readonly AnthropicMessageBlock[] {
  return block.type === 'tool_result' && Array.isArray(block.content)
    ? block.content
    : [block];
}

function resolveBlock(
  block: AnthropicMessageBlock,
  row: IContent,
): AnthropicMessageBlock {
  const media = row.blocks.filter(
    (part): part is MediaBlock => part.type === 'media',
  );
  let index = 0;
  const resolve = <T extends AnthropicMessageBlock>(part: T): T => {
    const original = anthropicWireMedia(part);
    if (original === undefined) return part;
    if (index >= media.length)
      throw new Error('Anthropic media stage lost a reference');
    const resolved = media[index++];
    if (original.encoding !== 'reference') return part;
    if (part.type !== 'image' && part.type !== 'document') return part;
    const converted =
      part.type === 'image'
        ? mediaBlockToAnthropicImage(resolved)
        : mediaBlockToAnthropicDocument(resolved);
    return { ...part, source: converted.source };
  };
  if (block.type !== 'tool_result' || !Array.isArray(block.content))
    return resolve(block);
  return { ...block, content: block.content.map(resolve) };
}

export async function* resolveAnthropicWireMedia(
  pieces: AsyncIterable<AnthropicWirePiece>,
  stage: MediaStage | undefined,
  budget?: ImageDimensionBudget,
  observeRecovery?: (count: number) => void,
): AsyncGenerator<AnthropicWirePiece> {
  const recovered = recoveredPieces(pieces, budget, observeRecovery);
  if (stage === undefined) {
    yield* recovered;
    return;
  }
  let pending: AnthropicWirePiece | undefined;
  const rows = async function* (): AsyncGenerator<IContent> {
    for await (const piece of recovered) {
      pending = piece;
      yield {
        speaker: 'human',
        blocks:
          typeof piece === 'string'
            ? []
            : mediaParts(piece).flatMap((part) => {
                const media = anthropicWireMedia(part);
                return media === undefined ? [] : [media];
              }),
      };
    }
  };
  for await (const row of stage(rows())) {
    if (pending === undefined)
      throw new Error('Anthropic media stage yielded an extra row');
    yield typeof pending === 'string' ? pending : resolveBlock(pending, row);
    pending = undefined;
  }
}
