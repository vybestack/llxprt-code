/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from '../../testApi.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type {
  IContent,
  ToolResponseBlock,
  ContentBlock,
  ToolCallBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import {
  rankToolResponses,
  createTruncationStub,
  truncateLargestToolResponses,
  truncateOversizedToolResponsesUnified,
  isAlreadyStubbed,
  CONTEXT_TRUNCATION_MARKER,
  fallbackEstimateBlockTokens,
} from '../toolResultTruncator.js';

function makeToolResponse(
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

function makeToolResponseEntry(
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
    resetBaseline: opts?.resetBaseline ?? (() => {}),
    getRuntimeModel: opts?.getRuntimeModel ?? (() => 'test-model'),
  };
}

describe('createTruncationStub', () => {
  it('preserves callId, toolName, and type for successful responses', () => {
    const original = makeToolResponse('call-1', 'read_file', 'huge content');
    const stub = createTruncationStub(original, 5000);

    expect(stub.type).toBe('tool_response');
    expect(stub.callId).toBe('call-1');
    expect(stub.toolName).toBe('read_file');
  });

  it('produces a result string without error for successful responses', () => {
    const original = makeToolResponse('call-1', 'read_file', 'huge content');
    const stub = createTruncationStub(original, 5000);

    expect(stub.error).toBeUndefined();
    expect(typeof stub.result).toBe('string');
    expect(stub.result as string).toContain('truncated');
    expect(stub.result as string).toContain('successfully');
  });

  it('marks the stub with context truncation providerMetadata', () => {
    const original = makeToolResponse('call-1', 'read_file', 'huge content');
    const stub = createTruncationStub(original, 5000);

    expect(stub.providerMetadata?.[CONTEXT_TRUNCATION_MARKER]).toBe(true);
  });

  it('retains failure semantics for error responses', () => {
    const original = makeToolResponse(
      'call-2',
      'shell',
      'some result',
      'huge error text'.repeat(1000),
    );
    const stub = createTruncationStub(original, 8000);

    expect(stub.error).toBeDefined();
    expect(typeof stub.result).toBe('object');
    expect(stub.error as string).toContain('failed');
  });

  it('includes original token count in the stub message', () => {
    const original = makeToolResponse('call-1', 'read_file', 'content');
    const stub = createTruncationStub(original, 12345);

    expect(stub.result as string).toContain('12345');
  });

  it('preserves existing providerMetadata from the original', () => {
    const original: ToolResponseBlock = {
      type: 'tool_response',
      callId: 'call-1',
      toolName: 'read_file',
      result: 'content',
      providerMetadata: { customKey: 'customValue' },
    };
    const stub = createTruncationStub(original, 5000);

    expect(stub.providerMetadata?.customKey).toBe('customValue');
    expect(stub.providerMetadata?.[CONTEXT_TRUNCATION_MARKER]).toBe(true);
  });

  it('produces a bounded stub with no original payload content', () => {
    const original = makeToolResponse(
      'call-1',
      'read_file',
      'SECRET-LEAK-PAYLOAD',
    );
    const stub = createTruncationStub(original, 9999);

    const stubResult = stub.result as string;
    expect(stubResult).not.toContain('SECRET-LEAK-PAYLOAD');
    expect(stubResult.length).toBeLessThan(300);
  });
});

describe('isAlreadyStubbed', () => {
  it('returns false for a normal tool response', () => {
    const block = makeToolResponse('call-1', 'read_file', 'content');
    expect(isAlreadyStubbed(block)).toBe(false);
  });

  it('returns true for a block with the context truncation marker', () => {
    const block: ToolResponseBlock = {
      type: 'tool_response',
      callId: 'call-1',
      toolName: 'read_file',
      result: 'stub',
      providerMetadata: { [CONTEXT_TRUNCATION_MARKER]: true },
    };
    expect(isAlreadyStubbed(block)).toBe(true);
  });
});

