/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { appendFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { collectJournalFileRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
import { useTempDir } from '../../../../core/src/journal/__tests__/support/useTempDir.js';
import { JournalSession } from '../../../../core/src/services/history/journalSession.js';
import { densityRow } from './density-disk-helpers.js';

describe('journal assertion reader', () => {
  const directory = useTempDir('journal-assertion-reader-');
  it('leaves an active writer tail intact while reading only committed rows', async () => {
    const path = join(directory(), 'active.llxj');
    const session = await JournalSession.create(path);
    const rows = [densityRow(0), densityRow(1)];
    try {
      await session.append(rows);
      await appendFile(path, new Uint8Array(128 * 1024));
      const before = await stat(path);
      await collectJournalFileRowsForAssertions(path, (actual) => {
        expect(actual).toStrictEqual(rows);
      });
      expect((await stat(path)).size).toBe(before.size);
    } finally {
      await session.close();
    }
  });
});
