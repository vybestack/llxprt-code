/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HistoryDumpSnapshot } from '@vybestack/llxprt-code-core/services/history/historyDumpSnapshot.js';
import { withSuffixFixture } from '../../../../core/src/services/history/history-suffix-test-helpers.js';
import {
  TruncationStreamHistory,
  truncationHandler,
  truncationRow,
} from './truncation-stream-helpers.js';

class RetainingHistory extends TruncationStreamHistory {
  readonly retained: IContent[] = [];
  readonly copied: IContent[] = [];
  readonly originalOwners = new RowOwnership();
  readonly copyOwners = new RowOwnership();

  override async openDumpSnapshot(): Promise<HistoryDumpSnapshot> {
    const snapshot = await super.openDumpSnapshot();
    const originalOwners = this.originalOwners;
    const copyOwners = this.copyOwners;
    const retained = this.retained;
    const copied = this.copied;
    let retainedOnce = false;
    return {
      ...snapshot,
      async *rows() {
        const retain = !retainedOnce;
        retainedOnce = true;
        for await (const row of snapshot.rows()) {
          if (retain) {
            const copy = { ...row, blocks: [...row.blocks] };
            originalOwners.retain(row);
            copyOwners.retain(copy);
            retained.push(row);
            copied.push(copy);
          }
          yield row;
        }
      },
    };
  }

  releaseControls(): void {
    for (const row of this.retained) this.originalOwners.release(row);
    for (const row of this.copied) this.copyOwners.release(row);
    this.retained.length = 0;
    this.copied.length = 0;
  }
}

async function retainingControl(size: number): Promise<number> {
  let created: RetainingHistory | undefined;
  return withSuffixFixture(
    size,
    async (history) => {
      const handler = truncationHandler(history);
      history.syncTotalTokens(size);
      await history.waitForTokenUpdates();
      await handler.performCompression('retaining-control');
      if (created === undefined) throw new Error('Missing retaining control');
      for (const owner of [created.originalOwners, created.copyOwners]) {
        expect(owner.snapshot().liveRows).toBe(size);
        expect(
          owner.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
        ).toBe(false);
        expect(owner.snapshot().peakSerializedBytes).toBeGreaterThan(
          size === 8192 ? 8 * 1024 * 1024 : 0,
        );
      }
      const peak =
        created.originalOwners.snapshot().peakRows +
        created.copyOwners.snapshot().peakRows;
      created.releaseControls();
      expect(
        created.originalOwners.snapshot().liveRows +
          created.copyOwners.snapshot().liveRows,
      ).toBe(0);
      return peak;
    },
    2048,
    truncationRow,
    undefined,
    (options) => {
      created = new RetainingHistory(options);
      return created;
    },
  );
}

describe('strategy cursor deliberately retaining owner controls', () => {
  it.each([512, 8192])(
    'rejects retained and copied %i-row controls with unchanged bounds',
    async (size) => {
      expect(await retainingControl(size)).toBe(size * 2);
    },
    120_000,
  );
});
