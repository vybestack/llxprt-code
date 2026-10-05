/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { withSuffixFixture } from './history-suffix-test-helpers.js';
import {
  accountingFactory,
  accountingRow,
  accountingTexts,
  deferred,
  recalculate,
} from './token-accounting-stream-test-helpers.js';

function expectedAccounting(size: number): { digest: string; total: number } {
  const expected = createHash('sha256');
  let total = 0;
  for (let index = 0; index < size; index++) {
    for (const text of accountingTexts(index)) {
      expected.update(`active:${text}\n`);
      total += text.length;
    }
  }
  return { digest: expected.digest('hex'), total };
}

for (const size of [512, 8192]) {
  for (const method of ['total', 'legacy'] satisfies Array<
    'total' | 'legacy'
  >) {
    describe(`${method} token recalculation over ${size} mixed journal rows`, () => {
      it('counts all blocks in order without borrowing a full history', async () => {
        await withSuffixFixture(
          size,
          async (service, ownership, counters) => {
            const actual = createHash('sha256');
            service.setTokenizerFactory(
              accountingFactory((text, model) => {
                actual.update(`${model}:${text}\n`);
                return text.length;
              }),
            );
            const expected = expectedAccounting(size);
            service.setBaseTokenOffset(17);
            await recalculate(service, method);
            expect(service.getTotalTokens()).toBe(expected.total + 17);
            expect(actual.digest('hex')).toBe(expected.digest);
            expect(counters.snapshot().rowsDecoded).toBe(size);
            expect(counters.snapshot().peakDecodedRows).toBe(1);
            expect(ownership.snapshot().peakRows).toBeLessThanOrEqual(440);
            expect(
              ownership.snapshot().peakSerializedBytes,
            ).toBeLessThanOrEqual(8 * 1024 * 1024);
            expect(ownership.snapshot().liveRows).toBe(0);
          },
          2048,
          accountingRow,
        );
      }, 120_000);
    });
  }
}

for (const method of ['total', 'legacy'] satisfies Array<'total' | 'legacy'>) {
  describe(`${method} recalculation lifecycle`, () => {
    it('holds one row while the tokenizer is suspended and releases it after failure', async () => {
      await withSuffixFixture(
        512,
        async (service, ownership, counters) => {
          const entered = deferred();
          const release = deferred();
          service.setTokenizerFactory(
            accountingFactory(async () => {
              entered.resolve();
              await release.promise;
              throw new Error('tokenizer failed');
            }),
          );
          service.setBaseTokenOffset(23);
          const operation = recalculate(service, method);
          await entered.promise;
          try {
            expect(ownership.snapshot().liveRows).toBe(1);
            expect(counters.snapshot().rowsDecoded).toBe(1);
          } finally {
            release.resolve();
            await expect(operation).rejects.toThrow('tokenizer failed');
          }
          expect(ownership.snapshot().liveRows).toBe(0);
          expect(service.getTotalTokens()).toBe(23);
          service.setTokenizerFactory(accountingFactory((text) => text.length));
          await recalculate(service, method);
          expect(service.getTotalTokens()).toBeGreaterThan(23);
        },
        2048,
        accountingRow,
      );
    });

    it('does not publish a partial total when aborted inside tokenization', async () => {
      await withSuffixFixture(
        512,
        async (service, ownership, counters) => {
          const controller = new AbortController();
          let invocations = 0;
          service.setTokenizerFactory(
            accountingFactory(() => {
              invocations += 1;
              controller.abort(new Error('accounting cancelled'));
              return 7;
            }),
          );
          service.setBaseTokenOffset(29);
          await expect(
            recalculate(service, method, controller.signal),
          ).rejects.toThrow('accounting cancelled');
          expect(service.getTotalTokens()).toBe(29);
          expect(invocations).toBe(1);
          expect(counters.snapshot().rowsDecoded).toBe(1);
          expect(ownership.snapshot().liveRows).toBe(0);
        },
        2048,
        accountingRow,
      );
    });

    it('rejects a pre-aborted request without reading any journal row', async () => {
      await withSuffixFixture(
        2,
        async (service, ownership, counters) => {
          const controller = new AbortController();
          controller.abort(new Error('before accounting'));
          service.setTokenizerFactory(accountingFactory(() => 1));
          await expect(
            recalculate(service, method, controller.signal),
          ).rejects.toThrow('before accounting');
          expect(counters.snapshot().rowsDecoded).toBe(0);
          expect(ownership.snapshot().acquisitions).toBe(0);
        },
        2048,
        accountingRow,
      );
    });
  });
}

describe('streamed hypothetical token estimates', () => {
  it('uses historical model attribution when no override is supplied and closes on consumer failure', async () => {
    await withSuffixFixture(
      512,
      async (service, ownership, counters) => {
        const seen = createHash('sha256');
        let invocations = 0;
        service.setTokenizerFactory(
          accountingFactory((text, model) => {
            seen.update(`${model}:${text}\n`);
            invocations += 1;
            if (invocations === 5) throw new Error('hypothetical failed');
            return text.length;
          }),
        );
        await expect(
          service.estimateTokensForContents(service.streamRawHistory()),
        ).rejects.toThrow('hypothetical failed');
        const expected = createHash('sha256');
        for (const text of accountingTexts(0))
          expected.update(`historical-a:${text}\n`);
        expected.update(`historical-b:${accountingTexts(1)[0]}\n`);
        expect(seen.digest('hex')).toBe(expected.digest('hex'));
        expect(counters.snapshot().rowsDecoded).toBe(2);
        expect(ownership.snapshot().liveRows).toBe(0);
        expect(service.getTotalTokens()).toBe(0);
      },
      2048,
      accountingRow,
    );
  });
});

describe('streamed hypothetical token estimate membership', () => {
  it('preserves pinned membership when the live conversation is cleared during an estimate', async () => {
    await withSuffixFixture(
      512,
      async (service, ownership, counters) => {
        const entered = deferred();
        const release = deferred();
        let first = true;
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
        const operation = service.estimateTokensForContents(
          service.streamRawHistory(),
          'active',
        );
        await entered.promise;
        service.clear();
        release.resolve();
        const expected = Array.from({ length: 512 }, (_, index) =>
          accountingTexts(index).reduce((sum, text) => sum + text.length, 0),
        ).reduce((sum, count) => sum + count, 0);
        expect(await operation).toBe(expected);
        expect(counters.snapshot().rowsDecoded).toBe(512);
        expect(ownership.snapshot().liveRows).toBe(0);
        expect(service.isEmpty()).toBe(true);
      },
      2048,
      accountingRow,
    );
  });

  it('accepts a single valid row larger than the controlled fixture payload allowance', async () => {
    const payloadBytes = 8 * 1024 * 1024 + 4096;
    await withSuffixFixture(
      1,
      async (service, ownership) => {
        service.setTokenizerFactory(accountingFactory((text) => text.length));
        const expected = accountingTexts(0, payloadBytes).reduce(
          (sum, text) => sum + text.length,
          0,
        );
        expect(
          await service.estimateTokensForContents(service.streamRawHistory()),
        ).toBe(expected);
        expect(ownership.snapshot().peakSerializedBytes).toBeGreaterThan(
          8 * 1024 * 1024,
        );
        expect(ownership.snapshot().liveRows).toBe(0);
      },
      payloadBytes,
      accountingRow,
    );
  }, 120_000);
});
