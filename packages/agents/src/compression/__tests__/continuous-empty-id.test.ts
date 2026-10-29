/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { DensityReadWriteFacts } from '@vybestack/llxprt-code-core/journal/density-read-write-facts.js';
import { join } from 'node:path';
import { openOwnedJournal } from '@vybestack/llxprt-code-core/services/history/journalOwnedFixture.js';
import { decodeStoredRow } from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';
import { nativeRecencyPolicy } from '../nativeRecencyPolicy.js';
import { useTempDir } from '../../../../core/src/journal/__tests__/support/useTempDir.js';
import type {
  IContent,
  ContentBlock,
  ToolCallBlock,
  ToolResponseBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { invalidateResponsesStatefulChain } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { HighDensityStrategy } from '../HighDensityStrategy.js';
import {
  densityConfig,
  densityHandler,
  digestRows,
  digestStream,
} from './density-disk-helpers.js';
import { withNativeFallbackFixture } from './support/native-fallback-fixture.js';
import { operationFileCreates } from './support/operation-file-creates.js';
import { compressionValueDigest } from './compression-value-fixture.js';

function call(id: string, path: string, name = 'read_file'): ToolCallBlock {
  return { type: 'tool_call', id, name, parameters: { path } };
}
function response(callId: string, result: string): ToolResponseBlock {
  return { type: 'tool_response', callId, toolName: 'read_file', result };
}
function input(): IContent[] {
  const repeated = call('', 'changed');
  return [
    { speaker: 'ai', blocks: [repeated, repeated] },
    {
      speaker: 'tool',
      blocks: [response('', 'first'), response('', 'second')],
    },
    {
      speaker: 'ai',
      blocks: [
        call('', 'untouched'),
        call('raw/a', 'untouched'),
        call('raw_a', 'untouched'),
      ],
    },
    {
      speaker: 'tool',
      blocks: [
        response('', 'global raw-ID match'),
        response('raw/a', 'keep slash'),
        response('raw_a', 'keep underscore'),
        { type: 'text', text: 'other block' },
      ],
    },
    { speaker: 'ai', blocks: [call('write', 'changed', 'write_file')] },
    {
      speaker: 'human',
      blocks: [
        {
          type: 'text',
          text: '--- same.ts ---\nold\n--- End of content ---\n',
        },
      ],
    },
    {
      speaker: 'human',
      blocks: [
        {
          type: 'text',
          text: '--- same.ts ---\nnew\n--- End of content ---\n',
        },
      ],
    },
    ...Array.from(
      { length: 4 },
      (_, index): IContent => ({
        speaker: 'tool',
        blocks: [response(`other-${index}`, `result-${index}`)],
      }),
    ),
  ];
}

async function checkIndexedEmptyId(
  owned: Awaited<ReturnType<typeof openOwnedJournal>>,
  revision: string,
): Promise<void> {
  const snapshot = await owned.session.store.snapshot();
  const scan = spyOn(snapshot, 'entries').mockImplementation(() => {
    throw new Error('Empty-ID point query scanned history');
  });
  try {
    const files = await snapshot.densityFiles(revision);
    const facts = new DensityReadWriteFacts(files.reader, await files.header());
    expect(await facts.stale(0, '')).toBe(true);
    expect(await facts.stale(2, '')).toBe(false);
    expect(await facts.staleId('')).toBe(true);
    expect(await facts.staleId('raw/a')).toBe(false);
    expect(await facts.staleId('raw_a')).toBe(false);
    expect(await facts.remaining(3, 1)).toBe(6);
    expect(await facts.remaining(3, 2)).toBe(5);
  } finally {
    scan.mockRestore();
    await snapshot.close();
  }
}

describe('continuous density duplicate empty raw IDs', () => {
  const directory = useTempDir('continuous-empty-id-');

  it('keeps current owners and old-version blocks through failed publication and same-writer continuation', async () => {
    const original = input();
    const owned = await openOwnedJournal(
      join(directory(), 'owners.llxj'),
      original.map((content, index) => ({
        content,
        origin: index % 2 === 0 ? 'agent-a' : 'agent-b',
      })),
    );
    const before = digestRows(original);
    const pin = await owned.session.store.snapshot();
    const failure = new Error('empty-ID candidate estimate failure');
    const config = densityConfig(1);
    const request = {
      nativePolicy: () => nativeRecencyPolicy(config),
      optimize: (): never => {
        throw new Error('Native selected old optimizer');
      },
      mutate: async (): Promise<never> => {
        throw new Error('Native selected old mutation');
      },
      host: owned.host,
    };
    try {
      await expect(
        owned.store.optimizeDensity({
          ...request,
          host: {
            ...owned.host,
            estimate: async (): Promise<never> => {
              throw failure;
            },
          },
        }),
      ).rejects.toBe(failure);
      expect(await digestStream(owned.store.streamRows())).toBe(before);
      expect(owned.host.snapshot().tokens).toBe(0);
      expect(await owned.originsOfRows()).toStrictEqual(
        original.map((_, index) => (index % 2 === 0 ? 'agent-a' : 'agent-b')),
      );
      const files = nativeRecencyPolicy(config).files;
      if (files === undefined) throw new Error('Missing read/write policy');
      await checkIndexedEmptyId(owned, files.facts.revision);
      await owned.store.optimizeDensity(request);
      const expected = invalidateResponsesStatefulChain(
        original
          .slice(2)
          .map((row, index) =>
            index === 1 ? { ...row, blocks: row.blocks.slice(1) } : row,
          ),
      );
      expect(await digestStream(owned.store.streamRows())).toBe(
        digestRows(expected),
      );
      expect(await owned.originsOfRows()).toStrictEqual(
        original
          .slice(2)
          .map((_, index) => (index % 2 === 0 ? 'agent-a' : 'agent-b')),
      );
      expect(owned.host.snapshot().tokens).toBe(expected.length);
      const old: IContent[] = [];
      for await (const entry of pin.entries())
        old.push(decodeStoredRow(await pin.readRow(entry)));
      expect(digestRows(old)).toBe(before);
      expect(pin.rows).toBe(original.length);
    } finally {
      await pin.close();
      await owned.dispose();
    }
  });

  it.each(['', 'duplicate', 'raw/a', 'raw_a'])(
    'removes duplicate %j calls and whitespace without discarding a surviving media block',
    (id) => {
      const repeated = call(id, 'changed');
      const media = {
        type: 'media',
        encoding: 'base64',
        mimeType: 'audio/wav',
        data: 'aGVsbG8=',
      } satisfies ContentBlock;
      const rows: IContent[] = [
        {
          speaker: 'ai',
          blocks: [repeated, repeated, { type: 'text', text: '  ' }],
        },
        { speaker: 'ai', blocks: [repeated, repeated, media] },
        { speaker: 'ai', blocks: [call('writer', 'changed', 'write_file')] },
      ];
      const result = new HighDensityStrategy().optimize(rows, densityConfig(1));
      expect(result.removals).toStrictEqual([0]);
      expect(result.replacements.get(1)?.blocks).toStrictEqual([media]);
    },
  );

  it('removes an exhausted duplicate-call row rather than emitting an inadmissible empty replacement', () => {
    const result = new HighDensityStrategy().optimize(
      input(),
      densityConfig(1),
    );
    process.stdout.write(
      `EMPTY_ID_ARRAY ${JSON.stringify({ removals: result.removals, replacements: [...result.replacements] })}\n`,
    );
    expect(result.removals).toContain(0);
    expect(result.replacements.has(0)).toBe(false);
    expect(result.removals).toContain(1);
    expect(result.replacements.get(3)?.blocks).toStrictEqual(
      input()[3].blocks.slice(1),
    );
    expect(result.removals).not.toContain(2);
  });

  it.each([1, 3, 5, 7])(
    'publishes exact array values and successful tokens without files for mask %i',
    async (mask) => {
      await withNativeFallbackFixture(
        async ({ history, seed, durable, owners }) => {
          await seed(input());
          const rows: IContent[] = [];
          for await (const row of history.streamRawHistory()) rows.push(row);
          const result = new HighDensityStrategy().optimize(
            rows,
            densityConfig(mask),
          );
          const expected = invalidateResponsesStatefulChain(
            rows.flatMap((row, index) =>
              result.removals.includes(index)
                ? []
                : [result.replacements.get(index) ?? row],
            ),
          );
          const expectedTokens =
            await history.estimateTokensForContents(expected);
          const beforeTokens = history.getTotalTokens();
          await expect(
            operationFileCreates(
              () => densityHandler(history, mask).ensureDensityOptimized(),
              true,
            ),
          ).resolves.toStrictEqual({ directories: [], files: [] });
          expect(await digestStream(history.streamRawHistory())).toBe(
            digestRows(expected),
          );
          expect(await durable()).toStrictEqual(
            await compressionValueDigest(
              (async function* () {
                yield* expected;
              })(),
            ),
          );
          expect(history.getTotalTokens()).toBe(expectedTokens);
          expect(history.getTotalTokens() - beforeTokens).toBe(
            expectedTokens - beforeTokens,
          );
          expect(owners.snapshot().liveRows).toBe(0);
        },
      );
    },
  );
});
