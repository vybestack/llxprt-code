/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { HistoryItem } from '../../types.js';
import { NativeJournalCursor } from './native-journal-cursor.js';

export async function readJournalItems(
  agent: Agent,
  count = 64,
  activeOnly = false,
): Promise<HistoryItem[]> {
  await agent.session.flushRecording();
  const path = agent.session.getRecording().path;
  if (path === undefined) return [];
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
