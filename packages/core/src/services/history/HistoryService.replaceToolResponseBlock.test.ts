import { collectRowsForAssertions } from '../../test-utils/collect-rows-for-assertions.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { collectRawHistory } from '../../test-utils/collect-raw-history.js';
import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import type { IContent, ToolResponseBlock } from './IContent.js';
import type { RuntimeTokenizerFactory } from '../../runtime/contracts/RuntimeTokenizerFactory.js';

function makeToolResponseEntry(
  callId: string,
  toolName: string,
  result: unknown,
): IContent {
  return {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId,
        toolName,
        result,
      },
    ],
  };
}

function makeTextEntry(speaker: IContent['speaker'], text: string): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

function makeStoredAiEntry(id: string): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text: `answer ${id}` }],
    metadata: {
      id,
      responsesStored: true,
      providerBaseURL: 'https://api.openai.com/v1',
      providerMetadata: { custom: `metadata ${id}` },
    },
  };
}
function createDeferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: () => {
      if (resolvePromise === undefined) {
        throw new Error('Deferred promise was not initialized');
      }
      resolvePromise();
    },
  };
}

let densityFixture1_service: HistoryService;

describe('HistoryService.replaceToolResponseBlock', () => {
  beforeEach(() => {
    densityFixture1_service = new HistoryService();
  });

  it('replaces a tool_response block at the given entry/block indices', async () => {
    const { actual, expected0 } = await observeDensityCase2();
    expect(actual).toBe(expected0);
  });

  it('invalidates stored parents only when replacement rewrites retained provider history', async () => {
    expect(await observeDensityCase3()).toBe('resp-parent');
  });

  it('makes a retained block rewrite and lineage invalidation visible atomically during token recalculation', async () => {
    const { actual } = await observeDensityCase4();
    expect(actual).toBeUndefined();
  });

  it('preserves lineage and token state for a structurally identical replacement', async () => {
    expect(await observeDensityCase5()).toBe(true);
  });

  it('returns false on empty history', async () => {
    expect(await observeDensityCase11()).toBe(false);
  });

  it('returns false when the target block is not a tool_response', async () => {
    expect(await observeDensityCase12()).toBe(false);
  });

  it('returns false when the replacement callId does not match', async () => {
    expect(await observeDensityCase13()).toBe(false);
  });

  it('returns false when the replacement toolName does not match', async () => {
    expect(await observeDensityCase14()).toBe(false);
  });

  it('recalculates total tokens after replacement', async () => {
    const { actual, expected0 } = await observeDensityCase15();
    expect(actual).toBeLessThan(expected0);
  });

  it('does not mutate the original entry object', async () => {
    const { actual, expected0, expected1, blocks, originalBlocksRef } =
      await observeDensityCase16();
    expect(blocks).toBe(originalBlocksRef);
    expect(actual).toHaveProperty(expected0, expected1);
  });

  it('replaces a block at a multi-block entry correctly', async () => {
    const { actual, expected0 } = await observeDensityCase17();
    expect(actual).toBe(expected0);
  });

  it('replaces a block at a later entry index', async () => {
    const { actual, expected0 } = await observeDensityCase18();
    expect(actual).toStrictEqual(expected0);
  });

  it('accepts a model name for token recalculation', async () => {
    const { actual, expected0 } = await observeDensityCase19();
    expect(actual).toBeLessThan(expected0);
  });

  it('returns false when the replacement lacks a type field despite matching callId/toolName', async () => {
    expect(await observeDensityCase20()).toBe('output');
  });

  it('returns false when the replacement has wrong type despite matching callId/toolName', async () => {
    expect(await observeDensityCase21()).toBe('output');
  });

  it('preserves an addition queued during failed replacement rollback', async () => {
    const { actual, expected0 } = await observeDensityCase22();
    expect(actual).toBe(expected0);
  });

  it('applies an addition only after a successful replacement settles', async () => {
    expect(await observeDensityCase23()).toBe(4);
  });

  it('rolls back BOTH history and token accounting when recalculation throws', async () => {
    const { actual, expected0 } = await observeDensityCase24();
    expect(actual).toBe(expected0);
  });
});

