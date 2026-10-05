import { collectRowsForAssertions } from '../../test-utils/collect-rows-for-assertions.js';
/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { blockTextOrEmpty } from '@vybestack/llxprt-code-test-utils';
import { describe, expect, it } from 'bun:test';
import type { RuntimeTokenizerFactory } from '../../runtime/contracts/RuntimeTokenizerFactory.js';
import { HistoryService } from './HistoryService.js';
import { createUserMessage, type IContent } from './IContent.js';

function textOf(content: IContent): string {
  const block = content.blocks[0];
  return blockTextOrEmpty(block);
}

function controlledTokenizerFactory(): {
  readonly factory: RuntimeTokenizerFactory;
  readonly waitUntilSecond: Promise<void>;
  readonly releaseSecond: () => void;
} {
  let invocation = 0;
  let notifySecond: (() => void) | undefined;
  let releaseSecond: (() => void) | undefined;
  const waitUntilSecond = new Promise<void>((resolve) => {
    notifySecond = resolve;
  });
  const secondGate = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });
  return {
    factory: {
      getTokenizer: () => ({
        countTokens: async (value: unknown): Promise<number> => {
          invocation += 1;
          if (invocation === 2) {
            notifySecond?.();
            await secondGate;
          }
          return typeof value === 'string' ? value.length : 1;
        },
      }),
      estimatePrompt: async (request) => ({
        count: await request.legacyEstimate(),
        method: 'exact',
        family: 'controlled-test',
        estimatorVersion: '1',
        assetRevision: '1',
        projectionRevision: request.projectionRevision,
      }),
    },
    waitUntilSecond,
    releaseSecond: () => releaseSecond?.(),
  };
}

async function batchCase1(): Promise<number | undefined> {
  const history = new HistoryService();
  history.setTokenizerFactory({
    getTokenizer: () => ({
      fallbackPolicy: 'deny',
      countTokens: async (): Promise<number> => 3,
    }),
    estimatePrompt: async (request) => ({
      count: await request.legacyEstimate(),
      method: 'exact',
      family: 'batch-validation-test',
      estimatorVersion: '1',
      assetRevision: '1',
      projectionRevision: request.projectionRevision,
    }),
  });
  const baseline = createUserMessage('baseline');
  history.add(baseline);
  await history.waitForTokenUpdates();

  await expect(
    history.addBatch([
      createUserMessage('valid first'),
      { speaker: 'ai', blocks: [] },
    ]),
  ).rejects.toThrow('batch entry 1');

  await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
    expect(rows).toStrictEqual([baseline]);
  });
  expect(history.getTotalTokens()).toBe(3);
  expect(baseline.metadata?.chronology?.seq).toBe(1);

  const following = createUserMessage('following');
  await history.addBatch([following]);
  let seq: number | undefined;
  await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
    seq = rows[1]?.metadata?.chronology?.seq;
  });
  return seq;
}

async function batchCase2(): Promise<unknown> {
  const history = new HistoryService();
  let invocation = 0;
  history.setTokenizerFactory({
    getTokenizer: () => ({
      fallbackPolicy: 'deny',
      countTokens: async (): Promise<number> => {
        invocation += 1;
        if (invocation === 2) throw new Error('second token estimate failed');
        return 3;
      },
    }),
    estimatePrompt: async (request) => ({
      count: await request.legacyEstimate(),
      method: 'exact',
      family: 'failure-test',
      estimatorVersion: '1',
      assetRevision: '1',
      projectionRevision: request.projectionRevision,
    }),
  });
  const first = createUserMessage('first');
  const second = createUserMessage('second');

  await expect(history.addBatch([first, second])).rejects.toThrow(
    'second token estimate failed',
  );

  await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
    expect(rows).toStrictEqual([]);
  });
  expect(history.getTotalTokens()).toBe(0);
  expect(first.metadata?.chronology).toBeUndefined();
  return second.metadata?.chronology;
}

async function batchCase3(): Promise<string[]> {
  const history = new HistoryService();
  const externalRecords: string[] = [];
  history.registerMediaOwner({
    adopt: () => undefined,
    releaseAll: async () => undefined,
    reconcile: async () => undefined,
    prepareReplacement: () => ({
      publish: () => {
        externalRecords.push('published');
      },
      rollback: () => {
        externalRecords.pop();
      },
    }),
  });
  history.on('contentBatchAdded', () => {
    throw new Error('publication failed');
  });

  await expect(
    history.addBatch([createUserMessage('first'), createUserMessage('second')]),
  ).rejects.toThrow('publication failed');

  await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
    expect(rows).toStrictEqual([]);
  });
  expect(history.getTotalTokens()).toBe(0);
  return externalRecords;
}