describe('fallbackEstimateBlockTokens', () => {
  it('returns a positive estimate for text blocks', () => {
    const block: ContentBlock = { type: 'text', text: 'hello world' };
    expect(fallbackEstimateBlockTokens(block)).toBeGreaterThan(0);
  });

  it('returns a positive estimate for tool_response blocks', () => {
    const block = makeToolResponse('call-1', 'tool', 'some result');
    expect(fallbackEstimateBlockTokens(block)).toBeGreaterThan(0);
  });

  it('returns 0 for empty text', () => {
    const block: ContentBlock = { type: 'text', text: '' };
    expect(fallbackEstimateBlockTokens(block)).toBe(0);
  });
});

describe('rankToolResponses', () => {
  it('returns an empty array when history has no tool responses', async () => {
    const history: IContent[] = [
      makeTextEntry('human', 'hello'),
      makeTextEntry('ai', 'hi'),
    ];
    expect(
      await rankToolResponses(history, async (b) => estimateBlockByLength(b)),
    ).toStrictEqual([]);
  });

  it('ranks largest tool response first', async () => {
    const history: IContent[] = [
      makeToolResponseEntry('call-1', 'read_file', 'small'),
      makeToolResponseEntry('call-2', 'read_file', 'massive content here'),
    ];
    const ranked = await rankToolResponses(history, async (b) =>
      estimateBlockByLength(b),
    );

    expect(ranked[0].block.callId).toBe('call-2');
    expect(ranked[1].block.callId).toBe('call-1');
  });

  it('breaks ties by recency (most recent first)', async () => {
    const sameSizeResult = 'exactly the same size';
    const history: IContent[] = [
      makeToolResponseEntry('call-old', 'read_file', sameSizeResult),
      makeToolResponseEntry('call-new', 'read_file', sameSizeResult),
    ];
    const ranked = await rankToolResponses(history, async (b) =>
      estimateBlockByLength(b),
    );

    expect(ranked[0].block.callId).toBe('call-new');
    expect(ranked[1].block.callId).toBe('call-old');
  });

  it('skips already-stubbed blocks', async () => {
    const history: IContent[] = [
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call-stubbed',
            toolName: 'read_file',
            result: 'stub',
            providerMetadata: { [CONTEXT_TRUNCATION_MARKER]: true },
          },
        ],
      },
      makeToolResponseEntry('call-live', 'read_file', 'live content'),
    ];
    const ranked = await rankToolResponses(history, async (b) =>
      estimateBlockByLength(b),
    );

    expect(ranked).toHaveLength(1);
    expect(ranked[0].block.callId).toBe('call-live');
  });

  it('reports correct entryIndex and blockIndex', async () => {
    const history: IContent[] = [
      makeTextEntry('human', 'q'),
      makeToolResponseEntry('call-1', 'read_file', 'content here'),
    ];
    const ranked = await rankToolResponses(history, async (b) =>
      estimateBlockByLength(b),
    );

    expect(ranked[0].entryIndex).toBe(1);
    expect(ranked[0].blockIndex).toBe(0);
  });

  it('handles multiple tool_response blocks in a single entry', async () => {
    const history: IContent[] = [
      {
        speaker: 'tool',
        blocks: [
          makeToolResponse('call-a', 'tool', 'tiny'),
          makeToolResponse('call-b', 'tool', 'much larger content block'),
        ],
      },
    ];
    const ranked = await rankToolResponses(history, async (b) =>
      estimateBlockByLength(b),
    );

    expect(ranked).toHaveLength(2);
    expect(ranked[0].block.callId).toBe('call-b');
    expect(ranked[0].blockIndex).toBe(1);
  });

  it('ranks by model-dependent tokenization when estimator varies by model', async () => {
    // Two tool responses: "aaa" and "bbbbb".
    // Under model-A tokenization, "aaa" is fattest.
    // Under model-B tokenization, "bbbbb" is fattest.
    // This proves the ranking is driven by the async estimator, not a
    // static heuristic.
    const history: IContent[] = [
      makeToolResponseEntry('call-a', 'tool', 'aaa'),
      makeToolResponseEntry('call-b', 'tool', 'bbbbb'),
    ];

    const modelARanked = await rankToolResponses(history, async (block) => {
      if (block.type !== 'tool_response') {
        return 0;
      }
      const text = String(block.result);
      if (text === 'aaa') {
        return 1000;
      }
      return 10;
    });
    expect(modelARanked[0].block.callId).toBe('call-a');

    const modelBRanked = await rankToolResponses(history, async (block) => {
      if (block.type !== 'tool_response') {
        return 0;
      }
      const text = String(block.result);
      if (text === 'bbbbb') {
        return 2000;
      }
      return 20;
    });
    expect(modelBRanked[0].block.callId).toBe('call-b');
  });
});

