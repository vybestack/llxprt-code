import { collectRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
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
import { createUserMessage, type IContent } from './IContent.js';
import { HistoryService } from './HistoryService.js';
import { withNativeDetachedFixture } from './__tests__/support/detached-contract-fixture.js';
import { JournalOwners } from './journalOwners.js';
import { historyOriginId } from './historyOriginId.js';
import { decodeStoredRow } from './journalRowCodec.js';

function createBlockedTokenizerFactory(): {
  factory: RuntimeTokenizerFactory;
  blockNext: () => Promise<void>;
  release: () => void;
} {
  let blocking = false;
  let startedResolve: (() => void) | undefined;
  let releaseResolve: (() => void) | undefined;
  let releasePromise = Promise.resolve();

  return {
    factory: {
      estimatePrompt: async () => {
        throw new Error('Blocked tokenizer fixture does not estimate prompts');
      },
      getTokenizer: () => ({
        countTokens: async (content: unknown) => {
          if (blocking) {
            blocking = false;
            startedResolve?.();
            await releasePromise;
          }
          return typeof content === 'string' ? content.length : 1;
        },
      }),
    },
    blockNext: () => {
      blocking = true;
      releasePromise = new Promise<void>((resolve) => {
        releaseResolve = resolve;
      });
      return new Promise<void>((resolve) => {
        startedResolve = resolve;
      });
    },
    release: () => releaseResolve?.(),
  };
}

async function expectConsistentTokenCount(
  service: HistoryService,
): Promise<void> {
  await service.waitForTokenUpdates();
  await collectRowsForAssertions(service.streamRawHistory(), async (all) => {
    const expected = await service.estimateTokensForContents(all);
    expect(service.getTotalTokens()).toBe(expected);
  });
}

function createQueuedFailureListener(service: HistoryService): () => never {
  let invocation = 0;
  return () => {
    invocation += 1;
    if (invocation === 1) {
      service.add(createUserMessage('queued first'));
      service.add(createUserMessage('queued second'));
      throw new Error('initial failure');
    }
    throw new Error(`queued failure ${invocation - 1}`);
  };
}

function aggregateErrors(error: unknown): readonly unknown[] {
  if (!(error instanceof AggregateError)) {
    throw new Error('expected an AggregateError');
  }
  return error.errors;
}

function errorMessages(errors: readonly unknown[]): readonly string[] {
  return errors.map((error) =>
    error instanceof Error ? error.message : String(error),
  );
}

async function expectQueuedValues(
  service: HistoryService,
  replacement: IContent,
  appended: IContent,
): Promise<void> {
  await collectRowsForAssertions(service.streamRawHistory(), (all) => {
    expect(all).toStrictEqual([
      {
        ...replacement,
        metadata: {
          chronology: {
            seq: 1,
            userTurn: 1,
            step: 1,
            recordedAt: expect.any(Number),
          },
        },
      },
      appended,
    ]);
    expect(all[0].metadata?.chronology).toMatchObject({
      seq: 1,
      userTurn: 1,
      step: 1,
    });
    expect(all[1].metadata?.chronology).toMatchObject({
      seq: 2,
      userTurn: 2,
      step: 1,
    });
    expect(all[0].metadata?.chronology?.recordedAt).toStrictEqual(
      expect.any(Number),
    );
    expect(all[0]).not.toBe(replacement);
  });
}

describe('HistoryService replaceAll serialization', () => {
  it('applies an add after an in-flight replacement without losing its tokens', async () => {
    const service = new HistoryService();
    const blocked = createBlockedTokenizerFactory();
    service.setTokenizerFactory(blocked.factory);
    const replacement = createUserMessage('replacement');
    const appended = createUserMessage('appended');
    const estimationStarted = blocked.blockNext();

    const replacing = service.replaceAll([replacement]);
    await estimationStarted;
    service.add(appended);
    blocked.release();
    await replacing;

    await service.waitForCommit();
    await expectQueuedValues(service, replacement, appended);
    expect(replacement.metadata).toBeUndefined();
    await expectConsistentTokenCount(service);
  });

  it('applies clear after an in-flight replacement', async () => {
    const service = new HistoryService();
    const blocked = createBlockedTokenizerFactory();
    service.setTokenizerFactory(blocked.factory);
    const estimationStarted = blocked.blockNext();

    const replacing = service.replaceAll([createUserMessage('replacement')]);
    await estimationStarted;
    const clearing = service.clear();
    blocked.release();
    await replacing;
    await clearing;

    await collectRowsForAssertions(service.streamRawHistory(), (all) => {
      expect(all).toStrictEqual([]);
    });
    await expectConsistentTokenCount(service);
  });

  it('rolls back an add when a content listener rejects it', async () => {
    const service = new HistoryService();
    service.on('contentAdded', () => {
      throw new Error('listener failed');
    });

    expect(() => service.add(createUserMessage('rejected'))).toThrow(
      'listener failed',
    );
    await collectRowsForAssertions(service.streamRawHistory(), (all) => {
      expect(all).toStrictEqual([]);
    });
  });

  it('reports every initial and queued listener failure', async () => {
    const service = new HistoryService();
    service.on('contentAdded', createQueuedFailureListener(service));

    let thrown: unknown;
    try {
      service.add(createUserMessage('initial'));
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AggregateError);
    const errors = aggregateErrors(thrown);
    expect(errors[0]).toMatchObject({ message: 'initial failure' });
    expect(errors[1]).toBeInstanceOf(AggregateError);
    expect(errorMessages(aggregateErrors(errors[1]))).toStrictEqual([
      'queued failure 1',
      'queued failure 2',
    ]);
    await collectRowsForAssertions(service.streamRawHistory(), (all) => {
      expect(all).toStrictEqual([]);
    });
  });

  it('keeps the committed content, its identity and its origin when afterPublication rejects a replaceAll', async () => {
    await withNativeDetachedFixture(async ({ history: service, session }) => {
      const origin = { name: 'session' };
      const summary = createUserMessage('committed-summary');
      const candidate = createUserMessage('rejected-summary');
      await service.replaceAll([summary], undefined, { origin });
      const committedTokens = service.getTotalTokens();
      const committed = await session.store.snapshot();
      try {
        const identity = await committed.entryAt(0);
        const content = decodeStoredRow(await committed.readRow(identity));
        expect(content).toMatchObject(summary);
        expect(committed.rows).toBe(1);

        await expect(
          service.replaceAll([candidate], undefined, {
            origin,
            afterPublication: async () => {
              await collectRowsForAssertions(
                service.streamRawHistory(),
                (all) => {
                  expect(all).toHaveLength(1);
                  expect(all[0]).toMatchObject(candidate);
                },
              );
              throw new Error('reject summary replacement');
            },
          }),
        ).rejects.toThrow('reject summary replacement');

        await collectRowsForAssertions(service.streamRawHistory(), (all) => {
          expect(all).toStrictEqual([content]);
          expect(
            all.some(
              (row) =>
                row.blocks[0]?.type === 'text' &&
                row.blocks[0].text === 'rejected-summary',
            ),
          ).toBe(false);
        });
        const restored = await session.store.snapshot();
        try {
          expect(restored.rows).toBe(1);
          const entry = await restored.entryAt(0);
          expect(entry).toStrictEqual(identity);
          expect(decodeStoredRow(await restored.readRow(entry))).toStrictEqual(
            content,
          );
          expect(
            await new JournalOwners(session.store).originOf(entry.owner),
          ).toBe(historyOriginId(origin));
        } finally {
          await restored.close();
        }
        expect(service.getTotalTokens()).toBe(committedTokens);
        await expectConsistentTokenCount(service);
      } finally {
        await committed.close();
      }
    });
  });
});
