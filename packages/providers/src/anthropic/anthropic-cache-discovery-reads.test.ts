/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import { testJournalSeams } from '@vybestack/llxprt-code-core/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { anthropicRepairFactIndex } from './anthropic-repair-fact-writer.js';
import { AnthropicRepairIndex } from './anthropic-repair-index.js';
import { AnthropicStreamRepair } from './anthropic-stream-repair.js';
import { writeAnthropicCacheWindows } from './anthropic-cache-windows.js';
import { repairSettings } from './anthropic-stream-repair.test.js';

describe('native Anthropic cache discovery', () => {
  const directory = useTempDir('anthropic-cache-discovery-');
  it.each([false, true])(
    'discovers cache windows without decoding text-only atoms (image: %s)',
    async (image) => {
      const session = await JournalSession.create(
        `${directory()}/${image}.llxj`,
        { journal: testJournalSeams().dependencies },
      );
      try {
        await session.append(
          Array.from(
            { length: 40 },
            (_, at): IContent => ({
              speaker: at % 2 === 0 ? 'human' : 'ai',
              blocks: [
                { type: 'text', text: `cache discovery payload ${at}` },
                ...(image && at === 2
                  ? [
                      {
                        type: 'media',
                        encoding: 'url',
                        mimeType: 'image/png',
                        data: 'https://example.com/image.png',
                      } satisfies IContent['blocks'][number],
                    ]
                  : []),
              ],
            }),
          ),
        );
        const registration = anthropicRepairFactIndex(repairSettings);
        await session.store.commit([
          {
            kind: 'factIndex',
            registration: {
              ...registration,
              async write(snapshot, writer, generation) {
                await registration.write(snapshot, writer, generation);
                const query =
                  await IndexedJournalRequestSnapshot.create(snapshot);
                try {
                  const index = await AnthropicRepairIndex.prepared(
                    writer,
                    generation,
                  );
                  const engine = await AnthropicStreamRepair.create(
                    query,
                    repairSettings,
                    {},
                    index,
                  );
                  await writeAnthropicCacheWindows(engine, writer);
                  expect(await writer.get(['cache-runs'])).toStrictEqual([40]);
                  expect(
                    await writer.get(['cache-purge-windows']),
                  ).toStrictEqual([Number(image)]);
                  expect(engine.source.work.unitReads).toBe(0);
                  let body = '';
                  for await (const piece of engine.serialize()) body += piece;
                  expect(body).toContain('cache discovery payload 39');
                  expect(body.includes('https://example.com/image.png')).toBe(
                    image,
                  );
                } finally {
                  await query.close();
                }
              },
            },
          },
        ]);
      } finally {
        await session.close();
      }
    },
  );
});
