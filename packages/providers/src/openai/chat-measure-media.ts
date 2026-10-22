/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  IContent,
  MediaBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { classifyMediaBlock } from '../utils/mediaUtils.js';

export function measurableChatRow(source: IContent): {
  readonly row: IContent;
  readonly userBytes: number;
  readonly mediaBytes: (block: MediaBlock) => number;
} {
  const payloads = new Map<MediaBlock, number>();
  let userBytes = 0;
  const blocks = source.blocks.map((block) => {
    if (block.type !== 'media' || block.encoding !== 'reference') return block;
    const inline: MediaBlock = {
      type: 'media',
      encoding: 'base64',
      data: '',
      mimeType: block.mimeType,
      ...(block.filename === undefined ? {} : { filename: block.filename }),
    };
    const category = classifyMediaBlock(inline);
    const bytes =
      category === 'image' || category === 'pdf'
        ? block.normalizedBase64Length
        : 0;
    payloads.set(inline, bytes);
    userBytes += bytes;
    return inline;
  });
  return {
    row: { ...source, blocks },
    userBytes: source.speaker === 'human' ? userBytes : 0,
    mediaBytes: (block) => payloads.get(block) ?? 0,
  };
}
