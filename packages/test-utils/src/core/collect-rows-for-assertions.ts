/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalResolver } from '@vybestack/llxprt-code-core/recording/journalResolver.js';
import { isJournalFileName } from '@vybestack/llxprt-code-core/recording/sessionFileExtension.js';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { selectBackend } from '@vybestack/llxprt-code-core/services/history/historyBackendSelect.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

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

interface CommittedHistory {
  waitForCommit(): Promise<void>;
  journalPath(): string | null;
  streamRawHistory(): AsyncIterable<IContent>;
}

/**
 * The rows the recorder's file holds once everything is durable, read apart
 * from the history service: the old backend's JSONL file through the resolver,
 * the journal backend's file through the journal store. A journal history with
 * no recorder keeps its rows in an unlinked file that has no path, so the
 * service's own committed rows are the only way to read them.
 */
async function* journalRowsForAssertions(
  history: CommittedHistory,
): AsyncGenerator<IContent> {
  await history.waitForCommit();
  const path = history.journalPath();
  if (path === null) {
    if (selectBackend() !== 'journal')
      throw new Error('Expected a committed test journal');
    yield* history.streamRawHistory();
    return;
  }
  if (isJournalFileName(path)) {
    yield* journalFileRows(path);
    return;
  }
  const resolver = await JournalResolver.open(path);
  try {
    for await (const entry of resolver.resolve()) yield entry.content;
  } finally {
    await resolver.close();
  }
}

export function collectJournalRowsForAssertions(
  history: CommittedHistory,
  assertRows: AssertRows,
): Promise<void> {
  return collectRowsForAssertions(
    journalRowsForAssertions(history),
    assertRows,
  );
}

async function* journalFileRows(path: string): AsyncGenerator<IContent> {
  const session = await JournalSession.open(path);
  try {
    for await (const { content } of session.rows()) yield content;
  } finally {
    await session.close();
  }
}

/**
 * The live rows of the journal file at `path`, read one at a time through the
 * store (`JournalStore.rows()` and the row codec) and handed to `assertRows`.
 * Unlike {@link collectJournalRowsForAssertions} it knows nothing of a
 * history service: the caller has already made the file durable.
 */
export function collectJournalFileRowsForAssertions(
  path: string,
  assertRows: AssertRows,
): Promise<void> {
  return collectRowsForAssertions(journalFileRows(path), assertRows);
}
