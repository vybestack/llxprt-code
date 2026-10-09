/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { applyCompressionWithAnchor } from '../cacheAnchor.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  CursorCompressionHistory,
  compressionRow,
  summaryRow,
} from './raw-compression-fixtures.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HistoryDumpSnapshot } from '@vybestack/llxprt-code-core/services/history/historyDumpSnapshot.js';
import { expectedRange } from '../../../../core/src/services/history/chronology-rollback-test-helpers.js';

class AbortCompressionHistory extends CursorCompressionHistory {
  readonly controller = new AbortController();
  readonly failure = new Error('compression cancelled');

  override async openDumpSnapshot(): Promise<HistoryDumpSnapshot> {
    const snapshot = await super.openDumpSnapshot();
    return { ...snapshot, rows: () => this.readRows(snapshot) };
  }

  private async *readRows(
    snapshot: HistoryDumpSnapshot,
  ): AsyncGenerator<IContent, void, unknown> {
    for await (const row of snapshot.rows()) {
      yield row;
      this.controller.abort(this.failure);
    }
  }
}

class FaultCompressionHistory extends CursorCompressionHistory {
  readonly failure = new Error('compression source failed');
  private failNextRead = true;

  override async openDumpSnapshot(): Promise<HistoryDumpSnapshot> {
    const snapshot = await super.openDumpSnapshot();
    return { ...snapshot, rows: () => this.readRows(snapshot) };
  }

  private async *readRows(
    snapshot: HistoryDumpSnapshot,
  ): AsyncGenerator<IContent, void, unknown> {
    for await (const row of snapshot.rows()) {
      yield row;
      if (this.failNextRead) {
        this.failNextRead = false;
        throw this.failure;
      }
    }
  }
}

function* originalRows(): Generator<IContent, void, unknown> {
  for (let index = 0; index < 512; index++) yield compressionRow(index);
}

function expectedFingerprint(size: number): string {
  const digest = createHash('sha256');
  for (let index = 0; index < size; index += 1)
    digest.update(JSON.stringify(compressionRow(index)));
  return digest.digest('hex');
}

async function fingerprint(history: CursorCompressionHistory): Promise<string> {
  const digest = createHash('sha256');
  for await (const row of HistoryStream(history))
    digest.update(JSON.stringify(row));
  return digest.digest('hex');
}

async function* HistoryStream(
  history: CursorCompressionHistory,
): AsyncGenerator<IContent, void, unknown> {
  yield* CursorCompressionHistory.prototype.streamRawHistory.call(history);
}

async function expectRetry(history: CursorCompressionHistory): Promise<void> {
  await applyCompressionWithAnchor(history, [summaryRow()], 0, 'test');
  await history.waitForCommit();
  const snapshot = await history.openDumpSnapshot();
  try {
    let count = 0;
    for await (const row of snapshot.rows()) {
      expect(row.blocks).toStrictEqual(summaryRow().blocks);
      expect(row.metadata?.chronologyReplaced).toStrictEqual({
        fromSeq: 1,
        toSeq: 512,
        itemCount: 512,
      });
      expect(row.metadata?.semanticMediaPurgeFrontier).toStrictEqual({
        contentIndex: 3,
        blockIndex: 1,
        contentId: 'purged-frontier',
      });
      count++;
    }
    expect(count).toBe(1);
  } finally {
    await snapshot.close();
  }
  expect(history.getCacheAnchorSeq()).toBe(0);
  expect(history.openedSnapshots).toBe(history.closedSnapshots);
  expect(history.consumerOwnership.snapshot().liveRows).toBe(0);
}

describe('compression raw cursor failure before publication', () => {
  it('aborts without replacing history or changing its anchor', async () => {
    let observed: AbortCompressionHistory | undefined;
    await withSuffixFixture(
      512,
      async (history, ownership) => {
        if (!(history instanceof AbortCompressionHistory))
          throw new Error('Expected abort fixture');
        history.setCacheAnchorSeq(1);
        const expected = expectedFingerprint(512);
        await history.recalculateTotalTokens();
        const tokens = await history.estimateTokensForContents(originalRows());
        const operation = applyCompressionWithAnchor(
          history,
          [summaryRow()],
          0,
          'test',
          history.controller.signal,
        );
        await expect(operation).rejects.toThrow('compression cancelled');
        await expect(operation).rejects.toBe(history.failure);
        await history.waitForCommit();
        expect(await fingerprint(history)).toBe(expected);
        expect(history.getCacheAnchorSeq()).toBe(1);
        expect(history.getTotalTokens()).toBe(tokens);
        expect(history.getContextRange()).toStrictEqual(expectedRange(512));
        expect(history.openedSnapshots).toBe(history.closedSnapshots);
        expect(ownership.snapshot().liveRows).toBe(0);
        await expectRetry(history);
      },
      2048,
      compressionRow,
      undefined,
      (options) => {
        observed = new AbortCompressionHistory(options);
        return observed;
      },
    );
    expect(observed?.consumerOwnership.snapshot().liveRows).toBe(0);
  });

  it('propagates a source fault before any replacement', async () => {
    let observed: FaultCompressionHistory | undefined;
    await withSuffixFixture(
      512,
      async (history, ownership) => {
        if (!(history instanceof FaultCompressionHistory))
          throw new Error('Expected fault fixture');
        const expected = expectedFingerprint(512);
        history.setCacheAnchorSeq(1);
        await history.recalculateTotalTokens();
        const tokens = await history.estimateTokensForContents(originalRows());
        const operation = applyCompressionWithAnchor(
          history,
          [summaryRow()],
          0,
          'test',
        );
        await expect(operation).rejects.toThrow('compression source failed');
        await expect(operation).rejects.toBe(history.failure);
        await history.waitForCommit();
        expect(await fingerprint(history)).toBe(expected);
        expect(history.getCacheAnchorSeq()).toBe(1);
        expect(history.getTotalTokens()).toBe(tokens);
        expect(history.getContextRange()).toStrictEqual(expectedRange(512));
        expect(history.openedSnapshots).toBe(history.closedSnapshots);
        expect(ownership.snapshot().liveRows).toBe(0);
        await expectRetry(history);
      },
      2048,
      compressionRow,
      undefined,
      (options) => {
        observed = new FaultCompressionHistory(options);
        return observed;
      },
    );
    expect(observed?.consumerOwnership.snapshot().liveRows).toBe(0);
  });
});
