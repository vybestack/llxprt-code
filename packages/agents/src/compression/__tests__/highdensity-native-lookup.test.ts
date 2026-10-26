/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import type { ToolCallBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { withNativeFallbackFixture } from './support/native-fallback-fixture.js';
import {
  highdensityRow,
  highdensitySetup,
} from './highdensity-disk-helpers.js';

function observeCalls(
  history: HistoryService,
  calls: Array<WeakRef<ToolCallBlock>>,
): () => void {
  const open = history.openCompressionInput.bind(history);
  const spy = spyOn(history, 'openCompressionInput').mockImplementation(
    async () => {
      const input = await open();
      const lookup = input.rows.densityCalls;
      if (lookup === undefined)
        throw new Error('Native compression requires journal call facts');
      const read = lookup.firstCall.bind(lookup);
      lookup.firstCall = async (id) => {
        const block = await read(id);
        if (block !== undefined) calls.push(new WeakRef(block));
        return block;
      };
      return input;
    },
  );
  return () => spy.mockRestore();
}
async function collectCalls(
  calls: ReadonlyArray<WeakRef<ToolCallBlock>>,
): Promise<number> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  Bun.gc(true);
  return calls.filter((call) => call.deref() !== undefined).length;
}

describe('native high-density source-call block lifetime', () => {
  it.each([65])(
    'releases addressed call blocks during real %i-row output backpressure',
    async (size) => {
      await withNativeFallbackFixture(async ({ history, seed }) => {
        await seed(
          (function* () {
            for (let index = 0; index < size; index++)
              yield highdensityRow(index, 64);
          })(),
        );
        const { handler } = highdensitySetup(history, undefined, undefined, {
          contextLimit: 1e9,
        });
        const calls: Array<WeakRef<ToolCallBlock>> = [];
        const restore = observeCalls(history, calls);
        const transform = history.detachedValues.transform;
        let outputs = 0;
        let samples = 0;
        let peak = 0;
        const sample = async (): Promise<void> => {
          const count = await collectCalls(calls);
          samples++;
          peak = Math.max(peak, count);
          expect(count).toBeLessThanOrEqual(2);
        };
        const publication = spyOn(
          history.detachedValues,
          'transform',
        ).mockImplementation((producer, model, options) =>
          transform(
            async (source, sink) =>
              producer(source, {
                ...sink,
                appendDerived: async (ordinal, row) => {
                  await sink.appendDerived(ordinal, row);
                  if (++outputs % 8 === 0) await sample();
                },
              }),
            model,
            options,
          ),
        );
        try {
          expect(await handler.performCompression('native-call-lifetime')).toBe(
            PerformCompressionResult.COMPRESSED,
          );
          expect(await collectCalls(calls)).toBe(0);
          expect(calls.length).toBeGreaterThan(size / 8);
          expect(samples).toBeGreaterThan(0);
          process.stdout.write(
            `DENSITY_CALL_LIFETIME ${JSON.stringify({ size, calls: calls.length, outputs, samples, peak })}\n`,
          );
        } finally {
          publication.mockRestore();
          restore();
        }
      });
    },
    180_000,
  );
});
