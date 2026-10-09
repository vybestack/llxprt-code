import { curatedHistoryForTest } from '@vybestack/llxprt-code-test-utils/core/curated-history-fixture.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { HistoryService } from './HistoryService.js';
import { buildProviderContent } from './historyProviderPipeline.js';
import { DebugLogger } from '../../debug/index.js';
import { scratchDirectories } from './history-clone-trace-test-helpers.js';
import {
  suffixRow,
  withSuffixFixture,
} from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  curatedFixtureRow,
  fixtureIncluded,
  collectCuratedFixture,
  consumeCuratedExit,
} from './curated-stream-test-helpers.js';

for (const size of [512, 8192]) {
  describe(`curated real journal iteration: ${size} rows`, () => {
    it('preserves independently selected rows and only owns one decoded row', async () => {
      await withSuffixFixture(
        size,
        async (service, ownership, counters) => {
          const stream = service.streamCuratedHistory();
          expect(Symbol.asyncIterator in stream).toBe(true);
          let index = 0;
          let count = 0;
          for await (const row of stream) {
            while (!fixtureIncluded(index)) index++;
            expect(row).toStrictEqual(curatedFixtureRow(index, 2048));
            index++;
            count++;
          }
          expect(count).toBe(
            Array.from({ length: size }, (_, i) => i).filter(fixtureIncluded)
              .length,
          );
          expect(counters.snapshot().peakDecodedRows).toBe(1);
          expect(ownership.snapshot()).toMatchObject({
            peakRows: 1,
            liveRows: 0,
          });
        },
        2048,
        curatedFixtureRow,
      );
    }, 120_000);

    it('keeps curated values and provider projection bytes after a compressed rewrite', async () => {
      await withSuffixFixture(
        size,
        async (service, ownership, counters) => {
          const replacement = Array.from({ length: size / 2 }, (_, i) =>
            curatedFixtureRow(size + i),
          ).filter((row) => row.blocks.length > 0);
          await service.replaceAll(replacement, 'test');
          await service.waitForTokenUpdates();
          const expected = replacement.filter((row) => {
            const seq = row.metadata?.chronology?.seq;
            if (seq === undefined)
              throw new Error('Missing fixture chronology');
            return fixtureIncluded(seq - 1);
          });
          const actual = await collectCuratedFixture(
            service.streamCuratedHistory(),
          );
          expect(actual).toStrictEqual(expected);
          const logger = new DebugLogger('curated-byte-test');
          const tail = [suffixRow(size + 100)];
          const digest = (value: unknown): string =>
            createHash('sha256').update(JSON.stringify(value)).digest('hex');
          expect(digest(buildProviderContent(actual, tail, logger))).toBe(
            digest(buildProviderContent(expected, tail, logger)),
          );
          expect(counters.snapshot().peakDecodedRows).toBe(1);
          expect(ownership.snapshot().liveRows).toBe(0);
        },
        0,
        curatedFixtureRow,
      );
    }, 120_000);
  });
}

describe('curated membership snapshots', () => {
  it('captures independent membership on each first next across append and clear', async () => {
    await withSuffixFixture(0, async (service, ownership) => {
      service.add(suffixRow(0));
      const admitted = ownership.snapshot().acquisitions;
      const unused = service.streamCuratedHistory();
      await unused.return();
      expect(ownership.snapshot().acquisitions).toBe(admitted);
      const first = service.streamCuratedHistory();
      const second = service.streamCuratedHistory();
      service.add(suffixRow(1));
      const expectedFirst = curatedHistoryForTest(service);
      const firstHead = await first.next();
      service.add(suffixRow(2));
      const expectedSecond = curatedHistoryForTest(service);
      const secondHead = await second.next();
      service.clear();
      service.add(suffixRow(3));
      expect([
        firstHead.value,
        ...(await collectCuratedFixture(first)),
      ]).toStrictEqual(expectedFirst);
      expect([
        secondHead.value,
        ...(await collectCuratedFixture(second)),
      ]).toStrictEqual(expectedSecond);
      expect(
        await collectCuratedFixture(service.streamCuratedHistory()),
      ).toStrictEqual(curatedHistoryForTest(service));
      expect(ownership.snapshot().liveRows).toBe(0);
      expect(ownership.snapshot().peakRows).toBe(3);
    });
  });

  it('does not let mutations of decoded durable rows alter another consumer', async () => {
    await withSuffixFixture(
      12,
      async (service) => {
        const first = await collectCuratedFixture(
          service.streamCuratedHistory(),
        );
        const second = await collectCuratedFixture(
          service.streamCuratedHistory(),
        );
        first[0].blocks.push({ type: 'text', text: 'consumer-only' });
        expect(
          await collectCuratedFixture(service.streamCuratedHistory()),
        ).toStrictEqual(second);
      },
      0,
      curatedFixtureRow,
    );
  });
});

describe('curated reader lifecycle', () => {
  for (const exit of ['return', 'throw', 'break', 'consumer-throw'] as const) {
    it(`closes its fold and releases the yielded row on ${exit}`, async () => {
      await withSuffixFixture(
        512,
        async (service, ownership) => {
          const before = scratchDirectories();
          const stream = service.streamCuratedHistory();
          expect((await stream.next()).done).toBe(false);
          const created = scratchDirectories().filter(
            (dir) => !before.includes(dir),
          );
          expect(created.length).toBeGreaterThan(0);
          expect(ownership.snapshot().liveRows).toBe(1);
          try {
            const failures = {
              return: undefined,
              throw: 'iterator failed',
              break: undefined,
              'consumer-throw': 'consumer failed',
            };
            expect(await consumeCuratedExit(stream, exit)).toBe(failures[exit]);
            expect(ownership.snapshot().liveRows).toBe(0);
            expect(created.every((dir) => !existsSync(dir))).toBe(true);
          } finally {
            await stream.return();
          }
        },
        0,
        curatedFixtureRow,
      );
    });
  }

  it('rejects pre-aborted reads without acquiring rows and releases suspended reads on abort', async () => {
    await withSuffixFixture(
      512,
      async (service, ownership) => {
        const controller = new AbortController();
        controller.abort(new Error('before read'));
        await expect(
          service.streamCuratedHistory(controller.signal).next(),
        ).rejects.toThrow('before read');
        expect(ownership.snapshot().acquisitions).toBe(0);
        const active = new AbortController();
        const stream = service.streamCuratedHistory(active.signal);
        await stream.next();
        active.abort(new Error('cancelled'));
        await expect(stream.next()).rejects.toThrow('cancelled');
        expect(ownership.snapshot().liveRows).toBe(0);
      },
      0,
      curatedFixtureRow,
    );
  });
});

describe('curated reader errors', () => {
  it('preserves row-read errors and releases rows from the previous yield', async () => {
    let active = 0;
    let decoded = 0;
    const service = new HistoryService({
      attachmentCounters: {
        recordDecoded: () => {},
        rowDecoded: () => {
          decoded++;
          if (decoded === 2) throw new Error('read failed');
          active++;
        },
        rowReleased: () => {
          active--;
        },
      },
    });
    try {
      service.add(suffixRow(0));
      service.add(suffixRow(1));
      const stream = service.streamCuratedHistory();
      await stream.next();
      await expect(stream.next()).rejects.toThrow('read failed');
      expect(active).toBe(0);
    } finally {
      service.dispose();
    }
  });
});
