import { observeHistorySynchronouslyForTest as testHistory } from '../../test-utils/synchronous-history-test-observation.js';
import { collectRowsForAssertions } from '../../test-utils/collect-rows-for-assertions.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  assertDefined,
  assertInstanceOf,
} from '@vybestack/llxprt-code-test-utils';
import { afterEach, describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import { annotateCompressionSpan } from './historyChronology.js';
import type { IContent, MediaBlock } from './IContent.js';
import type {
  SemanticMediaPurgeOutcome,
  SemanticMediaPurgeOptions,
} from './semantic-media-purge.js';
import {
  SemanticMediaPurgeStreamCoordinator,
  type SemanticPurgeStreamTransaction,
} from './semantic-purge-stream.js';
import type { SemanticPurgeRowSource } from './semantic-purge-disk-rows.js';

const histories: HistoryService[] = [];
const transactions: SemanticPurgeStreamTransaction[] = [];

function trackedHistory(): HistoryService {
  const history = new HistoryService();
  histories.push(history);
  return history;
}
async function begin(
  coordinator: SemanticMediaPurgeStreamCoordinator,
  options: SemanticMediaPurgeOptions,
): Promise<SemanticPurgeStreamTransaction | undefined> {
  const transaction = await coordinator.begin(options);
  if (transaction) transactions.push(transaction);
  return transaction;
}
async function collect(
  source: SemanticPurgeRowSource | undefined,
): Promise<IContent[]> {
  const rows: IContent[] = [];
  if (source) for await (const row of source.streamRows()) rows.push(row);
  return rows;
}

const firstImage: MediaBlock = {
  type: 'media',
  mimeType: 'image/png',
  encoding: 'base64',
  data: 'aW1hZ2Utb25l',
  caption: 'first screenshot',
};

const secondImage: MediaBlock = {
  type: 'media',
  mimeType: 'image/png',
  encoding: 'base64',
  data: 'aW1hZ2UtdHdv',
  caption: 'second screenshot',
  sourceContentId:
    'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
};

function content(
  speaker: IContent['speaker'],
  id: string,
  blocks: IContent['blocks'],
  responsesStored = false,
): IContent {
  return {
    speaker,
    blocks,
    metadata: {
      id,
      ...(responsesStored ? { responsesStored: true } : {}),
    },
  };
}

function createHistory(): HistoryService {
  const history = trackedHistory();
  history.add(content('human', 'before', [{ type: 'text', text: 'before' }]));
  history.add(
    content('ai', 'parent', [{ type: 'text', text: 'parent' }], true),
  );
  history.add(
    content('human', 'images', [
      { type: 'text', text: 'inspect' },
      firstImage,
      secondImage,
    ]),
  );
  history.add(
    content('ai', 'suffix', [{ type: 'text', text: 'suffix' }], true),
  );
  return history;
}

function requireAggregateError(error: unknown): AggregateError {
  assertInstanceOf(
    error,
    AggregateError,
    `Expected AggregateError, received ${String(error)}`,
  );
  return error;
}

function expectOriginalHistory(history: HistoryService): void {
  expect(
    testHistory(history).map((entry) => ({
      speaker: entry.speaker,
      id: entry.metadata?.id,
      responsesStored: entry.metadata?.responsesStored === true,
      blocks: entry.blocks,
    })),
  ).toStrictEqual([
    {
      speaker: 'human',
      id: 'before',
      responsesStored: false,
      blocks: [{ type: 'text', text: 'before' }],
    },
    {
      speaker: 'ai',
      id: 'parent',
      responsesStored: true,
      blocks: [{ type: 'text', text: 'parent' }],
    },
    {
      speaker: 'human',
      id: 'images',
      responsesStored: false,
      blocks: [{ type: 'text', text: 'inspect' }, firstImage, secondImage],
    },
    {
      speaker: 'ai',
      id: 'suffix',
      responsesStored: true,
      blocks: [{ type: 'text', text: 'suffix' }],
    },
  ]);
}

const success: SemanticMediaPurgeOutcome = {
  status: 'success',
  cachePrefixWritten: true,
};

function cleanupPurge(): void {
  for (const transaction of transactions.splice(0)) transaction.close();
  for (const history of histories.splice(0)) history.dispose();
}

describe('SemanticMediaPurgeStreamCoordinator: is disabled unless explicitly enabled', () => {
  afterEach(cleanupPurge);
  it('is disabled unless explicitly enabled', async () => {
    const history = createHistory();
    const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
      explicitCacheWriteRequired: false,
    });

    expect(await begin(coordinator, { mode: 'remove' })).toBeUndefined();
  });
});

