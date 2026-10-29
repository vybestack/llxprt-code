/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { DebugLogger } from '../../../../debug/index.js';
import { assertNormalizedOccurrences } from './normalized-occurrence-oracle.js';
import { buildProviderContent } from '../../historyProviderPipeline.js';
import { isCuratedContent } from '../../historyCuration.js';
import type { JournalSession } from '../../journalSession.js';
import type { IContent } from '../../IContent.js';

export async function assertPersistedOccurrences(
  session: JournalSession,
): Promise<void> {
  const rows: IContent[] = [];
  for await (const row of session.rows())
    if (isCuratedContent(row.content)) rows.push(row.content);
  const expected = buildProviderContent(
    rows,
    [],
    new DebugLogger('persisted-occurrence-oracle'),
  );
  const snapshot = await session.store.snapshot();
  try {
    await assertNormalizedOccurrences(snapshot, expected, rows);
  } finally {
    await snapshot.close();
  }
}
