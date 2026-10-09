/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import {
  withSuffixFixture,
  suffixRow,
} from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { curatedFixtureRow } from '../../../../core/src/services/history/curated-stream-test-helpers.js';
import {
  AttemptHistory,
  attemptHandler,
  expectedCuratedDigest,
} from './compression-attempt-stream-helpers.js';

const PAYLOAD = 24 * 1024;

function registerPinnedCases(): void {
  describe('pinned mixed fixtures', () => {
    for (const size of [512, 8192]) {
      it(`keeps mixed ${size}-row hook membership pinned across append`, async () => {
        await withSuffixFixture(
          size,
          async (service, ownership) => {
            const hash = createHash('sha256');
            let count = 0;
            const handler = attemptHandler(service, async (context) => {
              const first = await context.history.next();
              if (first.done === true)
                throw new Error('Expected nonempty curated cursor');
              hash.update(JSON.stringify(first.value));
              count += 1;
              service.add(suffixRow(size));
              await service.waitForTokenUpdates();
              for await (const row of context.history) {
                hash.update(JSON.stringify(row));
                count += 1;
              }
              service.clear();
            });
            const result = await handler.performCompression('pinned');
            expect(result).toBe(PerformCompressionResult.SKIPPED_EMPTY);
            expect(hash.digest('hex')).toBe(
              expectedCuratedDigest(size, PAYLOAD),
            );
            expect(count).toBe(
              Array.from({ length: size }, (_, index) => index).filter(
                (index) => ![2, 3, 7, 10].includes(index % 12),
              ).length,
            );
            expect(ownership.snapshot().liveRows).toBe(0);
            expect(ownership.snapshot().peakRows).toBeLessThanOrEqual(440);
            expect(
              ownership.snapshot().peakSerializedBytes,
            ).toBeLessThanOrEqual(8 * 1024 * 1024);
          },
          PAYLOAD,
          curatedFixtureRow,
          undefined,
          (options) => new AttemptHistory(options),
        );
      }, 120_000);

      for (const failure of [false, true]) {
        it(`closes an abandoned ${size}-row hook cursor on ${failure ? 'failure' : 'success'}`, async () => {
          await withSuffixFixture(
            size,
            async (service, ownership) => {
              let sawRow = false;
              let ownedDuringHook: number | undefined;
              const handler = attemptHandler(service, async (context) => {
                const row = await context.history.next();
                sawRow = row.done !== true;
                ownedDuringHook = ownership.snapshot().liveRows;
                if (failure) throw new Error('External hook rejected');
              });
              expect(await handler.performCompression('abandoned')).toBe(
                PerformCompressionResult.NOOP,
              );
              expect(sawRow).toBe(true);
              expect(ownedDuringHook).toBe(1);
              expect(ownership.snapshot().liveRows).toBe(0);
            },
            PAYLOAD,
            curatedFixtureRow,
            undefined,
            (options) => new AttemptHistory(options),
          );
        }, 120_000);
      }
    }
  });
}

describe('compression attempt curated cursors', () => {
  registerPinnedCases();

  it('fires a cold manual hook before skipping entirely invalid AI history', async () => {
    await withSuffixFixture(
      512,
      async (service, ownership) => {
        let observed:
          | {
              trigger: string | undefined;
              acquisitions: number;
              todos: string | undefined;
              path: string | undefined;
              prompt: string;
              anchor: number | undefined;
            }
          | undefined;
        const handler = attemptHandler(service, async (context) => {
          observed = {
            trigger: context.trigger,
            acquisitions: ownership.snapshot().acquisitions,
            todos: context.activeTodos,
            path: context.transcriptPath,
            prompt: context.promptId,
            anchor: context.cacheAnchorSeq,
          };
        });
        handler.setActiveTodosProvider(async () => 'task: inspect history');
        handler.setTranscriptPathProvider(() => '/journal/session.jsonl');
        expect(await handler.performCompression('empty')).toBe(
          PerformCompressionResult.SKIPPED_EMPTY,
        );
        expect(observed).toStrictEqual({
          trigger: 'manual',
          acquisitions: 0,
          todos: 'task: inspect history',
          path: '/journal/session.jsonl',
          prompt: 'empty',
          anchor: 0,
        });
        expect(ownership.snapshot().liveRows).toBe(0);
      },
      0,
      () => ({ speaker: 'ai', blocks: [] }),
      undefined,
      (options) => new AttemptHistory(options),
    );
  }, 120_000);

  it('observes hook-added content after an initially empty cold cursor', async () => {
    await withSuffixFixture(
      0,
      async (service, ownership) => {
        let endedEmpty = false;
        let trigger: string | undefined;
        const handler = attemptHandler(service, async (context) => {
          endedEmpty = (await context.history.next()).done === true;
          trigger = context.trigger;
          service.add(suffixRow(0));
          await service.waitForTokenUpdates();
        });
        expect(
          await handler.performCompression('added', { trigger: 'auto' }),
        ).toBe(PerformCompressionResult.NOOP);
        expect(endedEmpty).toBe(true);
        expect(trigger).toBe('auto');
        expect(ownership.snapshot().liveRows).toBe(0);
      },
      0,
      curatedFixtureRow,
      undefined,
      (options) => new AttemptHistory(options),
    );
  });
});
