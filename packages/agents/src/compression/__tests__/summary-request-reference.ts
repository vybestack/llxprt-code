/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { PromptResolver } from '@vybestack/llxprt-code-core/prompt-config/prompt-resolver.js';
import {
  buildSummaryRequestFrame,
  sanitizeHistoryForCompression,
  type SummaryRequestFrame,
} from '../utils.js';

/**
 * A request frame built from the shipped compression prompt files, with the
 * instructions turn replaced by `instructions` so tests can tell it apart.
 */
export function testSummaryFrame(instructions: string): SummaryRequestFrame {
  return {
    ...buildSummaryRequestFrame({
      promptResolver: new PromptResolver(),
      promptBaseDir: '',
      promptContext: {},
    }),
    instructions: {
      speaker: 'human',
      blocks: [{ type: 'text', text: instructions }],
    },
  };
}

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
  frame: SummaryRequestFrame,
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
    frame.preamble,
    frame.instructions,
    ...sanitizeHistoryForCompression(range),
    ...injections,
    priorSnapshot ? frame.triggerWithPriorSnapshot : frame.trigger,
  ];
}
