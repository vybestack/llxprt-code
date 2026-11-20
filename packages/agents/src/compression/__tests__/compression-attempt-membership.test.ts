/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import {
  withSuffixFixture,
  suffixRow,
} from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  AttemptHistory,
  attemptHandler,
} from './compression-attempt-stream-helpers.js';

class InterleavedHistory extends AttemptHistory {
  readonly timeline: string[] = [];

  private appended = false;

  override get compressionRowCount(): number | undefined {
    const count = super.compressionRowCount;
    if (!this.appended) {
      this.timeline.push('append');
      this.add(suffixRow(512));
      this.appended = true;
    }
    return count;
  }
}

describe('compression attempt membership at lock acquisition', () => {
  it('queues writes during scalar counting rather than compressing an uncounted append', async () => {
    let observed: InterleavedHistory | undefined;
    await withSuffixFixture(
      0,
      async (service, ownership) => {
        service.addAll(
          Array.from({ length: 512 }, (_, index) => suffixRow(index)),
        );
        await service.waitForTokenUpdates();
        const handler = attemptHandler(service, async () => {});
        service.on('compressionStarted', () =>
          observed?.timeline.push('locked'),
        );
        expect(await handler.performCompression('counting')).toBe(
          PerformCompressionResult.NOOP,
        );
        expect(observed?.timeline).toStrictEqual(['locked', 'append']);
        expect(await service.countCuratedRows()).toBe(513);
        expect(ownership.snapshot().liveRows).toBe(0);
      },
      0,
      suffixRow,
      undefined,
      (options) => {
        const service = new InterleavedHistory(options);
        observed = service;
        return service;
      },
    );
  }, 120_000);
});
