/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelOutput } from '@vybestack/llxprt-code-core/llm-types/index.js';

/** Preserve the first text block's position while replacing streamed fragments. */
export function ensureResponseText(output: ModelOutput, text: string): void {
  const blocks = output.content.blocks;
  const hasText = blocks.some((b) => b.type === 'text');
  if (hasText) {
    let textPlaced = false;
    output.content.blocks = blocks
      .filter((b) => {
        if (b.type === 'text') {
          if (!textPlaced) {
            textPlaced = true;
            return true;
          }
          return false;
        }
        return true;
      })
      .map((b) => (b.type === 'text' ? { type: 'text' as const, text } : b));
  } else {
    output.content.blocks = [...blocks, { type: 'text' as const, text }];
  }
}

/** Keep hook-modified text's leading and trailing whitespace. */
export function extractResponseText(output: ModelOutput): string {
  return output.content.blocks
    .filter(
      (block) =>
        block.type === 'text' &&
        typeof block.text === 'string' &&
        block.text !== '',
    )
    .map((block) => (block as { text: string }).text)
    .join('');
}
