/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { VersionSnapshot } from '@vybestack/llxprt-code-core/journal/versionSnapshot.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { JournalDumpSnapshot } from '@vybestack/llxprt-code-core/services/history/journalDumpSnapshot.js';
import { describe, expect, it, spyOn } from 'bun:test';
import { exactTokenizer } from '../../../core/src/services/history/chronology-rollback-test-helpers.js';
import { SemanticMediaPurgeSession } from './semanticMediaPurgeSession.js';

function row(index: number): IContent {
  if (index === 0)
    return {
      speaker: 'human',
      blocks: [
        { type: 'text', text: 'media prompt' },
        {
          type: 'media',
          encoding: 'base64',
          mimeType: 'image/png',
          data: 'aQ==',
        },
      ],
    };
  return {
    speaker: index % 2 === 0 ? 'human' : 'ai',
    blocks: [{ type: 'text', text: `cost ${index}` }],
  };
}

describe('native semantic purge one-pass mutation reads', () => {
  for (const size of [40, 4000]) {
    it(`decodes each retained source row once during publication at ${size} rows`, async () => {
      const history = new HistoryService({});
      history.setTokenizerFactory(exactTokenizer());
      try {
        await history.detachedValues.replace(
          (async function* () {
            for (let index = 0; index < size; index++) yield row(index);
          })(),
        );
        const session = new SemanticMediaPurgeSession({
          history,
          mode: () => 'remove',
          persist: async () => undefined,
        });
        const attempt = await session.begin(false);
        if (attempt === undefined) throw new Error('Missing cost attempt');
        let sourceRows = 0;
        let totalRows = 0;
        const rawRead = JournalDumpSnapshot.prototype.readRawRow;
        const versionRead = VersionSnapshot.prototype.readRow;
        const raw = spyOn(
          JournalDumpSnapshot.prototype,
          'readRawRow',
        ).mockImplementation(function (this: JournalDumpSnapshot, index) {
          sourceRows++;
          return rawRead.call(this, index);
        });
        const version = spyOn(
          VersionSnapshot.prototype,
          'readRow',
        ).mockImplementation(function (this: VersionSnapshot, entry) {
          totalRows++;
          return versionRead.call(this, entry);
        });
        try {
          expect(
            await attempt.complete({
              status: 'success',
              usage: undefined,
              retryHandoff: false,
            }),
          ).toBe(true);
          expect(sourceRows).toBe(size);
          expect(totalRows).toBeLessThanOrEqual(size + 1);
          process.stdout.write(
            `PURGE_MUTATION_READS ${JSON.stringify({ size, sourceRows, totalRows, excludes: 'construction, selection and persistence callback' })}\n`,
          );
        } finally {
          raw.mockRestore();
          version.mockRestore();
          await attempt.finalize();
        }
      } finally {
        await history.dispose();
      }
    });
  }
});