describe('SemanticMediaPurgeStreamCoordinator: does nothing until an explicit transaction is begun and committed', () => {
  afterEach(cleanupPurge);
  it('does nothing until an explicit transaction is begun and committed', async () => {
    const history = createHistory();
    const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
      enabled: true,
      explicitCacheWriteRequired: true,
    });

    const transaction = await begin(coordinator, { mode: 'remove' });

    expectOriginalHistory(history);
    expect((await collect(transaction?.candidate))[2]?.blocks).toStrictEqual([
      { type: 'text', text: 'inspect' },
      secondImage,
    ]);
    expect(Object.isFrozen(transaction?.candidate)).toBe(true);
    expect(
      Object.isFrozen((await collect(transaction?.candidate))[2]?.blocks),
    ).toBe(true);
    expect(coordinator.frontier).toStrictEqual({
      contentIndex: 0,
      blockIndex: 0,
    });
  });
});

describe('SemanticMediaPurgeStreamCoordinator: commits a structured summary and preserves stored parents before the changed image', () => {
  afterEach(cleanupPurge);
  it('commits a structured summary and preserves stored parents before the changed image', async () => {
    const history = createHistory();
    const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
      enabled: true,
      explicitCacheWriteRequired: true,
    });
    const transaction = await begin(coordinator, {
      mode: 'summary',
      summaryText: 'Screenshot showed a green build.',
    });
    assertDefined(transaction, 'Expected a purge transaction');

    const committed = await coordinator.commit(transaction, success);
    await collectRowsForAssertions(history.streamRawHistory(), async (rows) => {
      const result = rows;

      expect(committed).toBe(true);
      expect(result[1]?.metadata?.responsesStored).toBe(true);
      expect(result[3]?.metadata?.responsesStored).toBeUndefined();
      expect(result[2]?.blocks).toStrictEqual([
        { type: 'text', text: 'inspect' },
        { type: 'text', text: 'Screenshot showed a green build.' },
        secondImage,
      ]);
      expect(coordinator.frontier).toStrictEqual({
        contentIndex: 2,
        blockIndex: 2,
        contentId: 'images',
        mediaId:
          'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      });
    });
  });
});

describe('SemanticMediaPurgeStreamCoordinator: advances oldest-first across two successful transactions', () => {
  afterEach(cleanupPurge);
  it('advances oldest-first across two successful transactions', async () => {
    const history = createHistory();
    const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
      enabled: true,
      explicitCacheWriteRequired: false,
    });
    const first = await begin(coordinator, { mode: 'remove' });
    assertDefined(first, 'Expected the first purge transaction');
    await coordinator.commit(first, {
      status: 'success',
      cachePrefixWritten: false,
    });

    const second = await begin(coordinator, { mode: 'remove' });
    assertDefined(second, 'Expected the second purge transaction');
    await coordinator.commit(second, {
      status: 'success',
      cachePrefixWritten: false,
    });

    await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
      expect(rows[2]?.blocks).toStrictEqual([
        { type: 'text', text: 'inspect' },
      ]);
    });
    expect(await begin(coordinator, { mode: 'remove' })).toBeUndefined();
  });
});

