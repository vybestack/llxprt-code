/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { z } from 'zod';
import type { DirectoryBlock } from '../../journal/row-directory.js';
import { MetadataJsonProjection } from '../../recording/metadataJsonProjection.js';
import { estimateImageTokens } from '@vybestack/llxprt-code-tools/utils/imageTokenEstimation.js';

const schema = z.object({
  mimeType: z.string(),
  encoding: z.string(),
  dimensions: z.object({ width: z.number(), height: z.number() }).optional(),
});
export async function sealedMediaImageTokens(
  block: DirectoryBlock,
  provider: string | undefined,
  model: string,
): Promise<number | undefined> {
  const parser = new MetadataJsonProjection({
    retain: (path) =>
      path.length === 0 ||
      ['mimeType', 'encoding', 'dimensions'].includes(String(path[0])),
  });
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  for await (const part of block.parts())
    parser.push(decoder.decode(part, { stream: true }));
  parser.push(decoder.decode());
  const media = schema.parse(parser.finish());
  if (media.encoding === 'base64') return undefined;
  if (!media.mimeType.toLowerCase().startsWith('image/')) return 0;
  return estimateImageTokens({
    provider,
    model,
    dimensions: media.encoding === 'reference' ? media.dimensions : undefined,
  });
}
