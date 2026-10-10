/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HistoryIndexedRows } from '@vybestack/llxprt-code-core/services/history/historyMutationSnapshot.js';
import type { CompressionContext } from '@vybestack/llxprt-code-core/core/compression/types.js';
import type { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { estimateTokens } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import {
  adjustDiskToolBoundary,
  forwardDiskToolBoundary,
} from './truncationDiskBoundary.js';
import {
  buildTriggerInstruction,
  COMPRESSION_SECURITY_PREAMBLE,
  mediaBlockToCompressionPlaceholder,
  sanitizeHistoryForCompression,
} from './utils.js';

export interface MiddleOutDiskPlan {
  readonly top: number;
  readonly bottom: number;
  readonly lastPromptContext?: string;
  readonly injection: IContent[];
}

function lastHumanIndex(rows: HistoryIndexedRows): number {
  for (let index = rows.length - 1; index >= 0; index--) {
    if (rows.readRow(index).speaker === 'human') return index;
  }
  return -1;
}

function extractText(row: IContent): string {
  return row.blocks
    .map((block) => {
      if (block.type === 'text') return block.text;
      if (block.type === 'media')
        return mediaBlockToCompressionPlaceholder(block);
      return '';
    })
    .filter((text) => text.length > 0)
    .join(' ');
}

export function planDiskMiddleOut(
  rows: HistoryIndexedRows,
  context: Omit<CompressionContext, 'history'>,
): MiddleOutDiskPlan | undefined {
  if (rows.length === 0) return undefined;
  let top = Math.ceil(
    rows.length * context.runtimeContext.ephemerals.topPreserveThreshold(),
  );
  if ((context.cacheAnchorSeq ?? 0) > 0) {
    for (let index = 0; index < rows.length; index++) {
      if (
        rows.readRow(index).metadata?.chronology?.seq === context.cacheAnchorSeq
      ) {
        top = Math.max(top, index + 1);
        break;
      }
    }
  }
  let bottom = Math.floor(
    rows.length * (1 - context.runtimeContext.ephemerals.preserveThreshold()),
  );
  if (bottom - top < 4) return undefined;
  const floor = top;
  top = adjustDiskToolBoundary(rows, top);
  if (top < floor) {
    top = -1;
    for (let candidate = floor; candidate <= rows.length; candidate++) {
      const adjusted = forwardDiskToolBoundary(rows, candidate);
      if (adjusted >= floor) {
        top = adjusted;
        break;
      }
    }
    if (top === -1) return undefined;
  }
  bottom = adjustDiskToolBoundary(rows, bottom);
  if (top >= bottom || bottom - top < 4) return undefined;
  return preserveLastPrompt(rows, top, bottom);
}

function preserveLastPrompt(
  rows: HistoryIndexedRows,
  top: number,
  originalBottom: number,
): MiddleOutDiskPlan | undefined {
  let bottom = originalBottom;
  let lastPromptContext: string | undefined;
  const injection: IContent[] = [];
  const index = lastHumanIndex(rows);
  if (index >= 0) {
    const text = extractText(rows.readRow(index));
    lastPromptContext =
      (text.length > 200 ? text.slice(0, 200) + '...' : text) || undefined;
    if (index >= top && index < bottom) {
      if (estimateTokens(text) < 500) bottom = index;
      else
        injection.push({
          speaker: 'human',
          blocks: [
            {
              type: 'text',
              text: `IMPORTANT — The user's most recent message (summarized because it was too long to preserve literally). Summarize this user request faithfully and completely, preserving their exact intent, problems described, and any specific instructions:\n\n${text}`,
            },
          ],
        });
    }
  }
  if (bottom - top < 4) return undefined;
  return { top, bottom, lastPromptContext, injection };
}

const SUMMARY_FRAME_ROWS = 3;

/**
 * The complete summarization request as a repeatable selection: the security
 * preamble, the compression prompt, the sanitized journal rows in
 * [plan.top, plan.bottom), the context injections and the trigger instruction.
 * Only the small framing rows live in memory; journal rows are read one at a
 * time while a reader advances and each is owned only until the next pull.
 */
export function diskSummaryRequestSelection(
  rows: HistoryIndexedRows,
  plan: MiddleOutDiskPlan,
  prompt: string,
  injections: IContent[],
  ownership: RowOwnership,
): ProviderRequestSelection {
  const tail = [...injections, ...plan.injection];
  const promptRow: IContent = {
    speaker: 'human',
    blocks: [{ type: 'text', text: prompt }],
  };
  return {
    count: SUMMARY_FRAME_ROWS + (plan.bottom - plan.top) + tail.length,
    async *openReader(signal) {
      signal?.throwIfAborted();
      yield COMPRESSION_SECURITY_PREAMBLE;
      yield promptRow;
      let priorSnapshot = false;
      for (let index = plan.top; index < plan.bottom; index++) {
        signal?.throwIfAborted();
        const row = rows.readRow(index);
        priorSnapshot ||= row.blocks.some(
          (block) =>
            block.type === 'text' && block.text.includes('<state_snapshot>'),
        );
        const sanitized = sanitizeHistoryForCompression([row])[0];
        ownership.retain(sanitized);
        try {
          yield sanitized;
        } finally {
          ownership.release(sanitized);
        }
      }
      yield* tail;
      yield {
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
      };
    },
    close: () => undefined,
  };
}