describe('SemanticMediaPurgeStreamCoordinator: rebases the durable frontier after earlier contents and blocks are compressed', () => {
  afterEach(cleanupPurge);
  it('rebases the durable frontier after earlier contents and blocks are compressed', async () => {
    const history = createHistory();
    const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
      enabled: true,
      explicitCacheWriteRequired: false,
    });
    const first = await begin(coordinator, { mode: 'remove' });
    assertDefined(first, 'Expected the first purge transaction');
    await coordinator.commit(first, success);
    await collectRowsForAssertions(history.streamRawHistory(), async (rows) => {
      const afterFirstPurge = rows;
      const compressed = annotateCompressionSpan(
        [...afterFirstPurge],
        [
          {
            speaker: 'ai',
            blocks: [
              {
                ...firstImage,
                data: 'Y29tcHJlc3NlZC1lYXJsaWVyLWltYWdl',
                sourceContentId:
                  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              },
            ],
            metadata: {
              id: 'compressed-summary',
              isSummary: true,
            },
          },
          content('human', 'images', [secondImage]),
        ],
      );
      history.startCompression();
      history.clear();
      history.addAll(compressed);
      history.endCompression();

      const next = await begin(coordinator, { mode: 'remove' });

      expect(next?.changedContentIndex).toBe(1);
      expect(next?.changedBlockIndex).toBe(0);
      expect((await collect(next?.candidate))[0]?.metadata?.id).toBe(
        'compressed-summary',
      );
      expect((await collect(next?.candidate))[1]).toBeUndefined();
    });
  });
});

describe('SemanticMediaPurgeStreamCoordinator: retains legacy parameterized image MIME recognition', () => {
  afterEach(cleanupPurge);
  it('retains legacy parameterized image MIME recognition', async () => {
    const history = trackedHistory();
    history.add(
      content('human', 'parameterized-image', [
        { ...firstImage, mimeType: 'image/png; charset=utf-8' },
      ]),
    );
    const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
      enabled: true,
      explicitCacheWriteRequired: false,
    });

    const transaction = await begin(coordinator, { mode: 'remove' });

    expect(transaction?.changedContentIndex).toBe(0);
    expect(transaction?.changedBlockIndex).toBe(0);
  });
});

describe('SemanticMediaPurgeStreamCoordinator: reports malformed image MIME data with purge location context', () => {
  afterEach(cleanupPurge);
  it('reports malformed image MIME data with purge location context', async () => {
    const malformedMimeValues: readonly unknown[] = [undefined, 42, 'image'];

    for (const malformedMime of malformedMimeValues) {
      const malformedImage = { ...firstImage };
      if (malformedMime === undefined) {
        Reflect.deleteProperty(malformedImage, 'mimeType');
      } else {
        Reflect.set(malformedImage, 'mimeType', malformedMime);
      }
      const history = trackedHistory();
      history.add(content('human', 'malformed-image', [malformedImage]));
      const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
        enabled: true,
        explicitCacheWriteRequired: false,
      });

      let captured: unknown;
      try {
        await begin(coordinator, { mode: 'remove' });
      } catch (error) {
        captured = error;
      }

      expect(captured).toBeInstanceOf(Error);
      expect(captured).not.toBeInstanceOf(TypeError);
      expect(String(captured)).toMatch(
        /semantic media purge.*contentIndex=0.*blockIndex=0.*MIME/i,
      );
    }
  });
});

describe('SemanticMediaPurgeStreamCoordinator: skips an uncaptioned image in summary mode and advances to a later captioned image', () => {
  afterEach(cleanupPurge);
  it('skips an uncaptioned image in summary mode and advances to a later captioned image', async () => {
    const history = trackedHistory();
    const { caption: _caption, ...uncaptionedImage } = firstImage;
    history.add(content('human', 'uncaptioned-image', [uncaptionedImage]));
    history.add(
      content('human', 'captioned-image', [
        { ...firstImage, caption: 'A green build result.' },
      ]),
    );
    const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
      enabled: true,
      explicitCacheWriteRequired: false,
    });

    const transaction = await begin(coordinator, { mode: 'summary' });
    assertDefined(
      transaction,
      'Expected the captioned image to produce a transaction',
    );
    await coordinator.commit(transaction, success);

    await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
      expect(rows[0]?.blocks).toStrictEqual([uncaptionedImage]);
    });
    await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
      expect(rows[1]?.blocks).toStrictEqual([
        { type: 'text', text: 'A green build result.' },
      ]);
    });
  });
});

