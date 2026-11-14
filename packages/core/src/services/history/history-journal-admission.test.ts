/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { collectRawHistory } from '@vybestack/llxprt-code-test-utils/core/collect-raw-history.js';
import { withNativeDetachedFixture } from './__tests__/support/detached-contract-fixture.js';
import type { IContent } from './IContent.js';

function row(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }], metadata: {} };
}

describe('journal mutation failure preserves the last committed history', () => {
  for (const seeded of [false, true]) {
    it(`batch append publishes nothing when the trailer write fails (${seeded ? 'with' : 'without'} prior rows)`, async () => {
      await withNativeDetachedFixture(async (fixture) => {
        const { history } = fixture;
        if (seeded) await history.addBatch([row('seed')]);
        await history.waitForCommit();
        const before = await collectRawHistory(history);
        const failure = new Error('injected trailer write failure');
        fixture.io.rejectNextWrite(failure, 'trailer');
        await expect(
          history.addBatch([row('rejected'), row('also rejected')]),
        ).rejects.toThrow(failure);
        expect(await collectRawHistory(history)).toStrictEqual(before);
        expect(history.length()).toBe(before.length);
        expect(await Array.fromAsync(fixture.primaryRows())).toStrictEqual(
          before,
        );
        await expect(history.addBatch([row('after failure')])).rejects.toThrow(
          'accepts no more writes',
        );
        expect(await collectRawHistory(history)).toStrictEqual(before);
      });
    });
  }
});
