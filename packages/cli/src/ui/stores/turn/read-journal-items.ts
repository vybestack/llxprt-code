/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { HistoryItem } from '../../types.js';
import { NativeJournalCursor } from './native-journal-cursor.js';

export async function readJournalItems(
  agent: Agent,
  count = 64,
  activeOnly = false,
): Promise<HistoryItem[]> {
  const history = agent.agentClient.getHistoryService();
  if (history === null) throw new Error('Missing test journal history');
  await history.waitForCommit();
  const path = history.journalPath();
  if (path === null) return [];
  const cursor = await NativeJournalCursor.open(path, {}, count);
  try {
    const page = await cursor.pageBack(count);
    return page.entries
      .flatMap((entry) =>
        entry.kind === 'projected' &&
        (!activeOnly || entry.contextState === 'in-context')
          ? [entry.item]
          : [],
      )
      .reverse();
  } finally {
    await cursor.close();
  }
}
