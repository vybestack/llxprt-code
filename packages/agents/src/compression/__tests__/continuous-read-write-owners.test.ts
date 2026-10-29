/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { openOwnedJournal } from '@vybestack/llxprt-code-core/services/history/journalOwnedFixture.js';
import { useTempDir } from '../../../../core/src/journal/__tests__/support/useTempDir.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { invalidateResponsesStatefulChain } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { nativeRecencyPolicy } from '../nativeRecencyPolicy.js';
import { HighDensityStrategy } from '../HighDensityStrategy.js';
import {
  densityConfig,
  digestRows,
  digestStream,
} from './density-disk-helpers.js';

function row(index: number): IContent {
  const phase = index % 3;
  const id = `read-${Math.floor(index / 3)}`;
  const path = `path-${Math.floor(index / 3) % 7}`;
  const metadata = {
    chronology: {
      seq: 100 - (index % 11),
      userTurn: 1,
      step: index,
      recordedAt: 0,
    },
  };
  return phase === 1
    ? {
        speaker: 'tool',
        metadata,
        blocks: [
          {
            type: 'tool_response',
            callId: id,
            toolName: 'read_file',
            result: `value-${index}`,
          },
        ],
      }
    : {
        speaker: 'ai',
        metadata,
        blocks: [
          {
            type: 'tool_call',
            id: phase === 0 ? id : `write-${index}`,
            name: phase === 0 ? 'read_file' : 'write_file',
            parameters: { path },
          },
        ],
      };
}
describe('native read/write source ownership', () => {
  const root = useTempDir('continuous-read-write-owners-');
  it.each([3, 64, 65, 5000])(
    'preserves each surviving source owner during actual removal over %i rows and clears to zero',
    async (size) => {
      const original = Array.from({ length: size }, (_, index) => row(index));
      const owned = await openOwnedJournal(
        join(root(), 'owners.llxj'),
        original.map((content, index) => ({
          content,
          origin: index % 2 === 0 ? 'agent-a' : 'agent-b',
        })),
      );
      try {
        const result = new HighDensityStrategy().optimize(
          original,
          densityConfig(1),
        );
        const expected = original.flatMap((content, index) =>
          result.removals.includes(index)
            ? []
            : [result.replacements.get(index) ?? content],
        );
        await owned.store.optimizeDensity({
          nativePolicy: () => nativeRecencyPolicy(densityConfig(1)),
          optimize: () => {
            throw new Error('Native density selected disk optimizer');
          },
          mutate: async () => {
            throw new Error('Native density selected old mutation');
          },
          host: owned.host,
        });
        expect(result.removals.length).toBeGreaterThan(0);
        expect(await digestStream(owned.store.streamRows())).toBe(
          digestRows(invalidateResponsesStatefulChain(expected)),
        );
        expect(await owned.originsOfRows()).toStrictEqual(
          original.flatMap((_, index) =>
            result.removals.includes(index)
              ? []
              : [index % 2 === 0 ? 'agent-a' : 'agent-b'],
          ),
        );
        expect(owned.store.getLength()).toBe(expected.length);
        await owned.session.store.commit([{ kind: 'clear' }]);
        const cleared = await owned.session.store.snapshot();
        try {
          expect(cleared.rows).toBe(0);
        } finally {
          await cleared.close();
        }
      } finally {
        await owned.dispose();
      }
    },
    180_000,
  );
});
