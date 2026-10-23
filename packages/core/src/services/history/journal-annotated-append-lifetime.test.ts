/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import { exactTokenizer } from './chronology-rollback-test-helpers.js';

function row(index: number): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text: `input ${index}` }],
    metadata: {
      chronology: {
        seq: index * 4,
        userTurn: index + 1,
        step: 1,
        recordedAt: 0,
      },
    },
  };
}

async function collectGarbage(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  Bun.gc(true);
}

function live(refs: ReadonlyArray<WeakRef<IContent>>): number {
  return refs.filter((ref) => ref.deref() !== undefined).length;
}

function assertBounded(refs: ReadonlyArray<WeakRef<IContent>>): void {
  expect(live(refs)).toBeLessThanOrEqual(2);
}

describe('annotated native append backpressure and complete large values', () => {
  it.each([512, 8192])(
    'releases actual converted sink rows during %i annotated derived appends',
    async (size) => {
      const history = new HistoryService({});
      history.setTokenizerFactory(exactTokenizer());
      const refs: Array<WeakRef<IContent>> = [];
      let peak = 0;
      let samples = 0;
      try {
        await history.detachedValues.append(
          (function* (): Generator<IContent> {
            for (let index = 0; index < size; index++) yield row(index);
          })(),
        );
        const host = history.detachedValues.host();
        await host.journal.publishDetached(
          {
            append: true,
            transform: async (source, sink) => {
              await sink.removeValue(0);
              let ordinal = 0;
              for await (const content of source.streamRows()) {
                const converted = { ...content, blocks: [...content.blocks] };
                refs.push(new WeakRef(converted));
                await sink.appendDerived(ordinal++, converted);
                if (ordinal % 128 === 0) {
                  await collectGarbage();
                  samples++;
                  peak = Math.max(peak, live(refs));
                  assertBounded(refs);
                }
              }
            },
          },
          host,
          undefined,
          {},
        );
        await collectGarbage();
        expect(refs.length).toBe(size);
        expect(samples).toBe(size / 128);
        expect(live(refs)).toBe(0);
        process.stdout.write(
          `ANNOTATED_APPEND_LIFETIME ${JSON.stringify({ size, samples, peak, final: live(refs) })}\n`,
        );
      } finally {
        await history.dispose();
      }
    },
    180_000,
  );

  it('preserves every character of a greater-than-nine-MiB annotated append and its pinned prefix', async () => {
    const history = new HistoryService({});
    history.setTokenizerFactory(exactTokenizer());
    const text = 'abcdefghijk'
      .repeat(Math.ceil((9 * 1024 * 1024 + 17) / 11))
      .slice(0, 9 * 1024 * 1024 + 17);
    try {
      await history.detachedValues.append([row(0)]);
      await history.detachedValues.withCheckpoint(async (checkpoint) => {
        const host = history.detachedValues.host();
        await host.journal.publishDetached(
          {
            append: true,
            transform: async (_source, sink) => {
              await sink.removeValue(0);
              await sink.appendValue({
                speaker: 'human',
                blocks: [{ type: 'text', text }],
              });
            },
          },
          host,
          undefined,
          {},
        );
        const actual: IContent[] = [];
        for await (const content of history.streamRawHistory())
          actual.push(content);
        expect(actual.length).toBe(2);
        expect(actual[1].blocks).toStrictEqual([{ type: 'text', text }]);
        const prior: IContent[] = [];
        for await (const content of checkpoint) prior.push(content);
        expect(prior.length).toBe(1);
        expect(prior[0].blocks).toStrictEqual(row(0).blocks);
      });
    } finally {
      await history.dispose();
    }
  }, 180_000);
});