async function observeDensityCase2() {
  densityFixture1_service.add(
    makeToolResponseEntry('call-1', 'read_file', 'original'),
  );
  await densityFixture1_service.waitForTokenUpdates();

  const newBlock: ToolResponseBlock = {
    type: 'tool_response',
    callId: 'call-1',
    toolName: 'read_file',
    result: 'replaced',
  };

  const ok = await densityFixture1_service.replaceToolResponseBlock(
    0,
    0,
    newBlock,
  );
  expect(ok).toBe(true);

  const raw = await collectRawHistory(densityFixture1_service);

  return { actual: raw[0].blocks[0], expected0: newBlock };
}

async function observeDensityCase3() {
  const retainedRewrite = new HistoryService();
  retainedRewrite.add(makeStoredAiEntry('resp-1'));
  retainedRewrite.add(
    makeToolResponseEntry('call-retained', 'read_file', 'original'),
  );
  retainedRewrite.add(makeStoredAiEntry('resp-2'));
  await retainedRewrite.waitForTokenUpdates();

  const retainedOk = await retainedRewrite.replaceToolResponseBlock(1, 0, {
    type: 'tool_response',
    callId: 'call-retained',
    toolName: 'read_file',
    result: 'replacement',
  });

  expect(retainedOk).toBe(true);
  expect((await collectRawHistory(retainedRewrite))[0].metadata).toMatchObject({
    id: 'resp-1',
    providerBaseURL: 'https://api.openai.com/v1',
    providerMetadata: { custom: 'metadata resp-1' },
  });
  expect(
    (await collectRawHistory(retainedRewrite))[0].metadata?.responsesStored,
  ).toBeUndefined();
  expect((await collectRawHistory(retainedRewrite))[2].metadata).toMatchObject({
    id: 'resp-2',
    providerBaseURL: 'https://api.openai.com/v1',
    providerMetadata: { custom: 'metadata resp-2' },
  });
  expect(
    (await collectRawHistory(retainedRewrite))[2].metadata?.responsesStored,
  ).toBeUndefined();

  const pendingOnlyRewrite = new HistoryService();
  pendingOnlyRewrite.add(makeStoredAiEntry('resp-parent'));
  pendingOnlyRewrite.add(
    makeToolResponseEntry('call-pending', 'read_file', 'original'),
  );
  await pendingOnlyRewrite.waitForTokenUpdates();

  const pendingOk = await pendingOnlyRewrite.replaceToolResponseBlock(1, 0, {
    type: 'tool_response',
    callId: 'call-pending',
    toolName: 'read_file',
    result: 'replacement',
  });

  expect(pendingOk).toBe(true);
  expect(
    (await collectRawHistory(pendingOnlyRewrite))[0].metadata?.responsesStored,
  ).toBe(true);

  return (await collectRawHistory(pendingOnlyRewrite))[0].metadata?.id;
}

async function observeDensityCase4() {
  densityFixture1_service.add(makeStoredAiEntry('resp-before-rewrite'));
  densityFixture1_service.add(
    makeToolResponseEntry('call-atomic', 'read_file', 'original output'),
  );
  densityFixture1_service.add(makeStoredAiEntry('resp-after-rewrite'));
  await densityFixture1_service.waitForTokenUpdates();

  const recalculationStarted = createDeferred();
  const continueRecalculation = createDeferred();
  const tokenizerFactory: RuntimeTokenizerFactory = {
    getTokenizer: () => ({
      fallbackPolicy: 'deny',
      countTokens: async () => {
        recalculationStarted.resolve();
        await continueRecalculation.promise;
        return 1;
      },
    }),
    estimatePrompt: async (request) => ({
      count: 0,
      method: 'calibrated',
      family: 'history-atomicity-fixture',
      estimatorVersion: '1',
      assetRevision: 'fixture',
      projectionRevision: request.projectionRevision,
    }),
  };
  densityFixture1_service.setTokenizerFactory(tokenizerFactory);

  const replacementPromise = densityFixture1_service.replaceToolResponseBlock(
    1,
    0,
    {
      type: 'tool_response',
      callId: 'call-atomic',
      toolName: 'read_file',
      result: 'replacement output',
    },
  );
  await recalculationStarted.promise;
  const observedDuringRecalculation = await collectRawHistory(
    densityFixture1_service,
  );
  continueRecalculation.resolve();
  await replacementPromise;

  expect(observedDuringRecalculation[1].blocks[0]).toMatchObject({
    type: 'tool_response',
    result: 'replacement output',
  });
  expect(
    observedDuringRecalculation[0].metadata?.responsesStored,
  ).toBeUndefined();

  return { actual: observedDuringRecalculation[2].metadata?.responsesStored };
}

