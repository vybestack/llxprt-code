/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HistoryIndexedRows } from '@vybestack/llxprt-code-core/services/history/historyMutationSnapshot.js';
import type { CompressionContext } from '@vybestack/llxprt-code-core/core/compression/types.js';
import type { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
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

export async function withDiskSummaryRequest<T>(
  rows: HistoryIndexedRows,
  plan: MiddleOutDiskPlan,
  prompt: string,
  injections: IContent[],
  ownership: RowOwnership,
  send: (request: IContent[]) => Promise<T>,
): Promise<T> {
  const request: IContent[] = [];
  const append = (row: IContent): void => {
    ownership.retain(row);
    request.push(row);
  };
  try {
    append(COMPRESSION_SECURITY_PREAMBLE);
    append({ speaker: 'human', blocks: [{ type: 'text', text: prompt }] });
    let priorSnapshot = false;
    for (let index = plan.top; index < plan.bottom; index++) {
      const row = rows.readRow(index);
      priorSnapshot ||= row.blocks.some(
        (block) =>
          block.type === 'text' && block.text.includes('<state_snapshot>'),
      );
      append(sanitizeHistoryForCompression([row])[0]);
    }
    for (const row of injections) append(row);
    for (const row of plan.injection) append(row);
    append({
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
    });
    // This complete model request grows with the compressed range. Every row is
    // charged before options construction and transport, not counted as bounded history.
    return await send(request);
  } finally {
    for (const row of request) ownership.release(row);
  }
}
