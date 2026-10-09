/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  accountingFactory,
  accountingRow,
  accountingTexts,
} from './token-accounting-stream-test-helpers.js';
import type { IContent } from './IContent.js';

describe('hypothetical token estimate iterator lifecycle', () => {
  it('closes the producer on cancellation without asking for its next row', async () => {
    await withSuffixFixture(0, async (service) => {
      const controller = new AbortController();
      let produced = 0;
      let closed = false;
      async function* rows(): AsyncGenerator<IContent, void, unknown> {
        try {
          for (let index = 0; index < 512; index++) {
            produced += 1;
            yield accountingRow(index);
          }
        } finally {
          closed = true;
        }
      }
      service.setTokenizerFactory(
        accountingFactory(() => {
          controller.abort(new Error('estimate cancelled'));
          return 1;
        }),
      );
      await expect(
        service.estimateTokensForContents(rows(), 'active', controller.signal),
      ).rejects.toThrow('estimate cancelled');
      expect({ produced, closed }).toStrictEqual({ produced: 1, closed: true });
      expect(service.getTotalTokens()).toBe(0);
    });
  });

  it('does not enter a producer when cancellation precedes estimation', async () => {
    await withSuffixFixture(0, async (service) => {
      const controller = new AbortController();
      controller.abort(new Error('pre-aborted estimate'));
      let produced = 0;
      async function* rows(): AsyncGenerator<IContent, void, unknown> {
        produced += 1;
        yield accountingRow(0);
      }
      service.setTokenizerFactory(accountingFactory((text) => text.length));
      await expect(
        service.estimateTokensForContents(rows(), undefined, controller.signal),
      ).rejects.toThrow('pre-aborted estimate');
      expect(produced).toBe(0);
    });
  });
});

describe('hypothetical token estimate input lifetime', () => {
  it('preserves a producer fault and releases every journal row already consumed', async () => {
    await withSuffixFixture(
      512,
      async (service, ownership, counters) => {
        async function* failingRows(): AsyncGenerator<IContent, void, unknown> {
          for await (const row of service.streamRawHistory()) {
            yield row;
            throw new Error('row source failed');
          }
        }
        service.setTokenizerFactory(accountingFactory((text) => text.length));
        await expect(
          service.estimateTokensForContents(failingRows()),
        ).rejects.toThrow('row source failed');
        expect(counters.snapshot().rowsDecoded).toBe(1);
        expect(ownership.snapshot().liveRows).toBe(0);
        expect(service.getTotalTokens()).toBe(0);
      },
      2048,
      accountingRow,
    );
  });

  it('supports readonly synchronous inputs and empty async inputs without changing live totals', async () => {
    await withSuffixFixture(0, async (service) => {
      service.setTokenizerFactory(accountingFactory((text) => text.length));
      const input = Object.freeze([accountingRow(0), accountingRow(1)]);
      let expected = 0;
      for (const index of [0, 1]) {
        for (const text of accountingTexts(index)) expected += text.length;
      }
      expect(await service.estimateTokensForContents(input)).toBe(expected);
      expect(
        await service.estimateTokensForContents(service.streamRawHistory()),
      ).toBe(0);
      expect(service.getTotalTokens()).toBe(0);
    });
  });
});