async function batchCase4(): Promise<string[][]> {
  const history = new HistoryService();
  const observed: string[][] = [];
  history.on('contentBatchAdded', (contents) => {
    const texts: string[] = [];
    contents.withRows((cursor) => {
      for (let item = cursor.next(); item.done !== true; item = cursor.next())
        texts.push(textOf(item.value));
    });
    observed.push(texts);
    throw new Error('batch listener failed');
  });

  await expect(
    history.addBatch([createUserMessage('first'), createUserMessage('second')]),
  ).rejects.toThrow('batch listener failed');

  await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
    expect(rows).toStrictEqual([]);
  });
  expect(history.getTotalTokens()).toBe(0);
  return observed;
}

async function batchCase5(
  assertResult: (result: {
    history: readonly IContent[];
    baseline: IContent;
  }) => void,
): Promise<void> {
  const history = new HistoryService();
  const baseline = createUserMessage('baseline');
  await history.addBatch([baseline]);
  let stored: IContent | undefined;
  await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
    stored = rows[0];
  });
  Object.freeze(baseline.metadata);
  Object.freeze(baseline);
  history.on('contentBatchAdded', () => {
    throw new Error('batch listener failed');
  });

  await expect(history.addBatch([createUserMessage('next')])).rejects.toThrow(
    'batch listener failed',
  );

  await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
    expect(baseline.metadata).toBeUndefined();
    expect(rows[0]?.metadata?.chronology).toMatchObject({
      seq: 1,
      userTurn: 1,
      step: 1,
    });
    expect(rows[0]?.blocks).toStrictEqual(baseline.blocks);
    if (stored === undefined) throw new Error('Missing baseline value');
    assertResult({ history: rows, baseline: stored });
  });
}

async function batchCase6(): Promise<{
  tokenDelta: number | undefined;
  totalTokens: number;
}> {
  const history = new HistoryService();
  const events: string[][] = [];
  const tokenDeltas: number[] = [];
  history.on('contentBatchAdded', (contents) => {
    const texts: string[] = [];
    contents.withRows((cursor) => {
      for (let item = cursor.next(); item.done !== true; item = cursor.next())
        texts.push(textOf(item.value));
    });
    events.push(texts);
  });
  history.on('tokensUpdated', (event) => {
    tokenDeltas.push(event.addedTokens);
  });

  await history.addBatch([
    createUserMessage('first'),
    createUserMessage('second'),
    createUserMessage('third'),
  ]);

  await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
    expect(rows.map(textOf)).toStrictEqual(['first', 'second', 'third']);
  });
  expect(events).toStrictEqual([['first', 'second', 'third']]);
  expect(tokenDeltas).toHaveLength(1);
  return { tokenDelta: tokenDeltas[0], totalTokens: history.getTotalTokens() };
}

async function batchCase7(): Promise<HistoryService> {
  const history = new HistoryService();
  const tokenizer = controlledTokenizerFactory();
  history.setTokenizerFactory(tokenizer.factory);
  const batch = history.addBatch([
    createUserMessage('first'),
    createUserMessage('second'),
  ]);
  await tokenizer.waitUntilSecond;

  history.add(createUserMessage('after'));
  tokenizer.releaseSecond();
  await batch;
  await history.waitForTokenUpdates();

  await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
    expect(rows.map(textOf)).toStrictEqual(['first', 'second', 'after']);
  });
  return history;
}

async function batchCase8(): Promise<number> {
  const history = new HistoryService();
  const tokenizer = controlledTokenizerFactory();
  history.setTokenizerFactory(tokenizer.factory);
  const batch = history.addBatch([
    createUserMessage('first'),
    createUserMessage('second'),
  ]);
  await tokenizer.waitUntilSecond;

  history.clear();
  tokenizer.releaseSecond();
  await batch;
  await history.waitForTokenUpdates();

  await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
    expect(rows).toStrictEqual([]);
  });
  return history.getTotalTokens();
}

describe('HistoryService atomic batch publication', () => {
  it('rejects the whole batch when a later conceptual entry is invalid', async () => {
    expect(await batchCase1()).toBe(2);
  });
  it('leaves history, tokens, and chronology unchanged when token estimation fails after the first entry', async () => {
    expect(await batchCase2()).toBeUndefined();
  });
  it('rolls back media ownership when batch publication fails', async () => {
    expect(await batchCase3()).toStrictEqual([]);
  });
  it('rolls back the whole batch when its listener fails', async () => {
    expect(await batchCase4()).toStrictEqual([['first', 'second']]);
  });
  it('rolls back a failed batch without rewriting frozen chronology metadata', async () => {
    await batchCase5((result) => {
      expect(result.history).toStrictEqual([result.baseline]);
    });
  });
  it('publishes one complete ordered event and one aggregate token delta', async () => {
    const result = await batchCase6();
    expect(result.tokenDelta).toBe(result.totalTokens);
  });
  it('serializes a concurrent add after the complete batch', async () => {
    const result = await batchCase7();
    await collectRowsForAssertions(result.streamRawHistory(), async (rows) => {
      expect(result.getTotalTokens()).toBe(
        await result.estimateTokensForContents(rows),
      );
    });
  });
  it('serializes a concurrent clear after the complete batch', async () => {
    expect(await batchCase8()).toBe(0);
  });
});
