/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { createHash } from 'node:crypto';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RuntimeGenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import { JournalDumpSnapshot } from '@vybestack/llxprt-code-core/services/history/journalDumpSnapshot.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { withNativeFallbackFixture } from './support/native-fallback-fixture.js';
import {
  middleoutSetup,
  middleoutOracle,
  middleoutRow,
  SummaryTransport,
} from './middleout-disk-helpers.js';
import { oneshotSetup, oneshotOracle } from './oneshot-disk-helpers.js';

async function collectGarbage(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  Bun.gc(true);
}

class StreamingSummaryTransport extends SummaryTransport {
  sample: () => Promise<void> = async () => {};
  override async *generateChatCompletion(
    options: RuntimeGenerateChatOptions | AsyncIterable<IContent>,
  ): AsyncGenerator<IContent, void, unknown> {
    if (!('contents' in options)) throw new Error('Expected chat options');
    const hash = createHash('sha256').update('[');
    let count = 0;
    for await (const row of options.contents) {
      if (count > 0) hash.update(',');
      hash.update(JSON.stringify(row));
      if (++count % 8 === 0) await this.sample();
    }
    this.requests.push(hash.update(']').digest('hex'));
    await this.sample();
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

describe('native summary input loaded rows', () => {
  for (const strategy of ['middle-out', 'one-shot'] as const) {
    it.each([65, 400])(
      `${strategy} releases actual decoded rows while its %i-row input stays pinned without a third-party hook`,
      async (size) => {
        await withNativeFallbackFixture(async ({ history, seed }) => {
          await seed(
            (function* () {
              for (let index = 0; index < size; index++)
                yield middleoutRow(index, 64);
            })(),
          );
          const oracle =
            strategy === 'middle-out' ? middleoutOracle : oneshotOracle;
          const expected = await oracle(history, size, 64);
          const transport = new StreamingSummaryTransport();
          const setup =
            strategy === 'middle-out' ? middleoutSetup : oneshotSetup;
          const { handler } = setup(history, transport);
          const decoded: Array<WeakRef<IContent>> = [];
          let peakLive = 0;
          let samples = 0;
          let comprehensiveRows = 0;
          const read = JournalDumpSnapshot.prototype.readRow;
          JournalDumpSnapshot.prototype.readRow = async function (
            this: JournalDumpSnapshot,
            index: number,
          ): Promise<IContent> {
            const value = await read.call(this, index);
            decoded.push(new WeakRef(value));
            return value;
          };
          const comprehensive = history.getComprehensive.bind(history);
          const scans = spyOn(history, 'getComprehensive').mockImplementation(
            async function* () {
              for await (const value of comprehensive()) {
                comprehensiveRows++;
                yield value;
              }
            },
          );
          transport.sample = async () => {
            await collectGarbage();
            samples++;
            const live = decoded.filter(
              (weak) => weak.deref() !== undefined,
            ).length;
            peakLive = Math.max(peakLive, live);
            expect(live).toBeLessThanOrEqual(2);
          };
          try {
            expect(
              await handler.performCompression('bounded-native-input'),
            ).toBe(PerformCompressionResult.COMPRESSED);
            await collectGarbage();
            expect(
              decoded.filter((weak) => weak.deref() !== undefined),
            ).toHaveLength(0);
            expect(decoded.length).toBeGreaterThan(size / 2);
            expect(decoded.length).toBeLessThan(size * 4);
            expect(samples).toBeGreaterThan(0);
            expect(peakLive).toBeLessThanOrEqual(2);
            expect(transport.requests).toStrictEqual(
              expected.requests.map((request) =>
                createHash('sha256').update(request).digest('hex'),
              ),
            );
            expect(comprehensiveRows).toBe(0);
            process.stdout.write(
              JSON.stringify({
                strategy,
                size,
                decoded: decoded.length,
                samples,
                peakLive,
                comprehensiveRows,
              }) + '\n',
            );
          } finally {
            JournalDumpSnapshot.prototype.readRow = read;
            scans.mockRestore();
          }
        });
      },
      180_000,
    );
  }
});