describe('SemanticMediaPurgeStreamCoordinator: preserves every earlier stored response when removing an image-only final content', () => {
  afterEach(cleanupPurge);
  it('preserves every earlier stored response when removing an image-only final content', async () => {
    const history = trackedHistory();
    history.add(
      content('ai', 'first-parent', [{ type: 'text', text: 'first' }], true),
    );
    history.add(
      content('ai', 'second-parent', [{ type: 'text', text: 'second' }], true),
    );
    history.add(content('human', 'final-image', [firstImage]));
    const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
      enabled: true,
      explicitCacheWriteRequired: false,
    });
    const transaction = await begin(coordinator, { mode: 'remove' });
    assertDefined(transaction, 'Expected a purge transaction');

    await coordinator.commit(transaction, success);

    await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
      expect(
        rows.map((entry) => entry.metadata?.responsesStored),
      ).toStrictEqual([true, true]);
    });
  });
});

describe('SemanticMediaPurgeStreamCoordinator: leaves history and frontier unchanged for errors, cancellation, retry handoff, and missing cache proof', () => {
  afterEach(cleanupPurge);
  it('leaves history and frontier unchanged for errors, cancellation, retry handoff, and missing cache proof', async () => {
    const outcomes: SemanticMediaPurgeOutcome[] = [
      { status: 'error', cachePrefixWritten: true },
      { status: 'cancelled', cachePrefixWritten: true },
      { status: 'retry-handoff', cachePrefixWritten: true },
      { status: 'success', cachePrefixWritten: false },
    ];

    for (const outcome of outcomes) {
      const history = createHistory();
      const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
        enabled: true,
        explicitCacheWriteRequired: true,
      });
      const transaction = await begin(coordinator, { mode: 'remove' });
      assertDefined(transaction, 'Expected a purge transaction');

      const committed = await coordinator.commit(transaction, outcome);

      expect(committed).toBe(false);
      expectOriginalHistory(history);
      expect(coordinator.frontier).toStrictEqual({
        contentIndex: 0,
        blockIndex: 0,
      });
    }
  });
});

describe('SemanticMediaPurgeStreamCoordinator: rehydrates the frontier after wholesale history replacement and clear', () => {
  afterEach(cleanupPurge);
  it('rehydrates the frontier after wholesale history replacement and clear', async () => {
    const history = createHistory();
    const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
      enabled: true,
      explicitCacheWriteRequired: false,
    });
    const first = await begin(coordinator, { mode: 'remove' });
    assertDefined(first, 'Expected first purge transaction');
    await coordinator.commit(first, success);

    await history.replaceAll([
      content('human', 'replacement-image', [
        { type: 'text', text: 'replacement' },
        firstImage,
      ]),
    ]);

    const afterReplacement = await begin(coordinator, { mode: 'remove' });
    expect(afterReplacement?.changedContentIndex).toBe(0);
    expect(afterReplacement?.changedBlockIndex).toBe(1);

    history.clear();
    history.add(content('human', 'after-clear-image', [firstImage]));

    const afterClear = await begin(coordinator, { mode: 'remove' });
    expect(afterClear?.changedContentIndex).toBe(0);
    expect(afterClear?.changedBlockIndex).toBe(0);
  });
});

describe('SemanticMediaPurgeStreamCoordinator: rejects a stale transaction without replacing newer history', () => {
  afterEach(cleanupPurge);
  it('rejects a stale transaction without replacing newer history', async () => {
    const history = createHistory();
    const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
      enabled: true,
      explicitCacheWriteRequired: false,
    });
    const transaction = await begin(coordinator, { mode: 'remove' });
    assertDefined(transaction, 'Expected a purge transaction');
    history.add(content('human', 'newer', [{ type: 'text', text: 'newer' }]));

    await expect(coordinator.commit(transaction, success)).rejects.toThrow(
      /history changed/i,
    );
    await collectRowsForAssertions(history.streamRawHistory(), async (rows) => {
      const currentHistory = rows;
      expect(currentHistory[currentHistory.length - 1]?.metadata?.id).toBe(
        'newer',
      );
    });
  });
});

