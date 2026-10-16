/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { ImageDimensionBudget } from '@vybestack/llxprt-code-tools/utils/imageDimensionBudget.js';
import { sanitizeWireBlockImages } from '../AnthropicImageSanitizer.js';
import type { MessageTable } from './message-table.js';

/**
 * Replaces the oversized base64 images of a finished table with the dropped
 * image placeholder, one block record at a time, and returns how many it
 * replaced. This is the reactive image-dimension recovery (#3216): the blocks
 * checked are the finished wire blocks (after the cache controls), so a
 * replaced block loses its breakpoint exactly as it did when the retry
 * rewrote a finished body object. Memory holds one block record.
 */
export function sanitizeTableImages(
  table: MessageTable,
  budget: ImageDimensionBudget,
): number {
  let replaced = 0;
  for (const id of table.ids()) {
    const message = table.messages.read(id);
    if (message.text !== undefined) continue;
    for (const { id: blockId, ...record } of table.entries(message)) {
      const sanitized = sanitizeWireBlockImages(record.block, budget);
      if (sanitized.replacedCount === 0) continue;
      replaced += sanitized.replacedCount;
      table.blocks.replace(blockId, { ...record, block: sanitized.block });
    }
  }
  return replaced;
}
