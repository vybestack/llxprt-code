/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  ContentBlock,
  IContent,
} from '../../../../../core/src/services/history/IContent.js';

function firstImage(
  rows: readonly IContent[],
): { row: number; block: number } | undefined {
  for (const [row, content] of rows.entries())
    for (const [block, value] of content.blocks.entries())
      if (value.type === 'media' && value.mimeType.startsWith('image/'))
        return { row, block };
  return undefined;
}

function imageIdentity(block: ContentBlock | undefined): string | undefined {
  if (block?.type !== 'media') return undefined;
  return block.encoding === 'reference'
    ? block.contentId
    : block.sourceContentId;
}

export function expectedSemanticPurge(
  rows: readonly IContent[],
  mode: 'remove' | 'summary',
): readonly IContent[] | undefined {
  const image = firstImage(rows);
  if (image === undefined) return undefined;
  const changed = rows.flatMap((content, row): IContent[] => {
    if (row !== image.row) return [content];
    const blocks = content.blocks.flatMap((block, index): ContentBlock[] => {
      if (index !== image.block) return [block];
      if (mode === 'remove') return [];
      if (block.type !== 'media' || !block.caption?.trim())
        throw new Error('Expected a captioned fixture image');
      return [{ type: 'text', text: block.caption }];
    });
    return blocks.length === 0 ? [] : [{ ...content, blocks }];
  });
  const nextImage = firstImage(changed);
  const contentRemoved = changed.length !== rows.length;
  const row = Math.min(image.row, changed.length - 1);
  if (changed.length === 0) throw new Error('Expected nonempty purge fixture');
  const content = changed[row];
  const removedBlock = row === image.row ? 0 : content.blocks.length - 1;
  const block = contentRemoved
    ? removedBlock
    : Math.min(image.block, content.blocks.length - 1);
  const nextContent =
    nextImage === undefined ? undefined : changed[nextImage.row];
  const nextBlock =
    nextImage === undefined ? undefined : nextContent?.blocks[nextImage.block];
  const mediaId = imageIdentity(nextBlock);
  const frontier =
    nextImage === undefined
      ? { contentIndex: row, blockIndex: block }
      : {
          contentIndex: nextImage.row,
          blockIndex: nextImage.block,
          ...(nextContent?.metadata?.id
            ? { contentId: nextContent.metadata.id }
            : {}),
          ...(mediaId ? { mediaId } : {}),
        };
  return changed.map((content, index) => {
    const metadata = Object.fromEntries(
      Object.entries(content.metadata ?? {}).filter(
        ([name]) =>
          !(
            name === 'responsesStored' &&
            index >= image.row &&
            content.speaker === 'ai' &&
            content.metadata?.responsesStored === true
          ),
      ),
    );
    return {
      ...content,
      metadata: {
        ...metadata,
        ...(index === 0 ? { semanticMediaPurgeFrontier: frontier } : {}),
      },
    };
  });
}
