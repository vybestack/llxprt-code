/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalResolver } from '../recording/journalResolver.js';
import type { IContent } from '../services/history/IContent.js';

type AssertRows = (rows: readonly IContent[]) => void | Promise<void>;

export async function collectRowsForAssertions(
  source: AsyncIterable<IContent>,
  assertRows: AssertRows,
): Promise<void> {
  const iterator = source[Symbol.asyncIterator]();
  const rows: IContent[] = [];
  try {
    for (;;) {
      const next = await iterator.next();
      if (next.done === true) break;
      rows.push(next.value);
    }
    await assertRows(rows);
  } finally {
    rows.length = 0;
    await iterator.return?.();
  }
}

async function* journalRowsForAssertions(history: {
  waitForCommit(): Promise<void>;
  journalPath(): string | null;
}): AsyncGenerator<IContent> {
  await history.waitForCommit();
  const path = history.journalPath();
  if (path === null) throw new Error('Expected a committed test journal');
  const resolver = await JournalResolver.open(path);
  try {
    for await (const entry of resolver.resolve()) yield entry.content;
  } finally {
    await resolver.close();
  }
}

export function collectJournalRowsForAssertions(
  history: {
    waitForCommit(): Promise<void>;
    journalPath(): string | null;
  },
  assertRows: AssertRows,
): Promise<void> {
  return collectRowsForAssertions(
    journalRowsForAssertions(history),
    assertRows,
  );
}
