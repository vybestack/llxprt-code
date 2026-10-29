/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RuntimeGenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  middleoutRow,
  middleoutOracle,
  middleoutSetup,
  MiddleoutDiskHistory,
  SummaryTransport,
} from './middleout-disk-helpers.js';
import { oneshotOracle, oneshotSetup } from './oneshot-disk-helpers.js';

class DigestTransport extends SummaryTransport {
  readonly receipts: Array<{ hash: string; bytes: number; rows: number }> = [];
  cancel = true;
  override async *generateChatCompletion(
    options: RuntimeGenerateChatOptions | AsyncIterable<IContent>,
  ): AsyncGenerator<IContent, void, unknown> {
    if (!('contents' in options)) throw new Error('Expected summary options');
    const digest = createHash('sha256');
    let bytes = 0;
    let rows = 0;
    const write = (text: string): void => {
      digest.update(text);
      bytes += Buffer.byteLength(text);
    };
    write('[');
    try {
      for await (const row of options.contents) {
        if (rows > 0) write(',');
        write(JSON.stringify(row));
        rows++;
        if (this.cancel && rows === 3)
          throw new DOMException(
            'cancelled after third demanded row',
            'AbortError',
          );
      }
      write(']');
    } finally {
      this.receipts.push({ hash: digest.digest('hex'), bytes, rows });
    }
    yield {
      speaker: 'ai',
      blocks: [
        { type: 'text', text: '<state_snapshot>kept details</state_snapshot>' },
      ],
      metadata: {
        usage: { promptTokens: 71, completionTokens: 9, totalTokens: 80 },
      },
    };
  }
}

const cases = ['middle-out', 'one-shot'].flatMap((strategy) =>
  [512, 8192, 'large'].map((scale) => ({ strategy, scale })),
);
describe('native summary request byte digest and demand', () => {
  for (const { strategy, scale } of cases) {
    it(`${strategy} streams the original ${scale} request bytes after early consumer cancellation`, async () => {
      const size = typeof scale === 'number' ? scale : 512;
      const payload = scale === 'large' ? 64 : 2048;
      const makeRow = (index: number, bytes: number): IContent =>
        scale === 'large' && index === 200
          ? {
              ...middleoutRow(index, bytes),
              speaker: 'human',
              blocks: [
                {
                  type: 'text',
                  text: 'large-request:' + 'x'.repeat(9 * 1024 * 1024),
                },
              ],
            }
          : middleoutRow(index, bytes);
      await withSuffixFixture(
        size,
        async (history, owners) => {
          const oracle =
            strategy === 'middle-out' ? middleoutOracle : oneshotOracle;
          const expected = await oracle(history, size, payload, makeRow);
          const transport = new DigestTransport();
          const setup =
            strategy === 'middle-out' ? middleoutSetup : oneshotSetup;
          const { handler } = setup(history, transport);
          await expect(handler.performCompression('cancel')).rejects.toThrow(
            'cancelled after third demanded row',
          );
          expect(transport.receipts).toHaveLength(1);
          expect(transport.receipts[0].rows).toBe(3);
          expect(owners.snapshot().liveRows).toBe(0);
          transport.cancel = false;
          expect(await handler.performCompression('digest')).toBe(
            PerformCompressionResult.COMPRESSED,
          );
          const completed = transport.receipts[1];
          expect(completed.hash).toBe(
            createHash('sha256').update(expected.requests[0]).digest('hex'),
          );
          expect(completed.bytes).toBe(Buffer.byteLength(expected.requests[0]));
          expect(completed.rows).toBeGreaterThan(size * 0.4);
          expect(completed.bytes > 9 * 1024 * 1024).toBe(scale === 'large');
          expect(transport.requests).toHaveLength(0);
          expect(owners.snapshot().peakRows).toBeLessThanOrEqual(440);
          const bounded =
            scale === 'large'
              ? owners.snapshot().peakRows <= 440
              : owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 });
          expect(bounded).toBe(true);
          expect(owners.snapshot().liveRows).toBe(0);
          expect(owners.snapshot().liveSerializedBytes).toBe(0);
        },
        payload,
        makeRow,
        undefined,
        (options) => new MiddleoutDiskHistory(options),
      );
    }, 180_000);
  }
});
