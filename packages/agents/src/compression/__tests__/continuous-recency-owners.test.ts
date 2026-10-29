/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { openOwnedJournal } from '@vybestack/llxprt-code-core/services/history/journalOwnedFixture.js';
import { useTempDir } from '../../../../core/src/journal/__tests__/support/useTempDir.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { nativeRecencyPolicy } from '../nativeRecencyPolicy.js';
import { HighDensityStrategy } from '../HighDensityStrategy.js';
import { densityConfig } from './density-disk-helpers.js';
import { compressionValueDigest } from './compression-value-fixture.js';

function row(index: number): IContent {
  return {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: `unanswered-${index}`,
        toolName: 'read_file',
        result: { text: `result-${index}` },
        error: index % 2 !== 0 ? 'external' : undefined,
      },
    ],
    metadata: {
      chronology: { seq: index + 1, userTurn: 1, step: index, recordedAt: 0 },
    },
  };
}
describe('continuous recency current source ownership', () => {
  const root = useTempDir('continuous-recency-owner-');
  it.each([3, 64, 65, 5000])(
    'retains each current owner after pruning %i raw rows with no matching calls',
    async (size) => {
      const owned = await openOwnedJournal(
        join(root(), 'owners.llxj'),
        Array.from({ length: size }, (_, index) => ({
          content: row(index),
          origin: index % 2 !== 0 ? 'agent-b' : 'agent-a',
        })),
      );
      try {
        await owned.store.optimizeDensity({
          nativePolicy: () => nativeRecencyPolicy(densityConfig(4)),
          optimize: () => {
            throw new Error('Native operation selected disk optimizer');
          },
          mutate: async () => {
            throw new Error('Native operation selected old mutation');
          },
          host: owned.host,
        });
        const original = Array.from({ length: size }, (_, index) => row(index));
        const result = new HighDensityStrategy().optimize(
          original,
          densityConfig(4),
        );
        const expected = original.map(
          (value, index) => result.replacements.get(index) ?? value,
        );
        expect(
          await compressionValueDigest(owned.store.streamRows()),
        ).toStrictEqual(
          await compressionValueDigest(
            (async function* () {
              yield* expected;
            })(),
          ),
        );
        expect(await owned.originsOfRows()).toStrictEqual(
          Array.from({ length: size }, (_, index) =>
            index % 2 !== 0 ? 'agent-b' : 'agent-a',
          ),
        );
        expect(owned.store.getLength()).toBe(size);
      } finally {
        await owned.dispose();
      }
    },
    180_000,
  );
});
