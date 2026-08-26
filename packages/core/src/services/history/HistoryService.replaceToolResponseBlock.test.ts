/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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

describe('HistoryService.replaceToolResponseBlock', () => {
  let service: HistoryService;

  beforeEach(() => {
    service = new HistoryService();
  });

  it('replaces a tool_response block at the given entry/block indices', async () => {
    service.add(makeToolResponseEntry('call-1', 'read_file', 'original'));
    await service.waitForTokenUpdates();

    const newBlock: ToolResponseBlock = {
      type: 'tool_response',
      callId: 'call-1',
      toolName: 'read_file',
      result: 'replaced',
    };

    const ok = await service.replaceToolResponseBlock(0, 0, newBlock);
    expect(ok).toBe(true);

    const raw = service.getRawHistory();
    expect(raw[0].blocks[0]).toBe(newBlock);
  });

  it('invalidates stored parents only when replacement rewrites retained provider history', async () => {
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
    expect(retainedRewrite.getRawHistory()[0].metadata).toMatchObject({
      id: 'resp-1',
      providerBaseURL: 'https://api.openai.com/v1',
      providerMetadata: { custom: 'metadata resp-1' },
    });
    expect(
      retainedRewrite.getRawHistory()[0].metadata?.responsesStored,
    ).toBeUndefined();
    expect(retainedRewrite.getRawHistory()[2].metadata).toMatchObject({
      id: 'resp-2',
      providerBaseURL: 'https://api.openai.com/v1',
      providerMetadata: { custom: 'metadata resp-2' },
    });
    expect(
      retainedRewrite.getRawHistory()[2].metadata?.responsesStored,
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
      pendingOnlyRewrite.getRawHistory()[0].metadata?.responsesStored,
    ).toBe(true);
    expect(pendingOnlyRewrite.getRawHistory()[0].metadata?.id).toBe(
      'resp-parent',
    );
  });

  it('makes a retained block rewrite and lineage invalidation visible atomically during token recalculation', async () => {
    service.add(makeStoredAiEntry('resp-before-rewrite'));
    service.add(
      makeToolResponseEntry('call-atomic', 'read_file', 'original output'),
    );
    service.add(makeStoredAiEntry('resp-after-rewrite'));
    await service.waitForTokenUpdates();

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
    service.setTokenizerFactory(tokenizerFactory);

    const replacementPromise = service.replaceToolResponseBlock(1, 0, {
      type: 'tool_response',
      callId: 'call-atomic',
      toolName: 'read_file',
      result: 'replacement output',
    });
    await recalculationStarted.promise;
    const observedDuringRecalculation = service.getRawHistory();
    continueRecalculation.resolve();
    await replacementPromise;

    expect(observedDuringRecalculation[1].blocks[0]).toMatchObject({
      type: 'tool_response',
      result: 'replacement output',
    });
    expect(
      observedDuringRecalculation[0].metadata?.responsesStored,
    ).toBeUndefined();
    expect(
      observedDuringRecalculation[2].metadata?.responsesStored,
    ).toBeUndefined();
  });

  it('preserves lineage and token state for a structurally identical replacement', async () => {
    const originalBlock: ToolResponseBlock = {
      type: 'tool_response',
      callId: 'call-identical',
      toolName: 'read_file',
      result: { output: ['same', 'structure'] },
    };
    service.add(makeStoredAiEntry('resp-identical-parent'));
    service.add({ speaker: 'tool', blocks: [originalBlock] });
    service.add(makeStoredAiEntry('resp-identical-child'));
    await service.waitForTokenUpdates();
    const expectedTokens = await service.estimateTokensForContents(
      service.getAll(),
    );
    let tokenUpdates = 0;
    service.on('tokensUpdated', () => {
      tokenUpdates += 1;
    });

    const replaced = await service.replaceToolResponseBlock(1, 0, {
      type: 'tool_response',
      callId: 'call-identical',
      toolName: 'read_file',
      result: { output: ['same', 'structure'] },
    });

    expect(replaced).toBe(true);
    expect(service.getRawHistory()[1].blocks[0]).toBe(originalBlock);
    expect(service.getTotalTokens()).toBe(expectedTokens);
    expect(tokenUpdates).toBe(0);
    expect(service.getRawHistory()[0].metadata?.responsesStored).toBe(true);
    expect(service.getRawHistory()[2].metadata?.responsesStored).toBe(true);
  });

  it('returns false for negative entry index', async () => {
    service.add(makeTextEntry('human', 'hello'));
    await service.waitForTokenUpdates();

    const ok = await service.replaceToolResponseBlock(-1, 0, {
      type: 'tool_response',
      callId: 'call-1',
      toolName: 'tool',
      result: 'x',
    });
    expect(ok).toBe(false);
  });

  it('returns false for non-integer entry index', async () => {
    service.add(makeTextEntry('human', 'hello'));
    await service.waitForTokenUpdates();

    const ok = await service.replaceToolResponseBlock(0.5, 0, {
      type: 'tool_response',
      callId: 'call-1',
      toolName: 'tool',
      result: 'x',
    });
    expect(ok).toBe(false);
  });

  it('returns false for entry index beyond history length', async () => {
    service.add(makeTextEntry('human', 'hello'));
    await service.waitForTokenUpdates();

    const ok = await service.replaceToolResponseBlock(10, 0, {
      type: 'tool_response',
      callId: 'call-1',
      toolName: 'tool',
      result: 'x',
    });
    expect(ok).toBe(false);
  });

  it('returns false for negative block index', async () => {
    service.add(makeToolResponseEntry('call-1', 'tool', 'output'));
    await service.waitForTokenUpdates();

    const ok = await service.replaceToolResponseBlock(0, -1, {
      type: 'tool_response',
      callId: 'call-1',
      toolName: 'tool',
      result: 'x',
    });
    expect(ok).toBe(false);
  });

  it('returns false for block index beyond blocks length', async () => {
    service.add(makeToolResponseEntry('call-1', 'tool', 'output'));
    await service.waitForTokenUpdates();

    const ok = await service.replaceToolResponseBlock(0, 10, {
      type: 'tool_response',
      callId: 'call-1',
      toolName: 'tool',
      result: 'x',
    });
    expect(ok).toBe(false);
  });

  it('returns false on empty history', async () => {
    const ok = await service.replaceToolResponseBlock(0, 0, {
      type: 'tool_response',
      callId: 'call-1',
      toolName: 'tool',
      result: 'x',
    });
    expect(ok).toBe(false);
  });

  it('returns false when the target block is not a tool_response', async () => {
    service.add(makeTextEntry('human', 'hello'));
    await service.waitForTokenUpdates();

    const ok = await service.replaceToolResponseBlock(0, 0, {
      type: 'tool_response',
      callId: 'call-1',
      toolName: 'tool',
      result: 'x',
    });
    expect(ok).toBe(false);
  });

  it('returns false when the replacement callId does not match', async () => {
    service.add(makeToolResponseEntry('call-1', 'tool', 'output'));
    await service.waitForTokenUpdates();

    const ok = await service.replaceToolResponseBlock(0, 0, {
      type: 'tool_response',
      callId: 'call-MISMATCH',
      toolName: 'tool',
      result: 'x',
    });
    expect(ok).toBe(false);
  });

  it('returns false when the replacement toolName does not match', async () => {
    service.add(makeToolResponseEntry('call-1', 'read_file', 'output'));
    await service.waitForTokenUpdates();

    const ok = await service.replaceToolResponseBlock(0, 0, {
      type: 'tool_response',
      callId: 'call-1',
      toolName: 'MISMATCH',
      result: 'x',
    });
    expect(ok).toBe(false);
  });

  it('recalculates total tokens after replacement', async () => {
    service.add(makeToolResponseEntry('call-1', 'read_file', 'x'.repeat(4000)));
    await service.waitForTokenUpdates();
    const tokensBefore = service.getTotalTokens();

    await service.replaceToolResponseBlock(0, 0, {
      type: 'tool_response',
      callId: 'call-1',
      toolName: 'read_file',
      result: 'tiny',
    });
    await service.waitForTokenUpdates();

    expect(service.getTotalTokens()).toBeLessThan(tokensBefore);
  });

  it('does not mutate the original entry object', async () => {
    const entry = makeToolResponseEntry('call-1', 'read_file', 'original');
    service.add(entry);
    await service.waitForTokenUpdates();

    const originalBlocksRef = entry.blocks;
    await service.replaceToolResponseBlock(0, 0, {
      type: 'tool_response',
      callId: 'call-1',
      toolName: 'read_file',
      result: 'replaced',
    });

    expect(entry.blocks).toBe(originalBlocksRef);
    expect(entry.blocks[0]).toHaveProperty('result', 'original');
  });

  it('replaces a block at a multi-block entry correctly', async () => {
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
    service.add(entry);
    await service.waitForTokenUpdates();

    const newBlock: ToolResponseBlock = {
      type: 'tool_response',
      callId: 'call-2',
      toolName: 'tool-b',
      result: 'replaced-second',
    };
    const ok = await service.replaceToolResponseBlock(0, 1, newBlock);
    expect(ok).toBe(true);

    const raw = service.getRawHistory();
    expect(raw[0].blocks[0]).toStrictEqual({
      type: 'tool_response',
      callId: 'call-1',
      toolName: 'tool-a',
      result: 'first',
    });
    expect(raw[0].blocks[1]).toBe(newBlock);
  });

  it('replaces a block at a later entry index', async () => {
    service.add(makeTextEntry('human', 'first turn'));
    service.add(makeToolResponseEntry('call-1', 'tool', 'output'));
    await service.waitForTokenUpdates();

    const newBlock: ToolResponseBlock = {
      type: 'tool_response',
      callId: 'call-1',
      toolName: 'tool',
      result: 'truncated',
    };
    const ok = await service.replaceToolResponseBlock(1, 0, newBlock);
    expect(ok).toBe(true);

    const raw = service.getRawHistory();
    expect(raw[1].blocks[0]).toBe(newBlock);
    expect(raw[0].blocks[0]).toStrictEqual({
      type: 'text',
      text: 'first turn',
    });
  });

  it('accepts a model name for token recalculation', async () => {
    service.add(makeToolResponseEntry('call-1', 'read_file', 'x'.repeat(4000)));
    await service.waitForTokenUpdates();
    const tokensBefore = service.getTotalTokens();

    await service.replaceToolResponseBlock(
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
    await service.waitForTokenUpdates();

    expect(service.getTotalTokens()).toBeLessThan(tokensBefore);
  });

  it('returns false when the replacement lacks a type field despite matching callId/toolName', async () => {
    service.add(makeToolResponseEntry('call-1', 'read_file', 'output'));
    await service.waitForTokenUpdates();

    const malformed = {
      callId: 'call-1',
      toolName: 'read_file',
      result: 'x',
    } as unknown as ToolResponseBlock;

    const ok = await service.replaceToolResponseBlock(0, 0, malformed);
    expect(ok).toBe(false);

    const raw = service.getRawHistory();
    const block = raw[0].blocks[0] as ToolResponseBlock;
    expect(block.result).toBe('output');
  });

  it('returns false when the replacement has wrong type despite matching callId/toolName', async () => {
    service.add(makeToolResponseEntry('call-1', 'read_file', 'output'));
    await service.waitForTokenUpdates();

    const malformed = {
      type: 'text',
      text: 'not a tool response',
      callId: 'call-1',
      toolName: 'read_file',
    } as unknown as ToolResponseBlock;

    const ok = await service.replaceToolResponseBlock(0, 0, malformed);
    expect(ok).toBe(false);

    const raw = service.getRawHistory();
    const block = raw[0].blocks[0] as ToolResponseBlock;
    expect(block.type).toBe('tool_response');
    expect(block.result).toBe('output');
  });

  it('preserves an addition queued during failed replacement rollback', async () => {
    service.add(makeStoredAiEntry('resp-before-failure'));
    service.add(
      makeToolResponseEntry(
        'call-failed-queue',
        'read_file',
        'original output',
      ),
    );
    service.add(makeStoredAiEntry('resp-after-failure'));
    await service.waitForTokenUpdates();
    const tokensBefore = service.getTotalTokens();

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
    service.setTokenizerFactory(tokenizerFactory);

    const replacementPromise = service.replaceToolResponseBlock(1, 0, {
      type: 'tool_response',
      callId: 'call-failed-queue',
      toolName: 'read_file',
      result: 'discarded replacement',
    });
    await recalculationStarted.promise;
    service.add(makeTextEntry('human', 'queued after failed replacement'));
    continueRecalculation.resolve();

    await expect(replacementPromise).rejects.toThrow(
      'replacement tokenization failed',
    );
    await service.waitForTokenUpdates();

    const raw = service.getRawHistory();
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
    expect(service.getTotalTokens()).toBe(tokensBefore + 1);
  });

  it('applies an addition only after a successful replacement settles', async () => {
    service.add(makeStoredAiEntry('resp-before-success'));
    service.add(
      makeToolResponseEntry(
        'call-success-queue',
        'read_file',
        'original output',
      ),
    );
    service.add(makeStoredAiEntry('resp-after-success'));
    await service.waitForTokenUpdates();

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
    service.setTokenizerFactory(tokenizerFactory);

    const replacementPromise = service.replaceToolResponseBlock(1, 0, {
      type: 'tool_response',
      callId: 'call-success-queue',
      toolName: 'read_file',
      result: 'committed replacement',
    });
    await recalculationStarted.promise;
    service.add(makeTextEntry('human', 'queued after successful replacement'));

    expect(service.getRawHistory()).toHaveLength(3);
    continueRecalculation.resolve();
    await replacementPromise;
    await service.waitForTokenUpdates();

    const raw = service.getRawHistory();
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
    expect(service.getTotalTokens()).toBe(4);
  });

  it('rolls back BOTH history and token accounting when recalculation throws', async () => {
    service.add(makeStoredAiEntry('resp-rollback'));
    service.add(makeToolResponseEntry('call-1', 'read_file', 'x'.repeat(4000)));
    await service.waitForTokenUpdates();
    const tokensBefore = service.getTotalTokens();
    expect(tokensBefore).toBeGreaterThan(0);

    // Force recalculateTotalTokens to reject by attaching a listener that
    // throws during the tokensUpdated event emitted by recalc.
    service.on('tokensUpdated', () => {
      throw new Error('listener failure');
    });

    const replacement: ToolResponseBlock = {
      type: 'tool_response',
      callId: 'call-1',
      toolName: 'read_file',
      result: 'should not persist',
    };

    await expect(
      service.replaceToolResponseBlock(1, 0, replacement),
    ).rejects.toThrow('listener failure');

    // Invariant 1: history is restored to the original block.
    const raw = service.getRawHistory();
    const block = raw[1].blocks[0] as ToolResponseBlock;
    expect(block.result).toBe('x'.repeat(4000));
    expect(raw[0].metadata?.responsesStored).toBe(true);
    expect(raw[0].metadata?.id).toBe('resp-rollback');

    // Invariant 2: token accounting is restored to the pre-replacement value.
    // Without this, the token budget would silently reflect the discarded
    // replacement content, corrupting downstream compression/threshold logic.
    expect(service.getTotalTokens()).toBe(tokensBefore);
  });
});