async function observeDensityCase5() {
  const originalBlock: ToolResponseBlock = {
    type: 'tool_response',
    callId: 'call-identical',
    toolName: 'read_file',
    result: { output: ['same', 'structure'] },
  };
  densityFixture1_service.add(makeStoredAiEntry('resp-identical-parent'));
  densityFixture1_service.add({ speaker: 'tool', blocks: [originalBlock] });
  densityFixture1_service.add(makeStoredAiEntry('resp-identical-child'));
  await densityFixture1_service.waitForTokenUpdates();
  let expectedTokens = 0;
  await collectRowsForAssertions(
    densityFixture1_service.streamRawHistory(),
    async (rows) => {
      expectedTokens =
        await densityFixture1_service.estimateTokensForContents(rows);
    },
  );
  let tokenUpdates = 0;
  densityFixture1_service.on('tokensUpdated', () => {
    tokenUpdates += 1;
  });

  const replaced = await densityFixture1_service.replaceToolResponseBlock(
    1,
    0,
    {
      type: 'tool_response',
      callId: 'call-identical',
      toolName: 'read_file',
      result: { output: ['same', 'structure'] },
    },
  );

  expect(replaced).toBe(true);
  expect((await collectRawHistory(densityFixture1_service))[1].blocks[0]).toBe(
    originalBlock,
  );
  expect(densityFixture1_service.getTotalTokens()).toBe(expectedTokens);
  expect(tokenUpdates).toBe(0);
  expect(
    (await collectRawHistory(densityFixture1_service))[0].metadata
      ?.responsesStored,
  ).toBe(true);

  return (await collectRawHistory(densityFixture1_service))[2].metadata
    ?.responsesStored;
}

async function observeDensityCase6() {
  densityFixture1_service.add(makeTextEntry('human', 'hello'));
  await densityFixture1_service.waitForTokenUpdates();

  const ok = await densityFixture1_service.replaceToolResponseBlock(-1, 0, {
    type: 'tool_response',
    callId: 'call-1',
    toolName: 'tool',
    result: 'x',
  });

  return ok;
}

async function observeDensityCase7() {
  densityFixture1_service.add(makeTextEntry('human', 'hello'));
  await densityFixture1_service.waitForTokenUpdates();

  const ok = await densityFixture1_service.replaceToolResponseBlock(0.5, 0, {
    type: 'tool_response',
    callId: 'call-1',
    toolName: 'tool',
    result: 'x',
  });

  return ok;
}

async function observeDensityCase8() {
  densityFixture1_service.add(makeTextEntry('human', 'hello'));
  await densityFixture1_service.waitForTokenUpdates();

  const ok = await densityFixture1_service.replaceToolResponseBlock(10, 0, {
    type: 'tool_response',
    callId: 'call-1',
    toolName: 'tool',
    result: 'x',
  });

  return ok;
}

async function observeDensityCase9() {
  densityFixture1_service.add(
    makeToolResponseEntry('call-1', 'tool', 'output'),
  );
  await densityFixture1_service.waitForTokenUpdates();

  const ok = await densityFixture1_service.replaceToolResponseBlock(0, -1, {
    type: 'tool_response',
    callId: 'call-1',
    toolName: 'tool',
    result: 'x',
  });

  return ok;
}

async function observeDensityCase10() {
  densityFixture1_service.add(
    makeToolResponseEntry('call-1', 'tool', 'output'),
  );
  await densityFixture1_service.waitForTokenUpdates();

  const ok = await densityFixture1_service.replaceToolResponseBlock(0, 10, {
    type: 'tool_response',
    callId: 'call-1',
    toolName: 'tool',
    result: 'x',
  });

  return ok;
}

async function observeDensityCase11() {
  const ok = await densityFixture1_service.replaceToolResponseBlock(0, 0, {
    type: 'tool_response',
    callId: 'call-1',
    toolName: 'tool',
    result: 'x',
  });

  return ok;
}

async function observeDensityCase12() {
  densityFixture1_service.add(makeTextEntry('human', 'hello'));
  await densityFixture1_service.waitForTokenUpdates();

  const ok = await densityFixture1_service.replaceToolResponseBlock(0, 0, {
    type: 'tool_response',
    callId: 'call-1',
    toolName: 'tool',
    result: 'x',
  });

  return ok;
}

