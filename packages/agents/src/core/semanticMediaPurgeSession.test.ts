/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { collectRowsForAssertions as withRows } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
import { assertDefined } from '@vybestack/llxprt-code-test-utils';
import { describe, expect, it } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type {
  IContent,
  UsageStats,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { SemanticMediaPurgeSession } from './semanticMediaPurgeSession.js';
import type { SemanticPurgeRowSource } from '@vybestack/llxprt-code-core/services/history/semantic-purge-disk-rows.js';

async function collect(source: SemanticPurgeRowSource): Promise<IContent[]> {
  const rows: IContent[] = [];
  for await (const row of source.streamRows()) rows.push(row);
  return rows;
}

function historyWithImage(): HistoryService {
  const history = new HistoryService();
  history.add({
    speaker: 'human',
    blocks: [
      { type: 'text', text: 'inspect' },
      {
        type: 'media',
        mimeType: 'image/png',
        encoding: 'base64',
        data: 'aW1hZ2U=',
        caption: 'A green build result.',
      },
    ],
  });
  return history;
}

const usageWithoutCacheWrite: UsageStats = {
  promptTokens: 20,
  completionTokens: 5,
  totalTokens: 25,
  cache_creation_input_tokens: 0,
};

const usageWithCacheWrite: UsageStats = {
  ...usageWithoutCacheWrite,
  cache_creation_input_tokens: 12,
};

describe('SemanticMediaPurgeSession: does not create a transaction or alter request history on the default off path', () => {
  it('does not create a transaction or alter request history on the default off path', async () => {
    const history = historyWithImage();
    let persistenceCount = 0;
    const session = new SemanticMediaPurgeSession({
      history,
      mode: () => 'off',
      requiresExplicitCacheWrite: () => false,
      persist: () => {
        persistenceCount += 1;
        return Promise.resolve();
      },
    });

    const attempt = await session.begin();

    expect(attempt).toBeUndefined();
    await withRows(history.streamRawHistory(), (rows) => {
      expect(rows[0]?.blocks).toHaveLength(2);
      expect(persistenceCount).toBe(0);
    });
  });
});

describe('SemanticMediaPurgeSession: keeps the selected image in an explicit-cache request while preparing the purge candidate', () => {
  it('keeps the selected image in an explicit-cache request while preparing the purge candidate', async () => {
    const history = historyWithImage();
    const session = new SemanticMediaPurgeSession({
      history,
      mode: () => 'remove',
      requiresExplicitCacheWrite: () => true,
      persist: () => Promise.resolve(),
    });

    const attempt = await session.begin();
    assertDefined(attempt, 'Expected purge attempt');
    const request = await collect(attempt.requestHistory);
    const candidate = await collect(attempt.candidateHistory);
    expect(request[0]?.blocks).toHaveLength(2);
    expect(request[0]?.blocks[1]?.type).toBe('media');
    await withRows(history.streamRawHistory(), (rows) => {
      expect(request).not.toBe(rows);
      expect(request[0]).not.toBe(rows[0]);
      expect(request[0]?.blocks[0]).not.toBe(rows[0]?.blocks[0]);
      expect(candidate[0]?.blocks).toStrictEqual([
        { type: 'text', text: 'inspect' },
      ]);
      attempt.finalize();
    });
  });
});

describe('SemanticMediaPurgeSession: does not start an explicit-cache purge when the oldest image has no stable prefix', () => {
  it('does not start an explicit-cache purge when the oldest image has no stable prefix', async () => {
    const history = new HistoryService();
    history.add({
      speaker: 'human',
      blocks: [
        {
          type: 'media',
          mimeType: 'image/png',
          encoding: 'base64',
          data: 'aW1hZ2U=',
        },
        { type: 'text', text: 'suffix' },
      ],
    });
    const session = new SemanticMediaPurgeSession({
      history,
      mode: () => 'remove',
      requiresExplicitCacheWrite: () => true,
      persist: () => Promise.resolve(),
    });

    const attempt = await session.begin();

    expect(attempt).toBeUndefined();
    await withRows(history.streamRawHistory(), (rows) => {
      expect(rows[0]?.blocks).toHaveLength(2);
    });
  });
});

describe('SemanticMediaPurgeSession: uses the purge candidate directly when explicit cache-write proof is not required', () => {
  it('uses the purge candidate directly when explicit cache-write proof is not required', async () => {
    const history = historyWithImage();
    const session = new SemanticMediaPurgeSession({
      history,
      mode: () => 'summary',
      requiresExplicitCacheWrite: () => false,
      persist: () => Promise.resolve(),
    });

    const attempt = await session.begin();
    assertDefined(attempt, 'Expected purge attempt');
    expect(attempt.requestHistory).toBe(attempt.candidateHistory);
    expect((await collect(attempt.requestHistory))[0]?.blocks).toStrictEqual([
      { type: 'text', text: 'inspect' },
      { type: 'text', text: 'A green build result.' },
    ]);
    attempt.finalize();
  });
});

describe('SemanticMediaPurgeSession: exposes the exact candidate and commits it only after observed provider success', () => {
  it('exposes the exact candidate and commits it only after observed provider success', async () => {
    const history = historyWithImage();
    let persisted: SemanticPurgeRowSource | undefined;
    const session = new SemanticMediaPurgeSession({
      history,
      mode: () => 'remove',
      requiresExplicitCacheWrite: () => false,
      persist: (candidate) => {
        persisted = candidate;
        return Promise.resolve();
      },
    });
    const attempt = await session.begin();
    assertDefined(attempt, 'Expected purge attempt');
    const committed = await attempt.complete({
      status: 'success',
      usage: usageWithoutCacheWrite,
      retryHandoff: false,
    });

    expect(committed).toBe(true);
    expect(persisted).toBe(attempt.candidateHistory);
    await withRows(history.streamRawHistory(), (rows) => {
      expect(rows[0]?.blocks).toStrictEqual([
        { type: 'text', text: 'inspect' },
      ]);
      attempt.finalize();
    });
  });
});

describe('SemanticMediaPurgeSession: rejects absent, mismatched, aggregate-only, retry, error, and cancellation evidence', () => {
  it('rejects absent, mismatched, aggregate-only, retry, error, and cancellation evidence', async () => {
    const outcomes = [
      (boundaryId: object) => ({
        status: 'success' as const,
        usage: usageWithoutCacheWrite,
        cacheWriteEvidence: { boundaryId, preparation: 'added' as const },
        retryHandoff: false,
      }),
      (_boundaryId: object) => ({
        status: 'success' as const,
        usage: usageWithCacheWrite,
        retryHandoff: false,
      }),
      (_boundaryId: object) => ({
        status: 'success' as const,
        usage: usageWithCacheWrite,
        cacheWriteEvidence: {
          boundaryId: Object.freeze({}),
          preparation: 'added' as const,
        },
        retryHandoff: false,
      }),
      (boundaryId: object) => ({
        status: 'success' as const,
        usage: { ...usageWithoutCacheWrite, cacheCreationTokens: 12 },
        cacheWriteEvidence: { boundaryId, preparation: 'added' as const },
        retryHandoff: false,
      }),
      (boundaryId: object) => ({
        status: 'success' as const,
        usage: usageWithCacheWrite,
        cacheWriteEvidence: { boundaryId, preparation: 'reused' as const },
        retryHandoff: true,
      }),
      (boundaryId: object) => ({
        status: 'error' as const,
        usage: usageWithCacheWrite,
        cacheWriteEvidence: { boundaryId, preparation: 'added' as const },
        retryHandoff: false,
      }),
      (boundaryId: object) => ({
        status: 'cancelled' as const,
        usage: usageWithCacheWrite,
        cacheWriteEvidence: { boundaryId, preparation: 'added' as const },
        retryHandoff: false,
      }),
    ];

    for (const buildOutcome of outcomes) {
      const history = historyWithImage();
      const session = new SemanticMediaPurgeSession({
        history,
        mode: () => 'remove',
        requiresExplicitCacheWrite: () => true,
        persist: () => Promise.resolve(),
      });
      const attempt = await session.begin();
      if (attempt?.preparedBoundary === undefined) {
        throw new Error('Expected prepared purge boundary');
      }

      const committed = await attempt.complete(
        buildOutcome(attempt.preparedBoundary.boundaryId),
      );

      expect(committed).toBe(false);
      await withRows(history.streamRawHistory(), (rows) => {
        expect(rows[0]?.blocks).toHaveLength(2);
      });
    }
  });
});

describe('SemanticMediaPurgeSession: commits exact-match cache evidence for remove mode', () => {
  it('commits exact-match cache evidence for remove mode', async () => {
    const history = historyWithImage();
    const session = new SemanticMediaPurgeSession({
      history,
      mode: () => 'remove',
      requiresExplicitCacheWrite: () => true,
      persist: () => Promise.resolve(),
    });
    const attempt = await session.begin();
    if (attempt?.preparedBoundary === undefined) {
      throw new Error('Expected prepared purge boundary');
    }

    const committed = await attempt.complete({
      status: 'success',
      usage: usageWithCacheWrite,
      cacheWriteEvidence: {
        boundaryId: attempt.preparedBoundary.boundaryId,
        preparation: 'added',
      },
      retryHandoff: false,
    });

    expect(committed).toBe(true);
    await withRows(history.streamRawHistory(), (rows) => {
      expect(rows[0]?.blocks).toStrictEqual([
        { type: 'text', text: 'inspect' },
      ]);
      attempt.finalize();
    });
  });
});

describe('SemanticMediaPurgeSession: rejects reused cache evidence because aggregate write tokens cannot prove the intended breakpoint was written', () => {
  it('rejects reused cache evidence because aggregate write tokens cannot prove the intended breakpoint was written', async () => {
    const history = historyWithImage();
    const session = new SemanticMediaPurgeSession({
      history,
      mode: () => 'summary',
      requiresExplicitCacheWrite: () => true,
      persist: () => Promise.resolve(),
    });
    const attempt = await session.begin();
    if (attempt?.preparedBoundary === undefined) {
      throw new Error('Expected prepared purge boundary');
    }

    const committed = await attempt.complete({
      status: 'success',
      usage: usageWithCacheWrite,
      cacheWriteEvidence: {
        boundaryId: attempt.preparedBoundary.boundaryId,
        preparation: 'reused',
      },
      retryHandoff: false,
    });

    expect(committed).toBe(false);
    await withRows(history.streamRawHistory(), (rows) => {
      expect(rows[0]?.blocks).toHaveLength(2);
    });
  });
});

describe('SemanticMediaPurgeSession: holds the next purge until a committed attempt is finalized', () => {
  it('holds the next purge until a committed attempt is finalized', async () => {
    const history = historyWithImage();
    const session = new SemanticMediaPurgeSession({
      history,
      mode: () => 'remove',
      persist: () => Promise.resolve(),
    });
    const first = await session.begin(false);
    assertDefined(first, 'Expected first purge attempt');
    expect(
      await first.complete({
        status: 'success',
        usage: usageWithoutCacheWrite,
        retryHandoff: false,
      }),
    ).toBe(true);

    let secondResolved = false;
    const secondPromise = session.begin(false).then((attempt) => {
      secondResolved = true;
      return attempt;
    });
    await Promise.resolve();
    expect(secondResolved).toBe(false);

    first.finalize();

    expect(await secondPromise).toBeUndefined();
  });
});

describe('SemanticMediaPurgeSession: releases the next purge after a noncommitted outcome', () => {
  it('releases the next purge after a noncommitted outcome', async () => {
    const history = historyWithImage();
    const session = new SemanticMediaPurgeSession({
      history,
      mode: () => 'remove',
      persist: () => Promise.resolve(),
    });
    const first = await session.begin(false);
    assertDefined(first, 'Expected first purge attempt');
    let secondResolved = false;
    const secondPromise = session.begin(false).then((attempt) => {
      secondResolved = true;
      return attempt;
    });
    await Promise.resolve();
    expect(secondResolved).toBe(false);

    expect(
      await first.complete({
        status: 'cancelled',
        usage: undefined,
        retryHandoff: false,
      }),
    ).toBe(false);

    const second = await secondPromise;
    expect(secondResolved).toBe(true);
    assertDefined(second, 'Expected second purge attempt');
    expect(
      await second.complete({
        status: 'error',
        usage: undefined,
        retryHandoff: false,
      }),
    ).toBe(false);
  });
});

describe('SemanticMediaPurgeSession: releases the next purge only after committed rollback succeeds', () => {
  it('releases the next purge only after committed rollback succeeds', async () => {
    const history = historyWithImage();
    const session = new SemanticMediaPurgeSession({
      history,
      mode: () => 'remove',
      persist: () => Promise.resolve(),
    });
    const first = await session.begin(false);
    assertDefined(first, 'Expected first purge attempt');
    expect(
      await first.complete({
        status: 'success',
        usage: usageWithoutCacheWrite,
        retryHandoff: false,
      }),
    ).toBe(true);

    let secondResolved = false;
    const secondPromise = session.begin(false).then((attempt) => {
      secondResolved = true;
      return attempt;
    });
    await Promise.resolve();
    expect(secondResolved).toBe(false);

    await first.rollbackCommitted();

    const second = await secondPromise;
    expect(secondResolved).toBe(true);
    assertDefined(second, 'Expected second purge attempt');
    expect(
      await second.complete({
        status: 'error',
        usage: undefined,
        retryHandoff: false,
      }),
    ).toBe(false);
  });
});

describe('SemanticMediaPurgeSession: keeps the purge lease when committed rollback fails', () => {
  it('keeps the purge lease when committed rollback fails', async () => {
    const history = historyWithImage();
    let persistenceAttempt = 0;
    const session = new SemanticMediaPurgeSession({
      history,
      mode: () => 'remove',
      persist: () => {
        persistenceAttempt += 1;
        return persistenceAttempt === 1
          ? Promise.resolve()
          : Promise.reject(new Error('rollback persistence failed'));
      },
    });
    const first = await session.begin(false);
    assertDefined(first, 'Expected first purge attempt');
    expect(
      await first.complete({
        status: 'success',
        usage: usageWithoutCacheWrite,
        retryHandoff: false,
      }),
    ).toBe(true);

    let secondResolved = false;
    const secondPromise = session.begin(false).then((attempt) => {
      secondResolved = true;
      return attempt;
    });
    await Promise.resolve();
    expect(secondResolved).toBe(false);

    await expect(first.rollbackCommitted()).rejects.toThrow(
      'rollback persistence failed',
    );
    await Promise.resolve();

    expect(secondResolved).toBeFalsy();
    first.finalize();
    (await secondPromise)?.finalize();
  });
});
