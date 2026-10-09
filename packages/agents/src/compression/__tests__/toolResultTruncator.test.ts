/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { collectRawHistory } from '@vybestack/llxprt-code-test-utils/core/collect-raw-history.js';
import { describe, it, expect, beforeEach } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type {
  IContent,
  ToolResponseBlock,
  ContentBlock,
  ToolCallBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  noopLogger,
  makeToolResponse,
  makeToolResponseEntry,
  makeTextEntry,
  estimateBlockByLength,
  buildTruncatorDeps,
  densityFixture5_buildUnifiedDeps,
} from './tool-truncation-test-fixtures.js';
import {
  rankToolResponses,
  createTruncationStub,
  truncateLargestToolResponses,
  truncateOversizedToolResponsesUnified,
  isAlreadyStubbed,
  CONTEXT_TRUNCATION_MARKER,
  fallbackEstimateBlockTokens,
} from '../toolResultTruncator.js';

const densityFixture1_observeRanksByModelDependentTokenizationWhenEstimatorVariesByModel =
  async () => {
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

    return { modelARanked, modelBRanked };
  };

let densityFixture2_historyService: HistoryService;

const densityFixture3_observeUsesModelDependentTokenizationToSelectTheFattestCandidateFirst =
  async () => {
    densityFixture2_historyService.add(
      makeToolResponseEntry('call-a', 'tool', 'aaa'),
    );
    densityFixture2_historyService.add(
      makeToolResponseEntry('call-b', 'tool', 'bbbbb'),
    );
    await densityFixture2_historyService.waitForTokenUpdates();

    // Under this model's tokenization, "aaa" is the fattest candidate.
    // The truncator should stub call-a first. After that, "bbbbb" is
    // still present but the limit is generous enough to stop.
    const result = await truncateLargestToolResponses(
      buildTruncatorDeps(densityFixture2_historyService, {
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
        computeProjected: async () => {
          const raw = await collectRawHistory(densityFixture2_historyService);
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

    const raw = await collectRawHistory(densityFixture2_historyService);
    const stubbedCallIds = raw
      .flatMap((e) => e.blocks)
      .filter(
        (b): b is ToolResponseBlock =>
          b.type === 'tool_response' && isAlreadyStubbed(b),
      )
      .map((b) => b.callId);

    return { result, stubbedCallIds };
  };

let densityFixture4_historyService: HistoryService;

const densityFixture6_observeAbortsSafelyWhenHistoryIsConcurrentlyClearedDuringAsyncEstimates =
  async () => {
    densityFixture4_historyService.add(
      makeToolResponseEntry('call-hist', 'tool', 'x'.repeat(4000)),
    );
    await densityFixture4_historyService.waitForTokenUpdates();

    let estimateCallCount = 0;
    const deps = {
      historyService: densityFixture4_historyService,
      logger: noopLogger,
      pendingContents: [] as IContent[],
      estimateBlockTokensAsync: async (block: ContentBlock) => {
        estimateCallCount++;
        // On the first block estimate, simulate a concurrent clear.
        if (estimateCallCount === 1) {
          densityFixture4_historyService.clear();
        }
        return estimateBlockByLength(block);
      },
      computeProjected: async () => {
        let total = 0;
        for (const entry of await collectRawHistory(
          densityFixture4_historyService,
        )) {
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

    // History was cleared concurrently — our guard prevented operating
    // on stale indices.

    return { result };
  };

const densityFixture7_observeAbortsSafelyWhenHistoryIsConcurrentlyAddedToDuringAsyncEstimates =
  async () => {
    densityFixture4_historyService.add(
      makeToolResponseEntry('call-hist', 'tool', 'x'.repeat(4000)),
    );
    await densityFixture4_historyService.waitForTokenUpdates();

    let estimateCallCount = 0;
    const deps = {
      historyService: densityFixture4_historyService,
      logger: noopLogger,
      pendingContents: [] as IContent[],
      estimateBlockTokensAsync: async (block: ContentBlock) => {
        estimateCallCount++;
        // On the first estimate, simulate a concurrent add.
        if (estimateCallCount === 1) {
          densityFixture4_historyService.add(
            makeTextEntry('human', 'concurrent add'),
          );
        }
        return estimateBlockByLength(block);
      },
      computeProjected: async () => {
        let total = 0;
        for (const entry of await collectRawHistory(
          densityFixture4_historyService,
        )) {
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

    // The concurrent add should be visible.

    return { result };
  };

describe('createTruncationStub', () => {
  it('preserves callId, toolName, and type for successful responses', () => {
    const original = makeToolResponse('call-1', 'read_file', 'huge content');
    const stub = createTruncationStub(original, 5000);

    expect(stub.type).toBe('tool_response');
    expect(stub.callId).toBe('call-1');
    expect(stub.toolName).toBe('read_file');
  });

  it('produces a result string without error for successful responses', () => {
    expect(observeDensityCase8()).toContain('successfully');
  });

  it('marks the stub with context truncation providerMetadata', () => {
    const original = makeToolResponse('call-1', 'read_file', 'huge content');
    const stub = createTruncationStub(original, 5000);

    expect(stub.providerMetadata?.[CONTEXT_TRUNCATION_MARKER]).toBe(true);
  });

  it('retains failure semantics for error responses', () => {
    expect(observeDensityCase9()).toContain('failed');
  });

  it('includes original token count in the stub message', () => {
    const original = makeToolResponse('call-1', 'read_file', 'content');
    const stub = createTruncationStub(original, 12345);

    expect(stub.result as string).toContain('12345');
  });

  it('preserves existing providerMetadata from the original', () => {
    expect(observeDensityCase10()).toBe(true);
  });

  it('produces a bounded stub with no original payload content', () => {
    expect(observeDensityCase11()).toBeLessThan(300);
  });
});

describe('isAlreadyStubbed', () => {
  it('returns false for a normal tool response', () => {
    const block = makeToolResponse('call-1', 'read_file', 'content');
    expect(isAlreadyStubbed(block)).toBe(false);
  });

  it('returns true for a block with the context truncation marker', () => {
    expect(observeDensityCase12()).toBe(true);
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
    const { actual, expected0 } = await observeDensityCase13();
    expect(actual).toStrictEqual(expected0);
  });

  it('ranks largest tool response first', async () => {
    expect(await observeDensityCase14()).toBe('call-1');
  });

  it('breaks ties by recency (most recent first)', async () => {
    expect(await observeDensityCase15()).toBe('call-old');
  });

  it('skips already-stubbed blocks', async () => {
    expect(await observeDensityCase16()).toBe('call-live');
  });

  it('reports correct entryIndex and blockIndex', async () => {
    expect(await observeDensityCase17()).toBe(0);
  });

  it('handles multiple tool_response blocks in a single entry', async () => {
    expect(await observeDensityCase18()).toBe(1);
  });

  it('ranks by model-dependent tokenization when estimator varies by model', async () => {
    const { modelARanked, modelBRanked } =
      await densityFixture1_observeRanksByModelDependentTokenizationWhenEstimatorVariesByModel();
    expect(modelARanked[0].block.callId).toBe('call-a');
    expect(modelBRanked[0].block.callId).toBe('call-b');
  });
});

describe('truncateLargestToolResponses', () => {
  beforeEach(() => {
    densityFixture2_historyService = new HistoryService();
  });

  it('recovers by truncating the fattest tool response under the limit', async () => {
    expect(await observeDensityCase19()).toBe(true);
  });

  it('stops immediately once under the limit (minimal replacements)', async () => {
    expect(await observeDensityCase20()).toBe(false);
  });

  it('replaces multiple responses when one is not enough', async () => {
    densityFixture2_historyService.add(
      makeToolResponseEntry('call-1', 'read_file', 'x'.repeat(4000)),
    );
    densityFixture2_historyService.add(
      makeToolResponseEntry('call-2', 'read_file', 'y'.repeat(4000)),
    );
    await densityFixture2_historyService.waitForTokenUpdates();

    const result = await truncateLargestToolResponses(
      buildTruncatorDeps(densityFixture2_historyService),
      100,
    );

    expect(result.success).toBe(true);
    expect(result.replacedCount).toBe(2);

    const raw = await collectRawHistory(densityFixture2_historyService);
    const allToolResponses = raw
      .flatMap((e) => e.blocks)
      .filter((b): b is ToolResponseBlock => b.type === 'tool_response');
    expect(allToolResponses).toHaveLength(2);
    for (const block of allToolResponses) {
      expect(isAlreadyStubbed(block)).toBe(true);
    }
  });

  it('returns failure when no tool responses exist', async () => {
    expect(await observeDensityCase21()).toBe(0);
  });

  it('returns failure when all candidates exhausted and still over limit', async () => {
    expect(await observeDensityCase22()).toBe(true);
  });

  it('preserves callId and toolName in the stub after replacement', async () => {
    expect(await observeDensityCase23()).toBe('my_tool');
  });

  it('skips already-stubbed responses on subsequent passes', async () => {
    expect(await observeDensityCase24()).toBe(0);
  });

  it('retains failure semantics when truncating an error tool result', async () => {
    expect(await observeDensityCase25()).toContain('failed');
  });

  it('uses fresh token baseline from HistoryService after replacement', async () => {
    const { actual, expected0 } = await observeDensityCase26();
    expect(actual).toBeLessThan(expected0);
  });

  it('uses model-dependent tokenization to select the fattest candidate first', async () => {
    const { result, stubbedCallIds } =
      await densityFixture3_observeUsesModelDependentTokenizationToSelectTheFattestCandidateFirst();
    expect(result.success).toBe(true);
    expect(result.replacedCount).toBe(1);
    expect(stubbedCallIds).toContain('call-a');
    expect(stubbedCallIds).not.toContain('call-b');
  });
});

describe('truncateOversizedToolResponsesUnified — pending + history (issue #1321)', () => {
  beforeEach(() => {
    densityFixture4_historyService = new HistoryService();
  });

  it('truncates a pending-only tool response when history is empty (turn-1)', async () => {
    expect(await observeDensityCase27()).toBe(0);
  });

  it('ranks history + pending together and truncates the largest regardless of location', async () => {
    expect(await observeDensityCase28()).toBe(false);
  });

  it('truncates history tool response when it is the largest', async () => {
    expect(await observeDensityCase29()).toBe(false);
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
    const deps = densityFixture5_buildUnifiedDeps(
      densityFixture4_historyService,
      {
        pendingContents: pending,
      },
    );

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
    expect(await observeDensityCase30()).toBe(999999);
  });

  it('immutably replaces pending candidates without mutating the original array', async () => {
    const { actual, expected0 } = await observeDensityCase31();
    expect(actual).toBe(expected0);
  });

  it('re-estimates after every replacement and stops at minimal replacements', async () => {
    expect(await observeDensityCase32()).toBe(1);
  });

  it('aborts safely when history is concurrently cleared during async estimates', async () => {
    const { result } =
      await densityFixture6_observeAbortsSafelyWhenHistoryIsConcurrentlyClearedDuringAsyncEstimates();
    expect(result.success).toBe(false);
    expect(result.replacedCount).toBe(0);
    expect(
      (await collectRawHistory(densityFixture4_historyService)).length,
    ).toBe(0);
  });

  it('aborts safely when history is concurrently added to during async estimates', async () => {
    const { result } =
      await densityFixture7_observeAbortsSafelyWhenHistoryIsConcurrentlyAddedToDuringAsyncEstimates();
    expect(result.success).toBe(false);
    expect(result.replacedCount).toBe(0);
    expect(
      (await collectRawHistory(densityFixture4_historyService)).length,
    ).toBe(2);
  });
});

function observeDensityCase8() {
  const original = makeToolResponse('call-1', 'read_file', 'huge content');
  const stub = createTruncationStub(original, 5000);

  expect(stub.error).toBeUndefined();
  expect(typeof stub.result).toBe('string');
  expect(stub.result as string).toContain('truncated');

  return stub.result as string;
}

function observeDensityCase9() {
  const original = makeToolResponse(
    'call-2',
    'shell',
    'some result',
    'huge error text'.repeat(1000),
  );
  const stub = createTruncationStub(original, 8000);

  expect(stub.error).toBeDefined();
  expect(typeof stub.result).toBe('object');

  return stub.error as string;
}

function observeDensityCase10() {
  const original: ToolResponseBlock = {
    type: 'tool_response',
    callId: 'call-1',
    toolName: 'read_file',
    result: 'content',
    providerMetadata: { customKey: 'customValue' },
  };
  const stub = createTruncationStub(original, 5000);

  expect(stub.providerMetadata?.customKey).toBe('customValue');

  return stub.providerMetadata?.[CONTEXT_TRUNCATION_MARKER];
}

function observeDensityCase11() {
  const original = makeToolResponse(
    'call-1',
    'read_file',
    'SECRET-LEAK-PAYLOAD',
  );
  const stub = createTruncationStub(original, 9999);

  const stubResult = stub.result as string;
  expect(stubResult).not.toContain('SECRET-LEAK-PAYLOAD');

  return stubResult.length;
}

function observeDensityCase12() {
  const block: ToolResponseBlock = {
    type: 'tool_response',
    callId: 'call-1',
    toolName: 'read_file',
    result: 'stub',
    providerMetadata: { [CONTEXT_TRUNCATION_MARKER]: true },
  };

  return isAlreadyStubbed(block);
}

async function observeDensityCase13() {
  const history: IContent[] = [
    makeTextEntry('human', 'hello'),
    makeTextEntry('ai', 'hi'),
  ];

  return {
    actual: await rankToolResponses(history, async (b) =>
      estimateBlockByLength(b),
    ),
    expected0: [],
  };
}

async function observeDensityCase14() {
  const history: IContent[] = [
    makeToolResponseEntry('call-1', 'read_file', 'small'),
    makeToolResponseEntry('call-2', 'read_file', 'massive content here'),
  ];
  const ranked = await rankToolResponses(history, async (b) =>
    estimateBlockByLength(b),
  );

  expect(ranked[0].block.callId).toBe('call-2');

  return ranked[1].block.callId;
}

async function observeDensityCase15() {
  const sameSizeResult = 'exactly the same size';
  const history: IContent[] = [
    makeToolResponseEntry('call-old', 'read_file', sameSizeResult),
    makeToolResponseEntry('call-new', 'read_file', sameSizeResult),
  ];
  const ranked = await rankToolResponses(history, async (b) =>
    estimateBlockByLength(b),
  );

  expect(ranked[0].block.callId).toBe('call-new');

  return ranked[1].block.callId;
}

async function observeDensityCase16() {
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

  return ranked[0].block.callId;
}

async function observeDensityCase17() {
  const history: IContent[] = [
    makeTextEntry('human', 'q'),
    makeToolResponseEntry('call-1', 'read_file', 'content here'),
  ];
  const ranked = await rankToolResponses(history, async (b) =>
    estimateBlockByLength(b),
  );

  expect(ranked[0].entryIndex).toBe(1);

  return ranked[0].blockIndex;
}

async function observeDensityCase18() {
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

  return ranked[0].blockIndex;
}

async function observeDensityCase19() {
  const bigResult = 'x'.repeat(4000);
  densityFixture2_historyService.add(makeTextEntry('human', 'hello'));
  densityFixture2_historyService.add(
    makeToolResponseEntry('call-1', 'read_file', bigResult),
  );
  await densityFixture2_historyService.waitForTokenUpdates();

  const result = await truncateLargestToolResponses(
    buildTruncatorDeps(densityFixture2_historyService),
    100,
  );

  expect(result.success).toBe(true);
  expect(result.replacedCount).toBe(1);

  const raw = await collectRawHistory(densityFixture2_historyService);
  const block = raw[1].blocks[0] as ToolResponseBlock;

  return isAlreadyStubbed(block);
}

async function observeDensityCase20() {
  densityFixture2_historyService.add(
    makeToolResponseEntry('call-big', 'read_file', 'x'.repeat(4000)),
  );
  densityFixture2_historyService.add(
    makeToolResponseEntry('call-small', 'read_file', 'y'.repeat(100)),
  );
  await densityFixture2_historyService.waitForTokenUpdates();

  const result = await truncateLargestToolResponses(
    buildTruncatorDeps(densityFixture2_historyService),
    100,
  );

  expect(result.success).toBe(true);
  expect(result.replacedCount).toBe(1);

  const raw = await collectRawHistory(densityFixture2_historyService);
  const bigBlock = raw[0].blocks[0] as ToolResponseBlock;
  const smallBlock = raw[1].blocks[0] as ToolResponseBlock;
  expect(isAlreadyStubbed(bigBlock)).toBe(true);

  return isAlreadyStubbed(smallBlock);
}

async function observeDensityCase21() {
  densityFixture2_historyService.add(makeTextEntry('human', 'hello'));
  await densityFixture2_historyService.waitForTokenUpdates();

  const result = await truncateLargestToolResponses(
    buildTruncatorDeps(densityFixture2_historyService, {
      computeProjected: () => 10000,
    }),
    50,
  );

  expect(result.success).toBe(false);

  return result.replacedCount;
}

async function observeDensityCase22() {
  densityFixture2_historyService.add(
    makeToolResponseEntry('call-1', 'read_file', 'small'),
  );
  await densityFixture2_historyService.waitForTokenUpdates();

  const result = await truncateLargestToolResponses(
    buildTruncatorDeps(densityFixture2_historyService, {
      computeProjected: () => 100000,
    }),
    50,
  );

  expect(result.success).toBe(false);
  expect(result.replacedCount).toBe(1);

  const raw = await collectRawHistory(densityFixture2_historyService);
  const block = raw[0].blocks[0] as ToolResponseBlock;

  return isAlreadyStubbed(block);
}

async function observeDensityCase23() {
  densityFixture2_historyService.add(
    makeToolResponseEntry('call-42', 'my_tool', 'x'.repeat(4000)),
  );
  await densityFixture2_historyService.waitForTokenUpdates();

  await truncateLargestToolResponses(
    buildTruncatorDeps(densityFixture2_historyService),
    50,
  );

  const raw = await collectRawHistory(densityFixture2_historyService);
  const block = raw[0].blocks[0] as ToolResponseBlock;
  expect(block.type).toBe('tool_response');
  expect(block.callId).toBe('call-42');

  return block.toolName;
}

async function observeDensityCase24() {
  densityFixture2_historyService.add(
    makeToolResponseEntry('call-1', 'read_file', 'x'.repeat(4000)),
  );
  await densityFixture2_historyService.waitForTokenUpdates();

  const deps = buildTruncatorDeps(densityFixture2_historyService);
  const first = await truncateLargestToolResponses(deps, 50);
  expect(first.success).toBe(true);

  const second = await truncateLargestToolResponses(
    { ...deps, computeProjected: () => 100000 },
    50,
  );
  expect(second.success).toBe(false);

  return second.replacedCount;
}

async function observeDensityCase25() {
  const hugeError = 'e'.repeat(4000);
  densityFixture2_historyService.add(
    makeToolResponseEntry('call-err', 'shell', 'result', hugeError),
  );
  await densityFixture2_historyService.waitForTokenUpdates();

  await truncateLargestToolResponses(
    buildTruncatorDeps(densityFixture2_historyService),
    50,
  );

  const raw = await collectRawHistory(densityFixture2_historyService);
  const block = raw[0].blocks[0] as ToolResponseBlock;
  expect(block.error).toBeDefined();

  return block.error as string;
}

async function observeDensityCase26() {
  densityFixture2_historyService.add(
    makeToolResponseEntry('call-1', 'read_file', 'x'.repeat(4000)),
  );
  await densityFixture2_historyService.waitForTokenUpdates();

  const tokensBefore = densityFixture2_historyService.getTotalTokens();

  await truncateLargestToolResponses(
    buildTruncatorDeps(densityFixture2_historyService),
    50,
  );

  await densityFixture2_historyService.waitForTokenUpdates();
  const tokensAfter = densityFixture2_historyService.getTotalTokens();

  return { actual: tokensAfter, expected0: tokensBefore };
}

async function observeDensityCase27() {
  const pendingToolResponse = makeToolResponseEntry(
    'call-pending',
    'read_file',
    'x'.repeat(4000),
  );
  const deps = densityFixture5_buildUnifiedDeps(
    densityFixture4_historyService,
    {
      pendingContents: [pendingToolResponse],
    },
  );

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

  return (await collectRawHistory(densityFixture4_historyService)).length;
}

async function observeDensityCase28() {
  // History has a smaller tool response, pending has a larger one.
  densityFixture4_historyService.add(
    makeToolResponseEntry('call-hist', 'read_file', 'y'.repeat(500)),
  );
  await densityFixture4_historyService.waitForTokenUpdates();

  const pendingToolResponse = makeToolResponseEntry(
    'call-pending',
    'read_file',
    'x'.repeat(4000),
  );
  const deps = densityFixture5_buildUnifiedDeps(
    densityFixture4_historyService,
    {
      pendingContents: [pendingToolResponse],
    },
  );

  const result = await truncateOversizedToolResponsesUnified(deps, 200);

  expect(result.success).toBe(true);
  expect(result.replacedCount).toBe(1);

  // The pending (larger) one should be truncated, not the history one.
  const pendingBlock = result.transformedPending![0]
    .blocks[0] as ToolResponseBlock;
  expect(isAlreadyStubbed(pendingBlock)).toBe(true);

  // The history one should NOT be stubbed.
  const histBlock = (await collectRawHistory(densityFixture4_historyService))[0]
    .blocks[0] as ToolResponseBlock;

  return isAlreadyStubbed(histBlock);
}

async function observeDensityCase29() {
  // History has the larger tool response.
  densityFixture4_historyService.add(
    makeToolResponseEntry('call-hist', 'read_file', 'x'.repeat(4000)),
  );
  await densityFixture4_historyService.waitForTokenUpdates();

  const pendingToolResponse = makeToolResponseEntry(
    'call-pending',
    'read_file',
    'y'.repeat(50),
  );
  const deps = densityFixture5_buildUnifiedDeps(
    densityFixture4_historyService,
    {
      pendingContents: [pendingToolResponse],
    },
  );

  const result = await truncateOversizedToolResponsesUnified(deps, 200);

  expect(result.success).toBe(true);
  expect(result.replacedCount).toBe(1);

  // The history (larger) one should be truncated.
  const histBlock = (await collectRawHistory(densityFixture4_historyService))[0]
    .blocks[0] as ToolResponseBlock;
  expect(isAlreadyStubbed(histBlock)).toBe(true);

  // The pending one should NOT be stubbed.
  const pendingBlock = result.transformedPending![0]
    .blocks[0] as ToolResponseBlock;

  return isAlreadyStubbed(pendingBlock);
}

async function observeDensityCase30() {
  densityFixture4_historyService.add(
    makeToolResponseEntry('call-1', 'tool', 'small'),
  );
  await densityFixture4_historyService.waitForTokenUpdates();

  const deps = densityFixture5_buildUnifiedDeps(
    densityFixture4_historyService,
    {
      pendingContents: [makeToolResponseEntry('call-p', 'tool', 'also small')],
      computeProjected: async () => 999999,
    },
  );

  const result = await truncateOversizedToolResponsesUnified(deps, 50);

  expect(result.success).toBe(false);
  expect(result.replacedCount).toBe(2);

  return result.projected;
}

async function observeDensityCase31() {
  const originalPending = makeToolResponseEntry(
    'call-1',
    'read_file',
    'x'.repeat(4000),
  );
  const deps = densityFixture5_buildUnifiedDeps(
    densityFixture4_historyService,
    {
      pendingContents: [originalPending],
    },
  );

  await truncateOversizedToolResponsesUnified(deps, 100);

  // The original pending entry should be untouched.
  const originalBlock = originalPending.blocks[0] as ToolResponseBlock;
  expect(isAlreadyStubbed(originalBlock)).toBe(false);

  return { actual: originalBlock.result, expected0: 'x'.repeat(4000) };
}

async function observeDensityCase32() {
  densityFixture4_historyService.add(
    makeToolResponseEntry('call-hist-big', 'tool', 'x'.repeat(4000)),
  );
  await densityFixture4_historyService.waitForTokenUpdates();

  const deps = densityFixture5_buildUnifiedDeps(
    densityFixture4_historyService,
    {
      pendingContents: [
        makeToolResponseEntry('call-pending-big', 'tool', 'y'.repeat(4000)),
        makeToolResponseEntry('call-pending-small', 'tool', 'z'.repeat(50)),
      ],
    },
  );

  // History big ≈1000 tokens, pending big ≈1000 tokens, pending small ≈13.
  // Truncating the biggest (1000→~50 tokens) leaves ~1063 total.
  // Set the limit to 1100 so ONE truncation is enough.
  const result = await truncateOversizedToolResponsesUnified(deps, 1100);

  expect(result.success).toBe(true);

  return result.replacedCount;
}
