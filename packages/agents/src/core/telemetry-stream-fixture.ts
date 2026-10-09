/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { diskTextRow } from '@vybestack/llxprt-code-providers/openai-responses/disk-text-fixture.js';

export function telemetryCapRow(index: number, large: boolean): IContent {
  const row = diskTextRow(index, large);
  return large
    ? {
        ...row,
        blocks: [
          ...row.blocks,
          { type: 'text', text: `${index}:🌊雪\n"\\`.repeat(65536) },
        ],
      }
    : row;
}
