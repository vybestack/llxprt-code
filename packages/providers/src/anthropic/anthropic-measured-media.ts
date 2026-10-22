/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  IContent,
  InlineMediaBlock,
  MediaBlock,
  MediaReferenceBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  AnthropicImageBlock,
  AnthropicDocumentBlock,
  AnthropicMessageBlock,
} from './AnthropicMessageNormalizer.js';

const references = new WeakMap<MediaBlock, MediaReferenceBlock>();
const wireMedia = new WeakMap<object, MediaBlock>();

export function anthropicWireMedia(
  block: AnthropicMessageBlock,
): MediaBlock | undefined {
  return wireMedia.get('source' in block ? block.source : block);
}

export function copyAnthropicWireMedia(
  source: AnthropicMessageBlock,
  target: AnthropicMessageBlock,
): void {
  const media = anthropicWireMedia(source);
  if (media !== undefined)
    wireMedia.set('source' in target ? target.source : target, media);
}

export function anthropicMediaReference(
  block: AnthropicImageBlock | AnthropicDocumentBlock,
): MediaReferenceBlock | undefined {
  const media = anthropicWireMedia(block);
  return media?.encoding === 'reference' ? media : undefined;
}

export function measurableAnthropicRow(row: IContent): IContent {
  return {
    ...row,
    blocks: row.blocks.map((block) => {
      if (block.type !== 'media' || block.encoding !== 'reference')
        return block;
      const inline: InlineMediaBlock = {
        ...block,
        encoding: 'base64',
        data: '',
      };
      references.set(inline, block);
      return inline;
    }),
  };
}

export function measuredAnthropicMedia<
  T extends
    | AnthropicImageBlock
    | AnthropicDocumentBlock
    | { type: 'text'; text: string },
>(media: MediaBlock, block: T): T {
  const reference = references.get(media);
  wireMedia.set('source' in block ? block.source : block, reference ?? media);
  return block;
}

export function anthropicBlockByteLength(block: AnthropicMessageBlock): number {
  const payload = (
    value: AnthropicImageBlock | AnthropicDocumentBlock,
  ): number => anthropicMediaReference(value)?.normalizedBase64Length ?? 0;
  const bytes = Buffer.byteLength(JSON.stringify(block));
  if (block.type === 'image' || block.type === 'document')
    return bytes + payload(block);
  if (block.type !== 'tool_result' || !Array.isArray(block.content))
    return bytes;
  return (
    bytes +
    block.content.reduce(
      (total, nested) => total + (nested.type === 'text' ? 0 : payload(nested)),
      0,
    )
  );
}
