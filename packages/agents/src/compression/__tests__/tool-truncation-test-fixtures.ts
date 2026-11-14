/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { collectRawHistory } from '@vybestack/llxprt-code-test-utils/core/collect-raw-history.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type {
  IContent,
  ToolResponseBlock,
  ContentBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
export const noopLogger = new DebugLogger('test');
export function makeToolResponse(
  callId: string,
  toolName: string,
  result: string,
  error?: string,
): ToolResponseBlock {
  const block: ToolResponseBlock = {
    type: 'tool_response',
    callId,
    toolName,
    result,
  };
  if (error !== undefined) {
    block.error = error;
  }
  return block;
}

export function makeToolResponseEntry(
  callId: string,
  toolName: string,
  result: string,
  error?: string,
): IContent {
  return {
    speaker: 'tool',
    blocks: [makeToolResponse(callId, toolName, result, error)],
  };
}

export function makeTextEntry(
  speaker: IContent['speaker'],
  text: string,
): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

export function estimateBlockByLength(block: ContentBlock): number {
  if (block.type === 'tool_response') {
    const text =
      typeof block.result === 'string'
        ? block.result
        : (block.error ?? JSON.stringify(block.result ?? ''));
    return Math.ceil(text.length / 4);
  }
  if (block.type === 'text') {
    return Math.ceil(block.text.length / 4);
  }
  return 10;
}

export function buildTruncatorDeps(
  historyService: HistoryService,
  opts?: {
    computeProjected?: () => number | Promise<number>;
    resetBaseline?: () => void;
    getRuntimeModel?: () => string;
    estimateBlockTokensAsync?: (block: ContentBlock) => Promise<number>;
  },
) {
  return {
    historyService,
    logger: noopLogger,
    estimateBlockTokensAsync:
      opts?.estimateBlockTokensAsync ??
      (async (block: ContentBlock) => estimateBlockByLength(block)),
    computeProjected:
      opts?.computeProjected ??
      (async () => {
        const raw = await collectRawHistory(historyService);
        let total = 0;
        for (const entry of raw) {
          for (const block of entry.blocks) {
            total += estimateBlockByLength(block);
          }
        }
        return total;
      }),
    resetBaseline: opts?.resetBaseline ?? (() => {}),
    getRuntimeModel: opts?.getRuntimeModel ?? (() => 'test-model'),
  };
}

export function densityFixture5_buildUnifiedDeps(
  hs: HistoryService,
  opts?: {
    pendingContents?: IContent[];
    computeProjected?: (
      workingPending: readonly IContent[],
    ) => number | Promise<number>;
  },
) {
  const pending = opts?.pendingContents ?? [];
  return {
    historyService: hs,
    logger: noopLogger,
    pendingContents: pending,
    estimateBlockTokensAsync: async (block: ContentBlock) =>
      estimateBlockByLength(block),
    computeProjected:
      opts?.computeProjected ??
      (async (workingPending: readonly IContent[]) => {
        let total = 0;
        for (const entry of await collectRawHistory(hs)) {
          for (const block of entry.blocks) {
            total += estimateBlockByLength(block);
          }
        }
        for (const entry of workingPending) {
          for (const block of entry.blocks) {
            total += estimateBlockByLength(block);
          }
        }
        return total;
      }),
    resetBaseline: () => {},
    getRuntimeModel: () => 'test-model',
  };
}
