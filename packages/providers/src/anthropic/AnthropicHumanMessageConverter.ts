/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  requireInlineMediaBlock,
  type ContentBlock,
  type MediaBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  buildUnsupportedMediaPlaceholder,
  classifyMediaBlock,
  detectImageMimeTypeFromBase64,
} from '../utils/mediaUtils.js';
import type {
  AnthropicDocumentBlock,
  AnthropicImageBlock,
} from './AnthropicMessageNormalizer.js';

export function mediaBlockToAnthropicImage(
  media: MediaBlock,
): AnthropicImageBlock {
  const inlineMedia = requireInlineMediaBlock(media);
  if (inlineMedia.encoding === 'url') {
    return {
      type: 'image',
      source: { type: 'url', url: inlineMedia.data },
    };
  }
  const rawData =
    inlineMedia.data.startsWith('data:') &&
    inlineMedia.data.includes(';base64,')
      ? inlineMedia.data.split(';base64,')[1]
      : inlineMedia.data;
  const detected = detectImageMimeTypeFromBase64(rawData);
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: detected ?? (inlineMedia.mimeType || 'image/png'),
      data: rawData,
    },
  };
}

export function mediaBlockToAnthropicDocument(
  media: MediaBlock,
): AnthropicDocumentBlock {
  const inlineMedia = requireInlineMediaBlock(media);
  if (inlineMedia.encoding === 'url') {
    return {
      type: 'document',
      source: { type: 'url', url: inlineMedia.data },
      ...(inlineMedia.filename ? { title: inlineMedia.filename } : {}),
    };
  }
  const rawData =
    inlineMedia.data.startsWith('data:') &&
    inlineMedia.data.includes(';base64,')
      ? inlineMedia.data.split(';base64,')[1]
      : inlineMedia.data;
  return {
    type: 'document',
    source: {
      type: 'base64',
      media_type: inlineMedia.mimeType || 'application/pdf',
      data: rawData,
    },
    ...(media.filename ? { title: media.filename } : {}),
  };
}

type HumanMediaPart =
  | { type: 'text'; text: string }
  | AnthropicImageBlock
  | AnthropicDocumentBlock;

export interface HumanMediaConversion {
  readonly parts: HumanMediaPart[];
  readonly providerPartBySourceBlock: ReadonlyArray<number | undefined>;
}

export function convertHumanMessageWithMedia(
  blocks: ContentBlock[],
): HumanMediaConversion {
  const parts: HumanMediaPart[] = [];
  const providerPartBySourceBlock: Array<number | undefined> = [];
  for (const block of blocks) {
    const providerPartIndex = parts.length;
    if (block.type === 'text' && block.text) {
      parts.push({ type: 'text', text: block.text });
    } else if (block.type === 'code') {
      const language = block.language ?? '';
      parts.push({
        type: 'text',
        text: `\n\n\`\`\`${language}\n${block.code}\n\`\`\`\n`,
      });
    } else if (block.type === 'media') {
      const category = classifyMediaBlock(block);
      if (category === 'image') {
        parts.push(mediaBlockToAnthropicImage(block));
      } else if (category === 'pdf') {
        parts.push(mediaBlockToAnthropicDocument(block));
      } else {
        parts.push({
          type: 'text',
          text: buildUnsupportedMediaPlaceholder(block, 'Anthropic'),
        });
      }
    }
    providerPartBySourceBlock.push(
      parts.length === providerPartIndex + 1 ? providerPartIndex : undefined,
    );
  }
  return { parts, providerPartBySourceBlock };
}
