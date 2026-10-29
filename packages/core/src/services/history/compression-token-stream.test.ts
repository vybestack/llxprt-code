/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { join } from 'node:path';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { DebugLogger } from '../../debug/DebugLogger.js';
import { JournalSession } from './journalSession.js';
import { JournalDumpSnapshot } from './journalDumpSnapshot.js';
import { estimateTokensForContents } from './historyTokenEstimation.js';
import { compressionTokenSelection } from './compression-token-selection.js';
import type { IContent } from './IContent.js';

const provider = {
  getTokenizerForModel: () => ({
    countTokens: (text: unknown) => String(text).length,
  }),
};
const logger = new DebugLogger('compression-token-stream');
const rows: IContent[] = [
  { speaker: 'human', blocks: [{ type: 'text', text: '雪 '.repeat(50000) }] },
  { speaker: 'ai', blocks: [{ type: 'text', text: 'answer '.repeat(50000) }] },
  { speaker: 'human', blocks: [{ type: 'text', text: 'follow-up' }] },
];

describe('compression token selections', () => {
  const directory = useTempDir('compression-token-stream-');

  it('counts a pinned disk selection and individual rows without hydrating rows', async () => {
    const session = await JournalSession.create(
      join(directory(), 'session.llxj'),
    );
    try {
      await session.append(rows);
      const snapshot = await session.store.snapshot();
      const dump = new JournalDumpSnapshot(snapshot);
      try {
        spyOn(snapshot, 'readRow').mockImplementation(() => {
          throw new Error('whole row hydration');
        });
        spyOn(snapshot, 'readBlock').mockImplementation(() => {
          throw new Error('whole block read');
        });
        expect(
          await estimateTokensForContents(dump, 'custom', provider, logger),
        ).toBe(
          await estimateTokensForContents(rows, 'custom', provider, logger),
        );
        expect(
          await estimateTokensForContents(
            compressionTokenSelection(dump, 1, 2),
            'custom',
            provider,
            logger,
          ),
        ).toBe(
          await estimateTokensForContents(
            rows.slice(1, 2),
            'custom',
            provider,
            logger,
          ),
        );
      } finally {
        await dump.close();
      }
    } finally {
      await session.close();
    }
  });
});