describe('SemanticMediaPurgeStreamCoordinator: rejects stale rollback without overwriting history added after purge commit', () => {
  afterEach(cleanupPurge);
  it('rejects stale rollback without overwriting history added after purge commit', async () => {
    const history = createHistory();
    const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
      enabled: true,
      explicitCacheWriteRequired: false,
    });
    const transaction = await begin(coordinator, { mode: 'remove' });
    assertDefined(transaction, 'Expected a purge transaction');
    await coordinator.commit(transaction, success);
    history.add(content('human', 'newer', [{ type: 'text', text: 'newer' }]));

    await expect(coordinator.rollback(transaction)).rejects.toThrow(
      /history changed/i,
    );

    await collectRowsForAssertions(history.streamRawHistory(), async (rows) => {
      const currentHistory = rows;
      expect(currentHistory[currentHistory.length - 1]?.metadata?.id).toBe(
        'newer',
      );
      expect(coordinator.frontier).toStrictEqual(transaction.nextFrontier);
    });
  });
});

describe('SemanticMediaPurgeStreamCoordinator: does not overwrite a synchronous add made while durable purge persistence is pending', () => {
  afterEach(cleanupPurge);
  it('does not overwrite a synchronous add made while durable purge persistence is pending', async () => {
    const history = createHistory();
    let persistenceStarted: (() => void) | undefined;
    let releasePersistence: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      persistenceStarted = resolve;
    });
    const persistenceGate = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });
    const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
      enabled: true,
      explicitCacheWriteRequired: false,
      persist: async () => {
        persistenceStarted?.();
        await persistenceGate;
      },
    });
    const transaction = await begin(coordinator, { mode: 'remove' });
    assertDefined(transaction, 'Expected a purge transaction');
    const newer = content('human', 'newer-during-persist', [
      { type: 'text', text: 'newer' },
    ]);

    const committing = coordinator.commit(transaction, success);
    await started;
    history.add(newer);
    releasePersistence?.();
    const committed = await committing;

    expect(committed).toBe(true);
    await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
      expect(rows[rows.length - 1]).toBe(newer);
    });
  });
});

describe('SemanticMediaPurgeStreamCoordinator: persists candidate history and frontier before committing and restores the session frontier', () => {
  afterEach(cleanupPurge);
  it('persists candidate history and frontier before committing and restores the session frontier', async () => {
    const history = createHistory();
    let durableHistory: SemanticPurgeRowSource | undefined;
    let durableFrontier:
      | { readonly contentIndex: number; readonly blockIndex: number }
      | undefined;
    const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
      enabled: true,
      explicitCacheWriteRequired: false,
      persist: (candidateHistory, frontier) => {
        durableHistory = candidateHistory;
        durableFrontier = frontier;
        return Promise.resolve();
      },
    });
    const transaction = await begin(coordinator, { mode: 'remove' });
    assertDefined(transaction, 'Expected purge transaction');
    const committed = await coordinator.commit(transaction, success);

    expect(committed).toBe(true);
    expect(durableHistory).toBe(transaction.candidate);
    expect(durableFrontier).toStrictEqual(coordinator.frontier);
    const resumedHistory = trackedHistory();
    await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
      resumedHistory.addAll([...rows]);
    });
    const resumed = new SemanticMediaPurgeStreamCoordinator(resumedHistory, {
      enabled: true,
      explicitCacheWriteRequired: false,
    });
    await begin(resumed, { mode: 'remove' });
    expect(resumed.frontier).toStrictEqual(coordinator.frontier);
  });
});

describe('SemanticMediaPurgeStreamCoordinator: rolls back when durable session state cannot be written', () => {
  afterEach(cleanupPurge);
  it('rolls back when durable session state cannot be written', async () => {
    const history = createHistory();
    const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
      enabled: true,
      explicitCacheWriteRequired: false,
      persist: () => Promise.reject(new Error('recording unavailable')),
    });
    const transaction = await begin(coordinator, { mode: 'remove' });
    assertDefined(transaction, 'Expected purge transaction');
    await expect(coordinator.commit(transaction, success)).rejects.toThrow(
      'recording unavailable',
    );
    expectOriginalHistory(history);
    expect(coordinator.frontier).toStrictEqual({
      contentIndex: 0,
      blockIndex: 0,
    });
  });
});

