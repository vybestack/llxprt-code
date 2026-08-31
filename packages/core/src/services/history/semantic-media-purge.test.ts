/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  assertDefined,
  assertInstanceOf,
} from '@vybestack/llxprt-code-test-utils';
import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import { annotateCompressionSpan } from './historyChronology.js';
import type { IContent, MediaBlock } from './IContent.js';
import {
  SemanticMediaPurgeCoordinator,
  type SemanticMediaPurgeOutcome,
} from './semantic-media-purge.js';

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
  const history = new HistoryService();
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
    history.getAll().map((entry) => ({
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

describe('SemanticMediaPurgeCoordinator', () => {
  it('is disabled unless explicitly enabled', () => {
    const history = createHistory();
    const coordinator = new SemanticMediaPurgeCoordinator(history, {
      explicitCacheWriteRequired: false,
    });

    expect(coordinator.begin({ mode: 'remove' })).toBeUndefined();
  });

  it('does nothing until an explicit transaction is begun and committed', async () => {
    const history = createHistory();
    const coordinator = new SemanticMediaPurgeCoordinator(history, {
      enabled: true,
      explicitCacheWriteRequired: true,
    });

    const transaction = coordinator.begin({ mode: 'remove' });

    expectOriginalHistory(history);
    expect(transaction?.candidateHistory[2]?.blocks).toStrictEqual([
      { type: 'text', text: 'inspect' },
      secondImage,
    ]);
    expect(Object.isFrozen(transaction?.candidateHistory)).toBe(true);
    expect(Object.isFrozen(transaction?.candidateHistory[2]?.blocks)).toBe(
      true,
    );
    expect(coordinator.frontier).toStrictEqual({
      contentIndex: 0,
      blockIndex: 0,
    });
  });

  it('commits a structured summary and preserves stored parents before the changed image', async () => {
    const history = createHistory();
    const coordinator = new SemanticMediaPurgeCoordinator(history, {
      enabled: true,
      explicitCacheWriteRequired: true,
    });
    const transaction = coordinator.begin({
      mode: 'summary',
      summaryText: 'Screenshot showed a green build.',
    });
    assertDefined(transaction, 'Expected a purge transaction');

    const committed = await coordinator.commit(transaction, success);
    const result = history.getAll();

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

  it('advances oldest-first across two successful transactions', async () => {
    const history = createHistory();
    const coordinator = new SemanticMediaPurgeCoordinator(history, {
      enabled: true,
      explicitCacheWriteRequired: false,
    });
    const first = coordinator.begin({ mode: 'remove' });
    assertDefined(first, 'Expected the first purge transaction');
    await coordinator.commit(first, {
      status: 'success',
      cachePrefixWritten: false,
    });

    const second = coordinator.begin({ mode: 'remove' });
    assertDefined(second, 'Expected the second purge transaction');
    await coordinator.commit(second, {
      status: 'success',
      cachePrefixWritten: false,
    });

    expect(history.getAll()[2]?.blocks).toStrictEqual([
      { type: 'text', text: 'inspect' },
    ]);
    expect(coordinator.begin({ mode: 'remove' })).toBeUndefined();
  });

  it('rebases the durable frontier after earlier contents and blocks are compressed', async () => {
    const history = createHistory();
    const coordinator = new SemanticMediaPurgeCoordinator(history, {
      enabled: true,
      explicitCacheWriteRequired: false,
    });
    const first = coordinator.begin({ mode: 'remove' });
    assertDefined(first, 'Expected the first purge transaction');
    await coordinator.commit(first, success);
    const afterFirstPurge = history.getAll();
    const compressed = annotateCompressionSpan(afterFirstPurge, [
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
    ]);
    history.startCompression();
    history.clear();
    history.addAll(compressed);
    history.endCompression();

    const next = coordinator.begin({ mode: 'remove' });

    expect(next?.changedContentIndex).toBe(1);
    expect(next?.changedBlockIndex).toBe(0);
    expect(next?.candidateHistory[0]?.metadata?.id).toBe('compressed-summary');
    expect(next?.candidateHistory[1]).toBeUndefined();
  });

  it('retains legacy parameterized image MIME recognition', () => {
    const history = new HistoryService();
    history.add(
      content('human', 'parameterized-image', [
        { ...firstImage, mimeType: 'image/png; charset=utf-8' },
      ]),
    );
    const coordinator = new SemanticMediaPurgeCoordinator(history, {
      enabled: true,
      explicitCacheWriteRequired: false,
    });

    const transaction = coordinator.begin({ mode: 'remove' });

    expect(transaction?.changedContentIndex).toBe(0);
    expect(transaction?.changedBlockIndex).toBe(0);
  });

  it('reports malformed image MIME data with purge location context', () => {
    const malformedMimeValues: readonly unknown[] = [undefined, 42, 'image'];

    for (const malformedMime of malformedMimeValues) {
      const malformedImage = { ...firstImage };
      if (malformedMime === undefined) {
        Reflect.deleteProperty(malformedImage, 'mimeType');
      } else {
        Reflect.set(malformedImage, 'mimeType', malformedMime);
      }
      const history = new HistoryService();
      history.add(content('human', 'malformed-image', [malformedImage]));
      const coordinator = new SemanticMediaPurgeCoordinator(history, {
        enabled: true,
        explicitCacheWriteRequired: false,
      });

      let captured: unknown;
      try {
        coordinator.begin({ mode: 'remove' });
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

  it('skips an uncaptioned image in summary mode and advances to a later captioned image', async () => {
    const history = new HistoryService();
    const { caption: _caption, ...uncaptionedImage } = firstImage;
    history.add(content('human', 'uncaptioned-image', [uncaptionedImage]));
    history.add(
      content('human', 'captioned-image', [
        { ...firstImage, caption: 'A green build result.' },
      ]),
    );
    const coordinator = new SemanticMediaPurgeCoordinator(history, {
      enabled: true,
      explicitCacheWriteRequired: false,
    });

    const transaction = coordinator.begin({ mode: 'summary' });
    assertDefined(
      transaction,
      'Expected the captioned image to produce a transaction',
    );
    await coordinator.commit(transaction, success);

    expect(history.getAll()[0]?.blocks).toStrictEqual([uncaptionedImage]);
    expect(history.getAll()[1]?.blocks).toStrictEqual([
      { type: 'text', text: 'A green build result.' },
    ]);
  });

  it('preserves every earlier stored response when removing an image-only final content', async () => {
    const history = new HistoryService();
    history.add(
      content('ai', 'first-parent', [{ type: 'text', text: 'first' }], true),
    );
    history.add(
      content('ai', 'second-parent', [{ type: 'text', text: 'second' }], true),
    );
    history.add(content('human', 'final-image', [firstImage]));
    const coordinator = new SemanticMediaPurgeCoordinator(history, {
      enabled: true,
      explicitCacheWriteRequired: false,
    });
    const transaction = coordinator.begin({ mode: 'remove' });
    assertDefined(transaction, 'Expected a purge transaction');

    await coordinator.commit(transaction, success);

    expect(
      history.getAll().map((entry) => entry.metadata?.responsesStored),
    ).toStrictEqual([true, true]);
  });

  it('leaves history and frontier unchanged for errors, cancellation, retry handoff, and missing cache proof', async () => {
    const outcomes: SemanticMediaPurgeOutcome[] = [
      { status: 'error', cachePrefixWritten: true },
      { status: 'cancelled', cachePrefixWritten: true },
      { status: 'retry-handoff', cachePrefixWritten: true },
      { status: 'success', cachePrefixWritten: false },
    ];

    for (const outcome of outcomes) {
      const history = createHistory();
      const coordinator = new SemanticMediaPurgeCoordinator(history, {
        enabled: true,
        explicitCacheWriteRequired: true,
      });
      const transaction = coordinator.begin({ mode: 'remove' });
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

  it('rehydrates the frontier after wholesale history replacement and clear', async () => {
    const history = createHistory();
    const coordinator = new SemanticMediaPurgeCoordinator(history, {
      enabled: true,
      explicitCacheWriteRequired: false,
    });
    const first = coordinator.begin({ mode: 'remove' });
    assertDefined(first, 'Expected first purge transaction');
    await coordinator.commit(first, success);

    await history.replaceAll([
      content('human', 'replacement-image', [
        { type: 'text', text: 'replacement' },
        firstImage,
      ]),
    ]);

    const afterReplacement = coordinator.begin({ mode: 'remove' });
    expect(afterReplacement?.changedContentIndex).toBe(0);
    expect(afterReplacement?.changedBlockIndex).toBe(1);

    history.clear();
    history.add(content('human', 'after-clear-image', [firstImage]));

    const afterClear = coordinator.begin({ mode: 'remove' });
    expect(afterClear?.changedContentIndex).toBe(0);
    expect(afterClear?.changedBlockIndex).toBe(0);
  });

  it('rejects a stale transaction without replacing newer history', async () => {
    const history = createHistory();
    const coordinator = new SemanticMediaPurgeCoordinator(history, {
      enabled: true,
      explicitCacheWriteRequired: false,
    });
    const transaction = coordinator.begin({ mode: 'remove' });
    assertDefined(transaction, 'Expected a purge transaction');
    history.add(content('human', 'newer', [{ type: 'text', text: 'newer' }]));

    await expect(coordinator.commit(transaction, success)).rejects.toThrow(
      /history changed/i,
    );
    const currentHistory = history.getAll();
    expect(currentHistory[currentHistory.length - 1]?.metadata?.id).toBe(
      'newer',
    );
  });

  it('rejects stale rollback without overwriting history added after purge commit', async () => {
    const history = createHistory();
    const coordinator = new SemanticMediaPurgeCoordinator(history, {
      enabled: true,
      explicitCacheWriteRequired: false,
    });
    const transaction = coordinator.begin({ mode: 'remove' });
    assertDefined(transaction, 'Expected a purge transaction');
    await coordinator.commit(transaction, success);
    history.add(content('human', 'newer', [{ type: 'text', text: 'newer' }]));

    await expect(coordinator.rollback(transaction)).rejects.toThrow(
      /history changed/i,
    );

    const currentHistory = history.getAll();
    expect(currentHistory[currentHistory.length - 1]?.metadata?.id).toBe(
      'newer',
    );
    expect(coordinator.frontier).toStrictEqual(transaction.nextFrontier);
  });

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
    const coordinator = new SemanticMediaPurgeCoordinator(history, {
      enabled: true,
      explicitCacheWriteRequired: false,
      persist: async () => {
        persistenceStarted?.();
        await persistenceGate;
      },
    });
    const transaction = coordinator.begin({ mode: 'remove' });
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
    expect(history.getAll()[history.getAll().length - 1]).toBe(newer);
  });

  it('persists candidate history and frontier before committing and restores the session frontier', async () => {
    const history = createHistory();
    let durableHistory: readonly IContent[] | undefined;
    let durableFrontier:
      | { readonly contentIndex: number; readonly blockIndex: number }
      | undefined;
    const coordinator = new SemanticMediaPurgeCoordinator(history, {
      enabled: true,
      explicitCacheWriteRequired: false,
      persist: (candidateHistory, frontier) => {
        durableHistory = candidateHistory;
        durableFrontier = frontier;
        return Promise.resolve();
      },
    });
    const transaction = coordinator.begin({ mode: 'remove' });
    assertDefined(transaction, 'Expected purge transaction');
    const committed = await coordinator.commit(transaction, success);

    expect(committed).toBe(true);
    expect(durableHistory).toBe(transaction.candidateHistory);
    expect(durableFrontier).toStrictEqual(coordinator.frontier);
    const resumedHistory = new HistoryService();
    resumedHistory.addAll(history.getAll());
    const resumed = new SemanticMediaPurgeCoordinator(resumedHistory, {
      enabled: true,
      explicitCacheWriteRequired: false,
    });
    expect(resumed.frontier).toStrictEqual(coordinator.frontier);
  });

  it('rolls back when durable session state cannot be written', async () => {
    const history = createHistory();
    const coordinator = new SemanticMediaPurgeCoordinator(history, {
      enabled: true,
      explicitCacheWriteRequired: false,
      persist: () => Promise.reject(new Error('recording unavailable')),
    });
    const transaction = coordinator.begin({ mode: 'remove' });
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

  it('compensates durable state when live history replacement fails', async () => {
    const history = createHistory();
    const persisted: Array<{
      readonly history: readonly IContent[];
      readonly frontier: {
        readonly contentIndex: number;
        readonly blockIndex: number;
      };
    }> = [];
    const coordinator = new SemanticMediaPurgeCoordinator(history, {
      enabled: true,
      explicitCacheWriteRequired: false,
      persist: (candidateHistory, frontier) => {
        persisted.push({ history: candidateHistory, frontier });
        return Promise.resolve();
      },
    });
    const transaction = coordinator.begin({ mode: 'remove' });
    assertDefined(transaction, 'Expected purge transaction');
    history.on('tokensUpdated', () => {
      throw new Error('listener failure');
    });

    await expect(coordinator.commit(transaction, success)).rejects.toThrow(
      'listener failure',
    );

    expectOriginalHistory(history);
    expect(persisted).toHaveLength(2);
    expect(persisted[0]?.history).toBe(transaction.candidateHistory);
    expect(persisted[1]?.history).toBe(transaction.baseHistory);
    expect(persisted[1]?.frontier).toStrictEqual({
      contentIndex: 0,
      blockIndex: 0,
    });
    expect(coordinator.frontier).toStrictEqual({
      contentIndex: 0,
      blockIndex: 0,
    });
  });

  it('compensates durable state when committed purge rollback cannot replace live history', async () => {
    const history = createHistory();
    const persisted: Array<readonly IContent[]> = [];
    const coordinator = new SemanticMediaPurgeCoordinator(history, {
      enabled: true,
      explicitCacheWriteRequired: false,
      persist: (candidateHistory) => {
        persisted.push(candidateHistory);
        return Promise.resolve();
      },
    });
    const transaction = coordinator.begin({ mode: 'remove' });
    assertDefined(transaction, 'Expected purge transaction');
    await coordinator.commit(transaction, success);
    history.on('tokensUpdated', () => {
      throw new Error('rollback listener failure');
    });

    await expect(coordinator.rollback(transaction)).rejects.toThrow(
      'rollback listener failure',
    );

    expect(history.getAll()).toStrictEqual([...transaction.candidateHistory]);
    expect(persisted).toHaveLength(3);
    expect(persisted[1]).toBe(transaction.baseHistory);
    expect(persisted[2]).toBe(transaction.candidateHistory);
    expect(coordinator.frontier).toStrictEqual(transaction.nextFrontier);
  });

  it('reports both live replacement and durable compensation failures', async () => {
    const history = createHistory();
    let persistenceAttempt = 0;
    const coordinator = new SemanticMediaPurgeCoordinator(history, {
      enabled: true,
      explicitCacheWriteRequired: false,
      persist: () => {
        persistenceAttempt += 1;
        return persistenceAttempt === 1
          ? Promise.resolve()
          : Promise.reject(new Error('compensation unavailable'));
      },
    });
    const transaction = coordinator.begin({ mode: 'remove' });
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
