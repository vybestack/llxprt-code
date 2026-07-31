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

import { describe, expect, it } from 'vitest';
import type { RuntimeTokenizerFactory } from '../../runtime/contracts/RuntimeTokenizerFactory.js';
import { createUserMessage } from './IContent.js';
import { HistoryService } from './HistoryService.js';

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
  const expected = await service.estimateTokensForContents(service.getAll());
  expect(service.getTotalTokens()).toBe(expected);
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

    expect(service.getAll()).toStrictEqual([replacement, appended]);
    await expectConsistentTokenCount(service);
  });

  it('applies clear after an in-flight replacement', async () => {
    const service = new HistoryService();
    const blocked = createBlockedTokenizerFactory();
    service.setTokenizerFactory(blocked.factory);
    const estimationStarted = blocked.blockNext();

    const replacing = service.replaceAll([createUserMessage('replacement')]);
    await estimationStarted;
    service.clear();
    blocked.release();
    await replacing;

    expect(service.getAll()).toStrictEqual([]);
    await expectConsistentTokenCount(service);
  });

  it('rolls back an add when a content listener rejects it', () => {
    const service = new HistoryService();
    service.on('contentAdded', () => {
      throw new Error('listener failed');
    });

    expect(() => service.add(createUserMessage('rejected'))).toThrow(
      'listener failed',
    );
    expect(service.getAll()).toStrictEqual([]);
  });

  it('reports every initial and queued listener failure', () => {
    const service = new HistoryService();
    let invocation = 0;
    service.on('contentAdded', () => {
      invocation += 1;
      if (invocation === 1) {
        service.add(createUserMessage('queued first'));
        service.add(createUserMessage('queued second'));
        throw new Error('initial failure');
      }
      throw new Error(`queued failure ${invocation - 1}`);
    });

    let thrown: unknown;
    try {
      service.add(createUserMessage('initial'));
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AggregateError);
    const aggregate = thrown as AggregateError;
    expect(aggregate.errors[0]).toMatchObject({ message: 'initial failure' });
    expect(aggregate.errors[1]).toBeInstanceOf(AggregateError);
    expect(
      (aggregate.errors[1] as AggregateError).errors.map((error) =>
        error instanceof Error ? error.message : String(error),
      ),
    ).toStrictEqual(['queued failure 1', 'queued failure 2']);
    expect(service.getAll()).toStrictEqual([]);
  });
});