describe('truncateLargestToolResponses', () => {
  let historyService: HistoryService;

  beforeEach(() => {
    historyService = new HistoryService();
  });

  it('recovers by truncating the fattest tool response under the limit', async () => {
    const bigResult = 'x'.repeat(4000);
    historyService.add(makeTextEntry('human', 'hello'));
    historyService.add(makeToolResponseEntry('call-1', 'read_file', bigResult));
    await historyService.waitForTokenUpdates();

    const result = await truncateLargestToolResponses(
      buildTruncatorDeps(historyService),
      100,
    );

    expect(result.success).toBe(true);
    expect(result.replacedCount).toBe(1);

    const raw = historyService.getRawHistory();
    const block = raw[1].blocks[0] as ToolResponseBlock;
    expect(isAlreadyStubbed(block)).toBe(true);
  });

  it('stops immediately once under the limit (minimal replacements)', async () => {
    historyService.add(
      makeToolResponseEntry('call-big', 'read_file', 'x'.repeat(4000)),
    );
    historyService.add(
      makeToolResponseEntry('call-small', 'read_file', 'y'.repeat(100)),
    );
    await historyService.waitForTokenUpdates();

    const result = await truncateLargestToolResponses(
      buildTruncatorDeps(historyService),
      100,
    );

    expect(result.success).toBe(true);
    expect(result.replacedCount).toBe(1);

    const raw = historyService.getRawHistory();
    const bigBlock = raw[0].blocks[0] as ToolResponseBlock;
    const smallBlock = raw[1].blocks[0] as ToolResponseBlock;
    expect(isAlreadyStubbed(bigBlock)).toBe(true);
    expect(isAlreadyStubbed(smallBlock)).toBe(false);
  });

  it('replaces multiple responses when one is not enough', async () => {
    historyService.add(
      makeToolResponseEntry('call-1', 'read_file', 'x'.repeat(4000)),
    );
    historyService.add(
      makeToolResponseEntry('call-2', 'read_file', 'y'.repeat(4000)),
    );
    await historyService.waitForTokenUpdates();

    const result = await truncateLargestToolResponses(
      buildTruncatorDeps(historyService),
      100,
    );

    expect(result.success).toBe(true);
    expect(result.replacedCount).toBe(2);

    const raw = historyService.getRawHistory();
    const allToolResponses = raw
      .flatMap((e) => e.blocks)
      .filter((b): b is ToolResponseBlock => b.type === 'tool_response');
    expect(allToolResponses).toHaveLength(2);
    for (const block of allToolResponses) {
      expect(isAlreadyStubbed(block)).toBe(true);
    }
  });

  it('returns failure when no tool responses exist', async () => {
    historyService.add(makeTextEntry('human', 'hello'));
    await historyService.waitForTokenUpdates();

    const result = await truncateLargestToolResponses(
      buildTruncatorDeps(historyService, { computeProjected: () => 10000 }),
      50,
    );

    expect(result.success).toBe(false);
    expect(result.replacedCount).toBe(0);
  });

  it('returns failure when all candidates exhausted and still over limit', async () => {
    historyService.add(makeToolResponseEntry('call-1', 'read_file', 'small'));
    await historyService.waitForTokenUpdates();

    const result = await truncateLargestToolResponses(
      buildTruncatorDeps(historyService, { computeProjected: () => 100000 }),
      50,
    );

    expect(result.success).toBe(false);
    expect(result.replacedCount).toBe(1);

    const raw = historyService.getRawHistory();
    const block = raw[0].blocks[0] as ToolResponseBlock;
    expect(isAlreadyStubbed(block)).toBe(true);
  });

  it('preserves callId and toolName in the stub after replacement', async () => {
    historyService.add(
      makeToolResponseEntry('call-42', 'my_tool', 'x'.repeat(4000)),
    );
    await historyService.waitForTokenUpdates();

    await truncateLargestToolResponses(buildTruncatorDeps(historyService), 50);

    const raw = historyService.getRawHistory();
    const block = raw[0].blocks[0] as ToolResponseBlock;
    expect(block.type).toBe('tool_response');
    expect(block.callId).toBe('call-42');
    expect(block.toolName).toBe('my_tool');
  });

  it('skips already-stubbed responses on subsequent passes', async () => {
    historyService.add(
      makeToolResponseEntry('call-1', 'read_file', 'x'.repeat(4000)),
    );
    await historyService.waitForTokenUpdates();

    const deps = buildTruncatorDeps(historyService);
    const first = await truncateLargestToolResponses(deps, 50);
    expect(first.success).toBe(true);

    const second = await truncateLargestToolResponses(
      { ...deps, computeProjected: () => 100000 },
      50,
    );
    expect(second.success).toBe(false);
    expect(second.replacedCount).toBe(0);
  });

  it('retains failure semantics when truncating an error tool result', async () => {
    const hugeError = 'e'.repeat(4000);
    historyService.add(
      makeToolResponseEntry('call-err', 'shell', 'result', hugeError),
    );
    await historyService.waitForTokenUpdates();

    await truncateLargestToolResponses(buildTruncatorDeps(historyService), 50);

    const raw = historyService.getRawHistory();
    const block = raw[0].blocks[0] as ToolResponseBlock;
    expect(block.error).toBeDefined();
    expect(block.error as string).toContain('failed');
  });

  it('uses fresh token baseline from HistoryService after replacement', async () => {
    historyService.add(
      makeToolResponseEntry('call-1', 'read_file', 'x'.repeat(4000)),
    );
    await historyService.waitForTokenUpdates();

    const tokensBefore = historyService.getTotalTokens();

    await truncateLargestToolResponses(buildTruncatorDeps(historyService), 50);

    await historyService.waitForTokenUpdates();
    const tokensAfter = historyService.getTotalTokens();

    expect(tokensAfter).toBeLessThan(tokensBefore);
  });

  it('uses model-dependent tokenization to select the fattest candidate first', async () => {
    historyService.add(makeToolResponseEntry('call-a', 'tool', 'aaa'));
    historyService.add(makeToolResponseEntry('call-b', 'tool', 'bbbbb'));
    await historyService.waitForTokenUpdates();

    // Under this model's tokenization, "aaa" is the fattest candidate.
    // The truncator should stub call-a first. After that, "bbbbb" is
    // still present but the limit is generous enough to stop.
    const result = await truncateLargestToolResponses(
      buildTruncatorDeps(historyService, {
        estimateBlockTokensAsync: async (block) => {
          if (block.type !== 'tool_response') {
            return 1;
          }
          const text = String(block.result);
          if (text === 'aaa') {
            return 5000;
          }
          return 10;
        },
        computeProjected: () => {
          const raw = historyService.getRawHistory();
          const toolResponses = raw
            .flatMap((e) => e.blocks)
            .filter((b): b is ToolResponseBlock => b.type === 'tool_response');
          let total = 0;
          for (const block of toolResponses) {
            const text = String(block.result);
            total += text === 'aaa' ? 5000 : 10;
          }
          return total;
        },
      }),
      50,
    );

    expect(result.success).toBe(true);
    expect(result.replacedCount).toBe(1);

    const raw = historyService.getRawHistory();
    const stubbedCallIds = raw
      .flatMap((e) => e.blocks)
      .filter(
        (b): b is ToolResponseBlock =>
          b.type === 'tool_response' && isAlreadyStubbed(b),
      )
      .map((b) => b.callId);
    expect(stubbedCallIds).toContain('call-a');
    expect(stubbedCallIds).not.toContain('call-b');
  });
});