async function observeDensityCase13() {
  densityFixture1_service.add(
    makeToolResponseEntry('call-1', 'tool', 'output'),
  );
  await densityFixture1_service.waitForTokenUpdates();

  const ok = await densityFixture1_service.replaceToolResponseBlock(0, 0, {
    type: 'tool_response',
    callId: 'call-MISMATCH',
    toolName: 'tool',
    result: 'x',
  });

  return ok;
}

async function observeDensityCase14() {
  densityFixture1_service.add(
    makeToolResponseEntry('call-1', 'read_file', 'output'),
  );
  await densityFixture1_service.waitForTokenUpdates();

  const ok = await densityFixture1_service.replaceToolResponseBlock(0, 0, {
    type: 'tool_response',
    callId: 'call-1',
    toolName: 'MISMATCH',
    result: 'x',
  });

  return ok;
}

async function observeDensityCase15() {
  densityFixture1_service.add(
    makeToolResponseEntry('call-1', 'read_file', 'x'.repeat(4000)),
  );
  await densityFixture1_service.waitForTokenUpdates();
  const tokensBefore = densityFixture1_service.getTotalTokens();

  await densityFixture1_service.replaceToolResponseBlock(0, 0, {
    type: 'tool_response',
    callId: 'call-1',
    toolName: 'read_file',
    result: 'tiny',
  });
  await densityFixture1_service.waitForTokenUpdates();

  return {
    actual: densityFixture1_service.getTotalTokens(),
    expected0: tokensBefore,
  };
}

async function observeDensityCase16() {
  const entry = makeToolResponseEntry('call-1', 'read_file', 'original');
  densityFixture1_service.add(entry);
  await densityFixture1_service.waitForTokenUpdates();

  const originalBlocksRef = entry.blocks;
  await densityFixture1_service.replaceToolResponseBlock(0, 0, {
    type: 'tool_response',
    callId: 'call-1',
    toolName: 'read_file',
    result: 'replaced',
  });

  return {
    actual: entry.blocks[0],
    expected0: 'result',
    expected1: 'original',
    blocks: entry.blocks,
    originalBlocksRef,
  };
}

async function observeDensityCase17() {
  const entry: IContent = {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'call-1',
        toolName: 'tool-a',
        result: 'first',
      },
      {
        type: 'tool_response',
        callId: 'call-2',
        toolName: 'tool-b',
        result: 'second',
      },
    ],
  };
  densityFixture1_service.add(entry);
  await densityFixture1_service.waitForTokenUpdates();

  const newBlock: ToolResponseBlock = {
    type: 'tool_response',
    callId: 'call-2',
    toolName: 'tool-b',
    result: 'replaced-second',
  };
  const ok = await densityFixture1_service.replaceToolResponseBlock(
    0,
    1,
    newBlock,
  );
  expect(ok).toBe(true);

  const raw = await collectRawHistory(densityFixture1_service);
  expect(raw[0].blocks[0]).toStrictEqual({
    type: 'tool_response',
    callId: 'call-1',
    toolName: 'tool-a',
    result: 'first',
  });

  return { actual: raw[0].blocks[1], expected0: newBlock };
}

async function observeDensityCase18() {
  densityFixture1_service.add(makeTextEntry('human', 'first turn'));
  densityFixture1_service.add(
    makeToolResponseEntry('call-1', 'tool', 'output'),
  );
  await densityFixture1_service.waitForTokenUpdates();

  const newBlock: ToolResponseBlock = {
    type: 'tool_response',
    callId: 'call-1',
    toolName: 'tool',
    result: 'truncated',
  };
  const ok = await densityFixture1_service.replaceToolResponseBlock(
    1,
    0,
    newBlock,
  );
  expect(ok).toBe(true);

  const raw = await collectRawHistory(densityFixture1_service);
  expect(raw[1].blocks[0]).toBe(newBlock);

  return {
    actual: raw[0].blocks[0],
    expected0: {
      type: 'text' as const,
      text: 'first turn',
    },
  };
}

async function observeDensityCase19() {
  densityFixture1_service.add(
    makeToolResponseEntry('call-1', 'read_file', 'x'.repeat(4000)),
  );
  await densityFixture1_service.waitForTokenUpdates();
  const tokensBefore = densityFixture1_service.getTotalTokens();

  await densityFixture1_service.replaceToolResponseBlock(
    0,
    0,
    {
      type: 'tool_response',
      callId: 'call-1',
      toolName: 'read_file',
      result: 'tiny',
    },
    'gpt-4.1',
  );
  await densityFixture1_service.waitForTokenUpdates();

  return {
    actual: densityFixture1_service.getTotalTokens(),
    expected0: tokensBefore,
  };
}

