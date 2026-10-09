/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { collectRawHistory } from '@vybestack/llxprt-code-test-utils/core/collect-raw-history.js';
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  suffixRow,
  withSuffixFixture,
} from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import type { IContent } from './IContent.js';

function mixedRow(index: number): IContent {
  return {
    ...suffixRow(index),
    blocks: [
      { type: 'text', text: `row:${index}` },
      {
        type: 'media',
        mimeType: 'image/png',
        encoding: 'base64',
        data: 'aGVsbG8=',
        caption: `image:${index}`,
      },
      {
        type: 'tool_response',
        callId: `call:${index}`,
        toolName: 'read_file',
        result: { index, body: 'x'.repeat(1024) },
        error: index % 3 === 0 ? 'read failed' : undefined,
      },
    ],
  };
}

async function digest(rows: AsyncIterable<IContent>): Promise<string> {
  const hash = createHash('sha256');
  for await (const row of rows) hash.update(JSON.stringify(row));
  return hash.digest('hex');
}

for (const size of [512, 8192]) {
  for (const compressed of [false, true]) {
    describe(`raw journal stream: ${size} rows, compression=${compressed}`, () => {
      it('preserves every raw row and media/error field with one reader-owned row', async () => {
        await withSuffixFixture(
          size,
          async (service, ownership, counters) => {
            if (compressed) {
              await service.replaceAll(
                Array.from({ length: size / 2 }, (_, index) =>
                  mixedRow(index + size),
                ),
                'test',
              );
              await service.waitForTokenUpdates();
            }
            const expected = createHash('sha256');
            for (const row of await collectRawHistory(service))
              expected.update(JSON.stringify(row));
            const stream = service.streamRawHistory();
            expect(Symbol.asyncIterator in stream).toBe(true);
            expect(await digest(stream)).toBe(expected.digest('hex'));
            expect(counters.snapshot().peakDecodedRows).toBe(1);
            expect(ownership.snapshot().peakRows).toBe(1);
            expect(ownership.snapshot().liveRows).toBe(0);
          },
          0,
          mixedRow,
        );
      }, 120_000);

      it('releases reader ownership on cancellation without yielding another row', async () => {
        await withSuffixFixture(
          size,
          async (service, ownership) => {
            if (compressed) {
              await service.replaceAll(
                [mixedRow(size), mixedRow(size + 1)],
                'test',
              );
              await service.waitForTokenUpdates();
            }
            const controller = new AbortController();
            const stream = service.streamRawHistory(controller.signal);
            expect((await stream.next()).done).toBe(false);
            expect(ownership.snapshot().liveRows).toBe(1);
            controller.abort(new Error('raw read cancelled'));
            await expect(stream.next()).rejects.toThrow('raw read cancelled');
            expect(ownership.snapshot().liveRows).toBe(0);
            expect(ownership.snapshot().peakRows).toBe(1);
          },
          0,
          mixedRow,
        );
      }, 120_000);
    });
  }
}

describe('raw stream snapshot lifetime', () => {
  it('captures on first next, preserves pinned rows across clear, and closes early', async () => {
    await withSuffixFixture(0, async (service, ownership) => {
      service.add(suffixRow(0));
      service.add(suffixRow(1));
      const unused = service.streamRawHistory();
      await unused.return();
      expect(ownership.snapshot().acquisitions).toBe(0);
      const stream = service.streamRawHistory();
      service.add(suffixRow(2));
      const first = await stream.next();
      service.clear();
      const tail = await Array.fromAsync(stream);
      expect([first.value, ...tail]).toHaveLength(3);
      expect(ownership.snapshot().liveRows).toBe(0);
      expect(await Array.fromAsync(service.streamRawHistory())).toStrictEqual(
        [],
      );
    });
  });

  it('rejects pre-aborted reads without acquiring a row', async () => {
    await withSuffixFixture(2, async (service, ownership) => {
      const controller = new AbortController();
      controller.abort(new Error('before read'));
      await expect(
        service.streamRawHistory(controller.signal).next(),
      ).rejects.toThrow('before read');
      expect(ownership.snapshot().acquisitions).toBe(0);
    });
  });
});
