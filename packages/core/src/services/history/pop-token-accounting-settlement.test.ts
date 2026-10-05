/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withSuffixFixture } from './history-suffix-test-helpers.js';
import {
  accountingFactory,
  accountingRow,
  accountingTexts,
  deferred,
} from './token-accounting-stream-test-helpers.js';

describe('pop token accounting settlement', () => {
  it('returns the removed row only after the streamed token recalculation releases its ownership', async () => {
    await withSuffixFixture(
      3,
      async (service, ownership) => {
        service.add(accountingRow(3));
        await service.waitForTokenUpdates();
        await service.waitForCommit();
        const entered = deferred();
        const release = deferred();
        let first = true;
        let finished = false;
        service.setTokenizerFactory(
          accountingFactory(async (text) => {
            if (first) {
              first = false;
              entered.resolve();
              await release.promise;
            }
            return text.length;
          }),
        );
        const operation = service.pop().then((removed) => {
          finished = true;
          return removed;
        });
        await entered.promise;
        try {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          expect(finished).toBe(false);
          expect(ownership.snapshot().liveRows).toBe(1);
        } finally {
          release.resolve();
          await operation;
          await service.waitForTokenUpdates();
        }
        expect(await operation).toStrictEqual(accountingRow(3));
        let expected = 0;
        for (const index of [0, 1, 2]) {
          for (const text of accountingTexts(index)) expected += text.length;
        }
        expect(service.getTotalTokens()).toBe(expected);
        expect(ownership.snapshot().liveRows).toBe(0);
      },
      2048,
      accountingRow,
    );
  });

  it('reports tokenizer failure from pop without leaving a borrowed token row', async () => {
    await withSuffixFixture(
      2,
      async (service, ownership) => {
        service.setTokenizerFactory(accountingFactory((text) => text.length));
        service.add(accountingRow(2));
        await service.waitForTokenUpdates();
        await service.waitForCommit();
        service.setTokenizerFactory(
          accountingFactory(() => {
            throw new Error('pop accounting failed');
          }),
        );
        const expected = accountingTexts(2).reduce(
          (sum, text) => sum + text.length,
          0,
        );
        await expect(service.pop()).rejects.toThrow('pop accounting failed');
        expect(service.getTotalTokens()).toBe(expected);
        expect(ownership.snapshot().liveRows).toBe(0);
        expect(service.length()).toBe(2);
      },
      2048,
      accountingRow,
    );
  });
});
