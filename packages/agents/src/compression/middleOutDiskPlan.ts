/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { CompressionIndexedRows as HistoryIndexedRows } from '@vybestack/llxprt-code-core/services/history/compressionInput.js';
import type { CompressionContext } from '@vybestack/llxprt-code-core/core/compression/types.js';
import { HistoryReaderScope } from '@vybestack/llxprt-code-core/services/history/historyReaderScope.js';
import type { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import {
  assertRowIndex,
  type ProviderRequestSelection,
} from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
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

async function lastHumanIndex(rows: HistoryIndexedRows): Promise<number> {
  for (let index = rows.length - 1; index >= 0; index--) {
    if ((await rows.readRow(index)).speaker === 'human') return index;
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

export async function planDiskMiddleOut(
  rows: HistoryIndexedRows,
  context: Omit<CompressionContext, 'history'>,
): Promise<MiddleOutDiskPlan | undefined> {
  if (rows.length === 0) return undefined;
  let top = Math.ceil(
    rows.length * context.runtimeContext.ephemerals.topPreserveThreshold(),
  );
  if ((context.cacheAnchorSeq ?? 0) > 0) {
    for (let index = 0; index < rows.length; index++) {
      if (
        (await rows.readRow(index)).metadata?.chronology?.seq ===
        context.cacheAnchorSeq
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
  top = await adjustDiskToolBoundary(rows, top);
  if (top < floor) {
    top = -1;
    for (let candidate = floor; candidate <= rows.length; candidate++) {
      const adjusted = await forwardDiskToolBoundary(rows, candidate);
      if (adjusted >= floor) {
        top = adjusted;
        break;
      }
    }
    if (top === -1) return undefined;
  }
  bottom = await adjustDiskToolBoundary(rows, bottom);
  if (top >= bottom || bottom - top < 4) return undefined;
  return preserveLastPrompt(rows, top, bottom);
}

async function preserveLastPrompt(
  rows: HistoryIndexedRows,
  top: number,
  originalBottom: number,
): Promise<MiddleOutDiskPlan | undefined> {
  let bottom = originalBottom;
  let lastPromptContext: string | undefined;
  const injection: IContent[] = [];
  const index = await lastHumanIndex(rows);
  if (index >= 0) {
    const text = extractText(await rows.readRow(index));
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

function hasStateSnapshot(row: IContent): boolean {
  return row.blocks.some(
    (block) => block.type === 'text' && block.text.includes('<state_snapshot>'),
  );
}

function summaryTriggerRow(priorSnapshot: boolean): IContent {
  return {
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
}

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
  const scope = new HistoryReaderScope(
    'Compression request selection is closed',
  );
  const tail = [...injections, ...plan.injection];
  const promptRow: IContent = {
    speaker: 'human',
    blocks: [{ type: 'text', text: prompt }],
  };
  const count = SUMMARY_FRAME_ROWS + (plan.bottom - plan.top) + tail.length;
  const journalEnd = 2 + (plan.bottom - plan.top);
  const sanitizedAt = async (journalIndex: number): Promise<IContent> =>
    sanitizeHistoryForCompression([await rows.readRow(journalIndex)])[0];
  // The trigger row depends on every journal row, so a random read of it scans
  // the journal once; the answer is kept for later reads.
  let scannedSnapshot: boolean | undefined;
  const journalHasSnapshot = async (signal?: AbortSignal): Promise<boolean> => {
    if (scannedSnapshot !== undefined) return scannedSnapshot;
    let found = false;
    for (let index = plan.top; index < plan.bottom && !found; index++) {
      signal?.throwIfAborted();
      found = hasStateSnapshot(await rows.readRow(index));
    }
    scannedSnapshot = found;
    return found;
  };
  async function* readRows(
    signal?: AbortSignal,
  ): AsyncGenerator<IContent, void, unknown> {
    signal?.throwIfAborted();
    yield COMPRESSION_SECURITY_PREAMBLE;
    yield promptRow;
    let priorSnapshot = false;
    for (let index = plan.top; index < plan.bottom; index++) {
      signal?.throwIfAborted();
      const row = await rows.readRow(index);
      signal?.throwIfAborted();
      priorSnapshot ||= hasStateSnapshot(row);
      const sanitized = sanitizeHistoryForCompression([row])[0];
      ownership.retain(sanitized);
      try {
        yield sanitized;
      } finally {
        ownership.release(sanitized);
      }
    }
    yield* tail;
    yield summaryTriggerRow(priorSnapshot);
  }
  return {
    count,
    openReader: (signal) => scope.open(readRows(signal)),
    readAt(index, signal) {
      return scope.read(async () => {
        signal?.throwIfAborted();
        assertRowIndex(index, count);
        if (index === 0) return COMPRESSION_SECURITY_PREAMBLE;
        if (index === 1) return promptRow;
        if (index < journalEnd) {
          const row = await sanitizedAt(plan.top + index - 2);
          signal?.throwIfAborted();
          return row;
        }
        if (index < count - 1) return tail[index - journalEnd];
        const found = await journalHasSnapshot(signal);
        signal?.throwIfAborted();
        return summaryTriggerRow(found);
      });
    },
    close: () => scope.close(),
  };
}