describe('truncateOversizedToolResponsesUnified — pending + history (issue #1321)', () => {
  let historyService: HistoryService;

  beforeEach(() => {
    historyService = new HistoryService();
  });

  function buildUnifiedDeps(
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
          for (const entry of hs.getRawHistory()) {
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

  it('truncates a pending-only tool response when history is empty (turn-1)', async () => {
    const pendingToolResponse = makeToolResponseEntry(
      'call-pending',
      'read_file',
      'x'.repeat(4000),
    );
    const deps = buildUnifiedDeps(historyService, {
      pendingContents: [pendingToolResponse],
    });

    const result = await truncateOversizedToolResponsesUnified(deps, 100);

    expect(result.success).toBe(true);
    expect(result.replacedCount).toBe(1);
    expect(result.transformedPending).toBeDefined();
    expect(result.transformedPending!.length).toBe(1);

    const pendingBlock = result.transformedPending![0]
      .blocks[0] as ToolResponseBlock;
    expect(isAlreadyStubbed(pendingBlock)).toBe(true);
    expect(pendingBlock.callId).toBe('call-pending');
    expect(pendingBlock.toolName).toBe('read_file');

    // History should be untouched — no entries.
    expect(historyService.getRawHistory().length).toBe(0);
  });

  it('ranks history + pending together and truncates the largest regardless of location', async () => {
    // History has a smaller tool response, pending has a larger one.
    historyService.add(
      makeToolResponseEntry('call-hist', 'read_file', 'y'.repeat(500)),
    );
    await historyService.waitForTokenUpdates();

    const pendingToolResponse = makeToolResponseEntry(
      'call-pending',
      'read_file',
      'x'.repeat(4000),
    );
    const deps = buildUnifiedDeps(historyService, {
      pendingContents: [pendingToolResponse],
    });

    const result = await truncateOversizedToolResponsesUnified(deps, 200);

    expect(result.success).toBe(true);
    expect(result.replacedCount).toBe(1);

    // The pending (larger) one should be truncated, not the history one.
    const pendingBlock = result.transformedPending![0]
      .blocks[0] as ToolResponseBlock;
    expect(isAlreadyStubbed(pendingBlock)).toBe(true);

    // The history one should NOT be stubbed.
    const histBlock = historyService.getRawHistory()[0]
      .blocks[0] as ToolResponseBlock;
    expect(isAlreadyStubbed(histBlock)).toBe(false);
  });

  it('truncates history tool response when it is the largest', async () => {
    // History has the larger tool response.
    historyService.add(
      makeToolResponseEntry('call-hist', 'read_file', 'x'.repeat(4000)),
    );
    await historyService.waitForTokenUpdates();

    const pendingToolResponse = makeToolResponseEntry(
      'call-pending',
      'read_file',
      'y'.repeat(50),
    );
    const deps = buildUnifiedDeps(historyService, {
      pendingContents: [pendingToolResponse],
    });

    const result = await truncateOversizedToolResponsesUnified(deps, 200);

    expect(result.success).toBe(true);
    expect(result.replacedCount).toBe(1);

    // The history (larger) one should be truncated.
    const histBlock = historyService.getRawHistory()[0]
      .blocks[0] as ToolResponseBlock;
    expect(isAlreadyStubbed(histBlock)).toBe(true);

    // The pending one should NOT be stubbed.
    const pendingBlock = result.transformedPending![0]
      .blocks[0] as ToolResponseBlock;
    expect(isAlreadyStubbed(pendingBlock)).toBe(false);
  });

  it('preserves tool-call/response pairing in transformed pending contents', async () => {
    const pending: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call-pending',
            name: 'read_file',
            parameters: {},
          } as ToolCallBlock,
        ],
      },
      makeToolResponseEntry('call-pending', 'read_file', 'x'.repeat(4000)),
    ];
    const deps = buildUnifiedDeps(historyService, {
      pendingContents: pending,
    });

    const result = await truncateOversizedToolResponsesUnified(deps, 100);

    expect(result.success).toBe(true);

    const toolCalls = result
      .transformedPending!.flatMap((c) => c.blocks)
      .filter((b): b is ToolCallBlock => b.type === 'tool_call');
    const toolResponses = result
      .transformedPending!.flatMap((c) => c.blocks)
      .filter((b): b is ToolResponseBlock => b.type === 'tool_response');

    // Every pending tool call must have a matching (stubbed) response.
    for (const tc of toolCalls) {
      const matching = toolResponses.find((tr) => tr.callId === tc.id);
      expect(matching).toBeDefined();
      expect(isAlreadyStubbed(matching!)).toBe(true);
    }
  });

  it('returns failure with final projected count when all candidates are exhausted', async () => {
    historyService.add(makeToolResponseEntry('call-1', 'tool', 'small'));
    await historyService.waitForTokenUpdates();

    const deps = buildUnifiedDeps(historyService, {
      pendingContents: [makeToolResponseEntry('call-p', 'tool', 'also small')],
      computeProjected: async () => 999999,
    });

    const result = await truncateOversizedToolResponsesUnified(deps, 50);

    expect(result.success).toBe(false);
    expect(result.replacedCount).toBe(2);
    expect(result.projected).toBe(999999);
  });

  it('immutably replaces pending candidates without mutating the original array', async () => {
    const originalPending = makeToolResponseEntry(
      'call-1',
      'read_file',
      'x'.repeat(4000),
    );
    const deps = buildUnifiedDeps(historyService, {
      pendingContents: [originalPending],
    });

    await truncateOversizedToolResponsesUnified(deps, 100);

    // The original pending entry should be untouched.
    const originalBlock = originalPending.blocks[0] as ToolResponseBlock;
    expect(isAlreadyStubbed(originalBlock)).toBe(false);
    expect(originalBlock.result).toBe('x'.repeat(4000));
  });

  it('re-estimates after every replacement and stops at minimal replacements', async () => {
    historyService.add(
      makeToolResponseEntry('call-hist-big', 'tool', 'x'.repeat(4000)),
    );
    await historyService.waitForTokenUpdates();

    const deps = buildUnifiedDeps(historyService, {
      pendingContents: [
        makeToolResponseEntry('call-pending-big', 'tool', 'y'.repeat(4000)),
        makeToolResponseEntry('call-pending-small', 'tool', 'z'.repeat(50)),
      ],
    });

    // History big ≈1000 tokens, pending big ≈1000 tokens, pending small ≈13.
    // Truncating the biggest (1000→~50 tokens) leaves ~1063 total.
    // Set the limit to 1100 so ONE truncation is enough.
    const result = await truncateOversizedToolResponsesUnified(deps, 1100);

    expect(result.success).toBe(true);
    expect(result.replacedCount).toBe(1);
  });

  it('aborts safely when history is concurrently cleared during async estimates', async () => {
    historyService.add(
      makeToolResponseEntry('call-hist', 'tool', 'x'.repeat(4000)),
    );
    await historyService.waitForTokenUpdates();

    let estimateCallCount = 0;
    const deps = {
      historyService,
      logger: noopLogger,
      pendingContents: [] as IContent[],
      estimateBlockTokensAsync: async (block: ContentBlock) => {
        estimateCallCount++;
        // On the first block estimate, simulate a concurrent clear.
        if (estimateCallCount === 1) {
          historyService.clear();
        }
        return estimateBlockByLength(block);
      },
      computeProjected: async () => {
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

    // Should not throw, should not corrupt history, and should return
    // a safe result (success false since it aborted before truncating).
    expect(result.success).toBe(false);
    expect(result.replacedCount).toBe(0);
    // History was cleared concurrently — our guard prevented operating
    // on stale indices.
    expect(historyService.getRawHistory().length).toBe(0);
  });

  it('aborts safely when history is concurrently added to during async estimates', async () => {
    historyService.add(
      makeToolResponseEntry('call-hist', 'tool', 'x'.repeat(4000)),
    );
    await historyService.waitForTokenUpdates();

    let estimateCallCount = 0;
    const deps = {
      historyService,
      logger: noopLogger,
      pendingContents: [] as IContent[],
      estimateBlockTokensAsync: async (block: ContentBlock) => {
        estimateCallCount++;
        // On the first estimate, simulate a concurrent add.
        if (estimateCallCount === 1) {
          historyService.add(makeTextEntry('human', 'concurrent add'));
        }
        return estimateBlockByLength(block);
      },
      computeProjected: async () => {
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

    // Should not throw, should not corrupt history by replacing at
    // stale indices.
    expect(result.success).toBe(false);
    expect(result.replacedCount).toBe(0);
    // The concurrent add should be visible.
    expect(historyService.getRawHistory().length).toBe(2);
  });
});