async function observeDensityCase20() {
  densityFixture1_service.add(
    makeToolResponseEntry('call-1', 'read_file', 'output'),
  );
  await densityFixture1_service.waitForTokenUpdates();

  const malformed = {
    callId: 'call-1',
    toolName: 'read_file',
    result: 'x',
  } as unknown as ToolResponseBlock;

  const ok = await densityFixture1_service.replaceToolResponseBlock(
    0,
    0,
    malformed,
  );
  expect(ok).toBe(false);

  const raw = await collectRawHistory(densityFixture1_service);
  const block = raw[0].blocks[0] as ToolResponseBlock;

  return block.result;
}

async function observeDensityCase21() {
  densityFixture1_service.add(
    makeToolResponseEntry('call-1', 'read_file', 'output'),
  );
  await densityFixture1_service.waitForTokenUpdates();

  const malformed = {
    type: 'text',
    text: 'not a tool response',
    callId: 'call-1',
    toolName: 'read_file',
  } as unknown as ToolResponseBlock;

  const ok = await densityFixture1_service.replaceToolResponseBlock(
    0,
    0,
    malformed,
  );
  expect(ok).toBe(false);

  const raw = await collectRawHistory(densityFixture1_service);
  const block = raw[0].blocks[0] as ToolResponseBlock;
  expect(block.type).toBe('tool_response');

  return block.result;
}

async function observeDensityCase22() {
  densityFixture1_service.add(makeStoredAiEntry('resp-before-failure'));
  densityFixture1_service.add(
    makeToolResponseEntry('call-failed-queue', 'read_file', 'original output'),
  );
  densityFixture1_service.add(makeStoredAiEntry('resp-after-failure'));
  await densityFixture1_service.waitForTokenUpdates();
  const tokensBefore = densityFixture1_service.getTotalTokens();

  const recalculationStarted = createDeferred();
  const continueRecalculation = createDeferred();
  const countTokens = vi
    .fn<() => Promise<number>>()
    .mockResolvedValue(1)
    .mockImplementationOnce(async () => {
      recalculationStarted.resolve();
      await continueRecalculation.promise;
      throw new Error('replacement tokenization failed');
    });
  const tokenizerFactory: RuntimeTokenizerFactory = {
    getTokenizer: () => ({ fallbackPolicy: 'deny', countTokens }),
    estimatePrompt: async (request) => ({
      count: 0,
      method: 'calibrated',
      family: 'failed-replacement-queue-fixture',
      estimatorVersion: '1',
      assetRevision: 'fixture',
      projectionRevision: request.projectionRevision,
    }),
  };
  densityFixture1_service.setTokenizerFactory(tokenizerFactory);

  const replacementPromise = densityFixture1_service.replaceToolResponseBlock(
    1,
    0,
    {
      type: 'tool_response',
      callId: 'call-failed-queue',
      toolName: 'read_file',
      result: 'discarded replacement',
    },
  );
  await recalculationStarted.promise;
  densityFixture1_service.add(
    makeTextEntry('human', 'queued after failed replacement'),
  );
  continueRecalculation.resolve();

  await expect(replacementPromise).rejects.toThrow(
    'replacement tokenization failed',
  );
  await densityFixture1_service.waitForTokenUpdates();

  const raw = await collectRawHistory(densityFixture1_service);
  expect(raw).toHaveLength(4);
  expect(raw[1].blocks[0]).toMatchObject({
    type: 'tool_response',
    result: 'original output',
  });
  expect(raw[3]).toMatchObject(
    makeTextEntry('human', 'queued after failed replacement'),
  );
  expect(raw[0].metadata?.responsesStored).toBe(true);
  expect(raw[2].metadata?.responsesStored).toBe(true);

  return {
    actual: densityFixture1_service.getTotalTokens(),
    expected0: tokensBefore + 1,
  };
}

