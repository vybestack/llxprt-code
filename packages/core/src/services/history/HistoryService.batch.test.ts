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

import { describe, expect, it } from 'bun:test';
import type { RuntimeTokenizerFactory } from '../../runtime/contracts/RuntimeTokenizerFactory.js';
import { HistoryService } from './HistoryService.js';
import { createUserMessage, type IContent } from './IContent.js';

function textOf(content: IContent): string {
  const block = content.blocks[0];
  return block.type === 'text' ? block.text : '';
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

describe('HistoryService atomic batch publication', () => {
  it('rejects the whole batch when a later conceptual entry is invalid', async () => {
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

    expect(history.getAll()).toStrictEqual([baseline]);
    expect(history.getTotalTokens()).toBe(3);
    expect(baseline.metadata?.chronology?.seq).toBe(1);

    const following = createUserMessage('following');
    await history.addBatch([following]);
    expect(history.getAll()[1]?.metadata?.chronology?.seq).toBe(2);
  });

  it('leaves history, tokens, and chronology unchanged when token estimation fails after the first entry', async () => {
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

    expect(history.getAll()).toStrictEqual([]);
    expect(history.getTotalTokens()).toBe(0);
    expect(first.metadata?.chronology).toBeUndefined();
    expect(second.metadata?.chronology).toBeUndefined();
  });

  it('rolls back participant publication when a later participant fails', async () => {
    const history = new HistoryService();
    const externalRecords: string[] = [];
    history.registerBatchParticipant(() => ({
      publish: () => {
        externalRecords.push('published');
      },
      rollback: () => {
        externalRecords.pop();
      },
    }));
    history.registerBatchParticipant(() => {
      throw new Error('persistence staging failed');
    });

    await expect(
      history.addBatch([
        createUserMessage('first'),
        createUserMessage('second'),
      ]),
    ).rejects.toThrow('persistence staging failed');

    expect(history.getAll()).toStrictEqual([]);
    expect(history.getTotalTokens()).toBe(0);
    expect(externalRecords).toStrictEqual([]);
  });

  it('rolls back the whole batch when its listener fails', async () => {
    const history = new HistoryService();
    const observed: string[][] = [];
    history.on('contentBatchAdded', (contents) => {
      observed.push(contents.map(textOf));
      throw new Error('batch listener failed');
    });

    await expect(
      history.addBatch([
        createUserMessage('first'),
        createUserMessage('second'),
      ]),
    ).rejects.toThrow('batch listener failed');

    expect(history.getAll()).toStrictEqual([]);
    expect(history.getTotalTokens()).toBe(0);
    expect(observed).toStrictEqual([['first', 'second']]);
  });

  it('rolls back a failed batch without rewriting frozen chronology metadata', async () => {
    const history = new HistoryService();
    const baseline = createUserMessage('baseline');
    await history.addBatch([baseline]);
    Object.freeze(baseline.metadata);
    Object.freeze(baseline);
    history.on('contentBatchAdded', () => {
      throw new Error('batch listener failed');
    });

    await expect(history.addBatch([createUserMessage('next')])).rejects.toThrow(
      'batch listener failed',
    );

    expect(history.getAll()).toStrictEqual([baseline]);
  });

  it('publishes one complete ordered event and one aggregate token delta', async () => {
    const history = new HistoryService();
    const events: string[][] = [];
    const tokenDeltas: number[] = [];
    history.on('contentBatchAdded', (contents) => {
      events.push(contents.map(textOf));
    });
    history.on('tokensUpdated', (event) => {
      tokenDeltas.push(event.addedTokens);
    });

    await history.addBatch([
      createUserMessage('first'),
      createUserMessage('second'),
      createUserMessage('third'),
    ]);

    expect(history.getAll().map(textOf)).toStrictEqual([
      'first',
      'second',
      'third',
    ]);
    expect(events).toStrictEqual([['first', 'second', 'third']]);
    expect(tokenDeltas).toHaveLength(1);
    expect(tokenDeltas[0]).toBe(history.getTotalTokens());
  });

  it('serializes a concurrent add after the complete batch', async () => {
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

    expect(history.getAll().map(textOf)).toStrictEqual([
      'first',
      'second',
      'after',
    ]);
    expect(history.getTotalTokens()).toBe(
      await history.estimateTokensForContents(history.getAll()),
    );
  });

  it('serializes a concurrent clear after the complete batch', async () => {
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

    expect(history.getAll()).toStrictEqual([]);
    expect(history.getTotalTokens()).toBe(0);
  });
});