describe('SemanticMediaPurgeStreamCoordinator: compensates durable state when live history replacement fails', () => {
  afterEach(cleanupPurge);
  it('compensates durable state when live history replacement fails', async () => {
    const history = createHistory();
    const persisted: Array<{
      readonly history: SemanticPurgeRowSource;
      readonly frontier: {
        readonly contentIndex: number;
        readonly blockIndex: number;
      };
    }> = [];
    const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
      enabled: true,
      explicitCacheWriteRequired: false,
      persist: (candidateHistory, frontier) => {
        persisted.push({ history: candidateHistory, frontier });
        return Promise.resolve();
      },
    });
    const transaction = await begin(coordinator, { mode: 'remove' });
    assertDefined(transaction, 'Expected purge transaction');
    history.on('tokensUpdated', () => {
      throw new Error('listener failure');
    });

    await expect(coordinator.commit(transaction, success)).rejects.toThrow(
      'listener failure',
    );

    expectOriginalHistory(history);
    expect(persisted).toHaveLength(2);
    expect(persisted[0]?.history).toBe(transaction.candidate);
    expect(persisted[1]?.history).toBe(transaction.base);
    expect(persisted[1]?.frontier).toStrictEqual({
      contentIndex: 0,
      blockIndex: 0,
    });
    expect(coordinator.frontier).toStrictEqual({
      contentIndex: 0,
      blockIndex: 0,
    });
  });
});

describe('SemanticMediaPurgeStreamCoordinator: compensates durable state when committed purge rollback cannot replace live history', () => {
  afterEach(cleanupPurge);
  it('compensates durable state when committed purge rollback cannot replace live history', async () => {
    const history = createHistory();
    const persisted: SemanticPurgeRowSource[] = [];
    const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
      enabled: true,
      explicitCacheWriteRequired: false,
      persist: (candidateHistory) => {
        persisted.push(candidateHistory);
        return Promise.resolve();
      },
    });
    const transaction = await begin(coordinator, { mode: 'remove' });
    assertDefined(transaction, 'Expected purge transaction');
    await coordinator.commit(transaction, success);
    history.on('tokensUpdated', () => {
      throw new Error('rollback listener failure');
    });

    await expect(coordinator.rollback(transaction)).rejects.toThrow(
      'rollback listener failure',
    );

    await collectRowsForAssertions(history.streamRawHistory(), async (rows) => {
      expect(rows).toStrictEqual(await collect(transaction.candidate));
    });
    expect(persisted).toHaveLength(3);
    expect(persisted[1]).toBe(transaction.base);
    expect(persisted[2]).toBe(transaction.candidate);
    expect(coordinator.frontier).toStrictEqual(transaction.nextFrontier);
  });
});

describe('SemanticMediaPurgeStreamCoordinator: reports both live replacement and durable compensation failures', () => {
  afterEach(cleanupPurge);
  it('reports both live replacement and durable compensation failures', async () => {
    const history = createHistory();
    let persistenceAttempt = 0;
    const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
      enabled: true,
      explicitCacheWriteRequired: false,
      persist: () => {
        persistenceAttempt += 1;
        return persistenceAttempt === 1
          ? Promise.resolve()
          : Promise.reject(new Error('compensation unavailable'));
      },
    });
    const transaction = await begin(coordinator, { mode: 'remove' });
    assertDefined(transaction, 'Expected purge transaction');
    history.on('tokensUpdated', () => {
      throw new Error('listener failure');
    });

    const rejection = await coordinator.commit(transaction, success).then(
      (): unknown => undefined,
      (error: unknown): unknown => error,
    );
    expect(rejection).toBeInstanceOf(AggregateError);
    const aggregateError = requireAggregateError(rejection);
    expect(
      aggregateError.errors.map((cause: unknown) => String(cause)),
    ).toStrictEqual([
      'Error: listener failure',
      'Error: compensation unavailable',
    ]);
    expectOriginalHistory(history);
    expect(coordinator.frontier).toStrictEqual({
      contentIndex: 0,
      blockIndex: 0,
    });
  });
});
