/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import { testJournalSeams } from '@vybestack/llxprt-code-core/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { anthropicRepairFactIndex } from './anthropic-repair-fact-writer.js';
import { anthropicRepairScope } from './anthropic-repair-index.js';
import { readAnthropicMediaLedger } from './anthropic-media-ledger.js';

const settings: RowFormatSettings = {
  formatId: 'anthropic',
  formatRev: 1,
  model: 'claude-sonnet-4',
  endpoint: 'https://api.anthropic.com',
  isOAuth: false,
  toolNameTransform: 'none',
  supportsUrlImages: true,
  reasoningEnabled: false,
  reasoningFieldName: 'reasoning_content',
  mediaPdfEnabled: true,
  unsupportedMedia: 'notice',
  outputLimits: null,
  anthropic: { cache: 'off', imageBudget: null },
};

describe('Anthropic unsupported media ledger bounds', () => {
  const directory = useTempDir('anthropic-ledger-bounds-');
  it.each([100, 1000])(
    'retains a fixed descriptor sample across %s indexed rows and an overlay',
    async (count) => {
      const session = await JournalSession.create(
        `${directory()}/ledger.llxj`,
        { journal: testJournalSeams().dependencies },
      );
      try {
        await session.append(
          Array.from({ length: count }, (_, index) => ({
            speaker: index % 2 === 0 ? 'human' : 'ai',
            blocks: [
              {
                type: 'media',
                mimeType: 'audio/wav',
                encoding: 'base64',
                data: 'AA==',
              },
            ],
          })),
        );
        await session.store.commit([
          {
            kind: 'factIndex',
            registration: anthropicRepairFactIndex(settings),
          },
        ]);
        const snapshot = await session.store.snapshot();
        try {
          const query = await IndexedJournalRequestSnapshot.create(snapshot, [
            {
              speaker: 'human',
              blocks: [
                {
                  type: 'media',
                  mimeType: 'video/mp4',
                  encoding: 'base64',
                  data: 'AA==',
                },
              ],
            },
          ]);
          try {
            const entries = await readAnthropicMediaLedger(
              query,
              await snapshot.nativeFacts(anthropicRepairScope(settings)),
              settings,
            );
            expect(entries).toHaveLength(9);
            expect(entries[8]?.reason).toContain(`audio=${count}`);
            expect(entries[8]?.reason).toContain('video=1');
          } finally {
            await query.close();
          }
        } finally {
          await snapshot.close();
        }
      } finally {
        await session.close();
      }
    },
  );
});
