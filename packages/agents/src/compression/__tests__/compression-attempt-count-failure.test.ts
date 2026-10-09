/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import {
  withSuffixFixture,
  suffixRow,
} from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  AttemptHistory,
  attemptHandler,
} from './compression-attempt-stream-helpers.js';

class FailedCountHistory extends AttemptHistory {
  private failed = false;

  override async *getComprehensive(): AsyncGenerator<IContent, void, unknown> {
    for await (const row of super.getComprehensive()) {
      yield row;
      if (!this.failed) {
        this.failed = true;
        throw new Error('Count source failed');
      }
    }
  }
}

describe('compression scalar-count source failure', () => {
  it('releases the reader and compression lock before admitting another attempt', async () => {
    await withSuffixFixture(
      0,
      async (service, ownership) => {
        service.addAll(
          Array.from({ length: 512 }, (_, index) => suffixRow(index)),
        );
        await service.waitForTokenUpdates();
        let locked = false;
        service.on('compressionStarted', () => {
          locked = true;
        });
        service.on('compressionLockReleased', () => {
          locked = false;
        });
        const handler = attemptHandler(service, async () => {});
        await expect(handler.performCompression('fault')).rejects.toThrow(
          'Count source failed',
        );
        const afterFailure = {
          locked,
          liveRows: ownership.snapshot().liveRows,
        };
        expect(afterFailure).toStrictEqual({ locked: false, liveRows: 0 });
        expect(await service.countCuratedRows()).toBe(512);
        expect(await handler.performCompression('retry')).toBe(
          PerformCompressionResult.NOOP,
        );
        expect(locked).toBe(false);
        expect(ownership.snapshot().liveRows).toBe(0);
      },
      0,
      suffixRow,
      undefined,
      (options) => new FailedCountHistory(options),
    );
  }, 120_000);
});
