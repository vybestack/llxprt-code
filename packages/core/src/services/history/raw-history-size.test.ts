/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { collectRawHistory } from '../../test-utils/collect-raw-history.js';
import { describe, expect, it } from 'bun:test';
import {
  computeHistorySizeBreakdown,
  computeHistorySizeBreakdownStream,
} from './contentSize.js';
import { suffixRow, withSuffixFixture } from './history-suffix-test-helpers.js';
import type { IContent } from './IContent.js';

function measuredRow(index: number): IContent {
  return {
    ...suffixRow(index),
    blocks: [
      {
        type: 'media',
        mimeType: 'image/png',
        encoding: 'base64',
        data: 'eA==',
        caption: `caption:${index}`,
      },
      {
        type: 'tool_response',
        toolName: 'read_file',
        callId: `call:${index}`,
        result: { body: 'x'.repeat(index % 4096) },
        error: index % 2 === 0 ? 'permission denied' : undefined,
      },
    ],
  };
}

for (const size of [512, 8192]) {
  describe(`raw byte accounting over ${size} journal rows`, () => {
    it('keeps logical media, metadata, error attribution and top-response order unchanged', async () => {
      await withSuffixFixture(
        size,
        async (service, ownership) => {
          const expected = computeHistorySizeBreakdown(
            await collectRawHistory(service),
          );
          const actual = await computeHistorySizeBreakdownStream(
            service.streamRawHistory(),
          );
          expect(actual).toStrictEqual(expected);
          expect(ownership.snapshot().peakRows).toBe(1);
          expect(ownership.snapshot().liveRows).toBe(0);
        },
        0,
        measuredRow,
      );
    }, 120_000);
  });
}

describe('streamed byte accounting boundaries', () => {
  it('preserves cross-row alias accounting for non-journal streaming inputs', async () => {
    const shared = measuredRow(99);
    const alias = { ...shared };
    const input = [shared, shared, alias];
    async function* rows(): AsyncIterable<IContent> {
      yield* input;
    }
    expect(await computeHistorySizeBreakdownStream(rows())).toStrictEqual(
      computeHistorySizeBreakdown(input),
    );
  });

  it('surfaces a broken input stream rather than returning partial diagnostics', async () => {
    async function* rows(): AsyncIterable<IContent> {
      yield measuredRow(0);
      throw new Error('size input failed');
    }
    await expect(computeHistorySizeBreakdownStream(rows())).rejects.toThrow(
      'size input failed',
    );
  });
});
