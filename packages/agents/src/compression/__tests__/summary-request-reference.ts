/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  buildTriggerInstruction,
  COMPRESSION_SECURITY_PREAMBLE,
  sanitizeHistoryForCompression,
} from '../utils.js';

/**
 * Independent reference for the summarization model request: the resident
 * array the pre-selection implementation sent (security preamble, prompt,
 * sanitized rows in [top, bottom), injections, trigger instruction). Test
 * support only; it never streams.
 */
export function referenceSummaryRequest(
  rows: readonly IContent[],
  top: number,
  bottom: number,
  prompt: string,
  injections: readonly IContent[],
): IContent[] {
  const range = rows.slice(top, bottom);
  const priorSnapshot = range.some((row) =>
    row.blocks.some(
      (block) =>
        block.type === 'text' && block.text.includes('<state_snapshot>'),
    ),
  );
  return [
    COMPRESSION_SECURITY_PREAMBLE,
    { speaker: 'human', blocks: [{ type: 'text', text: prompt }] },
    ...sanitizeHistoryForCompression(range),
    ...injections,
    {
      speaker: 'human',
      blocks: [
        {
          type: 'text',
          text: buildTriggerInstruction(
            priorSnapshot
              ? [
                  {
                    speaker: 'human',
                    blocks: [{ type: 'text', text: '<state_snapshot>' }],
                  },
                ]
              : [],
          ),
        },
      ],
    },
  ];
}
