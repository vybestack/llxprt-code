/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { IContent } from './IContent.js';

export function validateHistoryBatch(contents: readonly IContent[]): void {
  for (const [index, content] of contents.entries()) {
    const validSpeaker = ['human', 'ai', 'tool'].includes(content.speaker);
    const validBlocks =
      Array.isArray(content.blocks) && content.blocks.length > 0;
    if (!validSpeaker || !validBlocks) {
      throw new Error(
        `History batch entry ${index} is invalid: ${validSpeaker ? 'content has no blocks' : 'speaker is invalid'}`,
      );
    }
  }
}
