/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { DebugLogger } from '../../../../debug/index.js';
import { assertNormalizedOccurrences } from './normalized-occurrence-oracle.js';
import { collectUnits } from './normalization-oracle.js';
import { prepareProviderContentSnapshot } from '../../provider-curated-stream.js';
import { isCuratedContent } from '../../historyCuration.js';
import type { JournalSession } from '../../journalSession.js';
import type { IContent } from '../../IContent.js';

export async function assertPersistedOccurrences(
  session: JournalSession,
): Promise<void> {
  const rows: IContent[] = [];
  for await (const row of session.rows())
    if (isCuratedContent(row.content)) rows.push(row.content);
  async function* source(): AsyncGenerator<IContent> {
    yield* rows;
  }
  const old = await prepareProviderContentSnapshot(
    source(),
    [],
    new DebugLogger('persisted-occurrence-oracle'),
  );
  const snapshot = await session.store.snapshot();
  try {
    await assertNormalizedOccurrences(
      snapshot,
      await collectUnits(old.openReader()),
      rows,
    );
  } finally {
    old.close();
    await snapshot.close();
  }
}
