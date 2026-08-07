/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for tool-response truncation concurrency guards
 * (issue #1321). These tests verify that both the unified and legacy
 * truncation paths correctly STOP processing (not just skip) when
 * history is concurrently mutated, preventing stale-index corruption.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type {
  IContent,
  ToolResponseBlock,
  ContentBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import {
  truncateLargestToolResponses,
  truncateOversizedToolResponsesUnified,
} from '../toolResultTruncator.js';

function makeToolResponse(
  callId: string,
  toolName: string,
  result: string,
): ToolResponseBlock {
  return { type: 'tool_response', callId, toolName, result };
}

function makeToolResponseEntry(
  callId: string,
  toolName: string,
  result: string,
): IContent {
  return {
    speaker: 'tool',
    blocks: [makeToolResponse(callId, toolName, result)],
  };
}

function makeTextEntry(speaker: IContent['speaker'], text: string): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

function estimateBlockByLength(block: ContentBlock): number {
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

const noopLogger = new DebugLogger('test');

function buildTruncatorDeps(
  historyService: HistoryService,
  opts?: {
    computeProjected?: () => number;
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
      (() => {
        const raw = historyService.getRawHistory();
        let total = 0;
        for (const entry of raw) {
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

describe('Unified truncation actually stops on concurrent history mutation (issue #1321)', () => {
  let historyService: HistoryService;

  beforeEach(() => {
    historyService = new HistoryService();
  });

  it('stops the loop (not skips) when history is mutated mid-replacement', async () => {
    historyService.add(
      makeToolResponseEntry('call-1', 'tool', 'x'.repeat(4000)),
    );
    historyService.add(
      makeToolResponseEntry('call-2', 'tool', 'y'.repeat(4000)),
    );
    await historyService.waitForTokenUpdates();

    let projectionCallCount = 0;
    const deps = {
      historyService,
      logger: noopLogger,
      pendingContents: [] as IContent[],
      estimateBlockTokensAsync: async (block: ContentBlock) =>
        estimateBlockByLength(block),
      computeProjected: async () => {
        projectionCallCount++;
        // On the first projection call (after first replacement succeeds),
        // simulate a concurrent add that changes history length. The guard
        // should detect this on the NEXT candidate and stop immediately.
        if (projectionCallCount === 1) {
          historyService.add(makeTextEntry('human', 'concurrent'));
        }
        let total = 0;
        for (const entry of historyService.getRawHistory()) {
          for (const block of entry.blocks) {
            total += estimateBlockByLength(block);
          }
        }
        return total;
      },
      resetBaseline: () => {},
      getRuntimeModel: () => 'test-model',
    };

    const result = await truncateOversizedToolResponsesUnified(deps, 50);

    expect(result.replacedCount).toBe(1);
    expect(result.success).toBe(false);

    // The loop stopped after detecting the mutation — the second candidate
    // was NOT processed. History grew due to the concurrent add.
    expect(historyService.getRawHistory().length).toBe(3);
  });
});

describe('Legacy truncateLargestToolResponses history guard (issue #1321)', () => {
  let historyService: HistoryService;

  beforeEach(() => {
    historyService = new HistoryService();
  });

  it('aborts safely when history is concurrently cleared during ranking', async () => {
    historyService.add(
      makeToolResponseEntry('call-hist', 'tool', 'x'.repeat(4000)),
    );
    await historyService.waitForTokenUpdates();

    let estimateCallCount = 0;
    const deps = buildTruncatorDeps(historyService, {
      estimateBlockTokensAsync: async (block: ContentBlock) => {
        estimateCallCount++;
        if (estimateCallCount === 1) {
          historyService.clear();
        }
        return estimateBlockByLength(block);
      },
    });

    const result = await truncateLargestToolResponses(deps, 50);

    expect(result.success).toBe(false);
    expect(result.replacedCount).toBe(0);
  });

  it('aborts safely when history is concurrently mutated mid-replacement', async () => {
    historyService.add(
      makeToolResponseEntry('call-1', 'tool', 'x'.repeat(4000)),
    );
    historyService.add(
      makeToolResponseEntry('call-2', 'tool', 'y'.repeat(4000)),
    );
    await historyService.waitForTokenUpdates();

    let projectionCallCount = 0;
    const deps = buildTruncatorDeps(historyService, {
      computeProjected: () => {
        projectionCallCount++;
        // On the first projection call (after first replacement), add an entry.
        if (projectionCallCount === 1) {
          historyService.add(makeTextEntry('human', 'concurrent'));
        }
        let total = 0;
        for (const entry of historyService.getRawHistory()) {
          for (const block of entry.blocks) {
            total += estimateBlockByLength(block);
          }
        }
        return total;
      },
    });

    const result = await truncateLargestToolResponses(deps, 50);

    expect(result.replacedCount).toBe(1);
    expect(result.success).toBe(false);

    // The loop stopped after detecting the mutation — the second candidate
    // was NOT processed. History grew due to the concurrent add.
    expect(historyService.getRawHistory().length).toBe(3);
  });
});