async function observeDensityCase23() {
  densityFixture1_service.add(makeStoredAiEntry('resp-before-success'));
  densityFixture1_service.add(
    makeToolResponseEntry('call-success-queue', 'read_file', 'original output'),
  );
  densityFixture1_service.add(makeStoredAiEntry('resp-after-success'));
  await densityFixture1_service.waitForTokenUpdates();

  const recalculationStarted = createDeferred();
  const continueRecalculation = createDeferred();
  const countTokens = vi
    .fn<() => Promise<number>>()
    .mockResolvedValue(1)
    .mockImplementationOnce(async () => {
      recalculationStarted.resolve();
      await continueRecalculation.promise;
      return 1;
    });
  const tokenizerFactory: RuntimeTokenizerFactory = {
    getTokenizer: () => ({ fallbackPolicy: 'deny', countTokens }),
    estimatePrompt: async (request) => ({
      count: 0,
      method: 'calibrated',
      family: 'successful-replacement-queue-fixture',
      estimatorVersion: '1',
      assetRevision: 'fixture',
      projectionRevision: request.projectionRevision,
    }),
  };
  densityFixture1_service.setTokenizerFactory(tokenizerFactory);

  const replacementPromise = densityFixture1_service.replaceToolResponseBlock(
    1,
    0,
    {
      type: 'tool_response',
      callId: 'call-success-queue',
      toolName: 'read_file',
      result: 'committed replacement',
    },
  );
  await recalculationStarted.promise;
  densityFixture1_service.add(
    makeTextEntry('human', 'queued after successful replacement'),
  );

  expect(await collectRawHistory(densityFixture1_service)).toHaveLength(3);
  continueRecalculation.resolve();
  await replacementPromise;
  await densityFixture1_service.waitForTokenUpdates();

  const raw = await collectRawHistory(densityFixture1_service);
  expect(raw).toHaveLength(4);
  expect(raw[1].blocks[0]).toMatchObject({
    type: 'tool_response',
    result: 'committed replacement',
  });
  expect(raw[3]).toMatchObject(
    makeTextEntry('human', 'queued after successful replacement'),
  );
  expect(raw[0].metadata?.responsesStored).toBeUndefined();
  expect(raw[2].metadata?.responsesStored).toBeUndefined();

  return densityFixture1_service.getTotalTokens();
}

async function observeDensityCase24() {
  densityFixture1_service.add(makeStoredAiEntry('resp-rollback'));
  densityFixture1_service.add(
    makeToolResponseEntry('call-1', 'read_file', 'x'.repeat(4000)),
  );
  await densityFixture1_service.waitForTokenUpdates();
  const tokensBefore = densityFixture1_service.getTotalTokens();
  expect(tokensBefore).toBeGreaterThan(0);

  // Force recalculateTotalTokens to reject by attaching a listener that
  // throws during the tokensUpdated event emitted by recalc.
  densityFixture1_service.on('tokensUpdated', () => {
    throw new Error('listener failure');
  });

  const replacement: ToolResponseBlock = {
    type: 'tool_response',
    callId: 'call-1',
    toolName: 'read_file',
    result: 'should not persist',
  };

  await expect(
    densityFixture1_service.replaceToolResponseBlock(1, 0, replacement),
  ).rejects.toThrow('listener failure');

  // Invariant 1: history is restored to the original block.
  const raw = await collectRawHistory(densityFixture1_service);
  const block = raw[1].blocks[0] as ToolResponseBlock;
  expect(block.result).toBe('x'.repeat(4000));
  expect(raw[0].metadata?.responsesStored).toBe(true);
  expect(raw[0].metadata?.id).toBe('resp-rollback');

  // Invariant 2: token accounting is restored to the pre-replacement value.
  // Without this, the token budget would silently reflect the discarded
  // replacement content, corrupting downstream compression/threshold logic.

  return {
    actual: densityFixture1_service.getTotalTokens(),
    expected0: tokensBefore,
  };
}

describe('HistoryService.replaceToolResponseBlock invalid indices', () => {
  beforeEach(() => {
    densityFixture1_service = new HistoryService();
  });
  it('returns false for negative entry index', async () =>
    expect(await observeDensityCase6()).toBe(false));
  it('returns false for non-integer entry index', async () =>
    expect(await observeDensityCase7()).toBe(false));
  it('returns false for entry index beyond history length', async () =>
    expect(await observeDensityCase8()).toBe(false));
  it('returns false for negative block index', async () => {
    expect(await observeDensityCase9()).toBe(false);
  });
  it('returns false for block index beyond blocks length', async () => {
    expect(await observeDensityCase10()).toBe(false);
  });
});
