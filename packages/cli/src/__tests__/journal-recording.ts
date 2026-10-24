/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  IContent,
  SessionRecordingPort,
} from '@vybestack/llxprt-code-core';
import { recordRowsForTest } from '@vybestack/llxprt-code-test-utils/core/recorder-for-test.js';
import { requireJournalRecorder } from '@vybestack/llxprt-code-core/services/history/recorderBackend.js';
import { previewOfContent } from '@vybestack/llxprt-code-core/recording/sessionMetaKeys.js';
import { openJournalReadOnly } from '@vybestack/llxprt-code-core/journal/journalReader.js';
import { stateReaderOf } from '@vybestack/llxprt-code-core/journal/journalReaderState.js';
import { sha256KeyHash } from '@vybestack/llxprt-code-core/journal/idKeys.js';
import {
  iterateRowEntries,
  rowTreeRootOf,
} from '@vybestack/llxprt-code-core/journal/rowTreeReader.js';
import { readStoredRow } from '@vybestack/llxprt-code-core/journal/rowReads.js';
import { decodeStoredRow } from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';
import {
  readSessionFacts,
  type SessionFacts,
} from '@vybestack/llxprt-code-core/recording/sessionMetaKeys.js';

export async function readRecordedFacts(
  filePath: string,
): Promise<SessionFacts> {
  const reader = await openJournalReadOnly(filePath);
  try {
    const facts = await readSessionFacts(stateReaderOf(reader, sha256KeyHash));
    if (facts === undefined) throw new Error('Recording has no session facts');
    return facts;
  } finally {
    await reader.close();
  }
}

export async function* streamRecordedRows(
  filePath: string,
): AsyncGenerator<IContent, void, unknown> {
  const reader = await openJournalReadOnly(filePath);
  try {
    const root = rowTreeRootOf(reader.trailer);
    if (root !== undefined)
      for await (const entry of iterateRowEntries(reader, root))
        yield decodeStoredRow(await readStoredRow(reader, entry));
  } finally {
    await reader.close();
  }
}

export async function readRecordedRows(filePath: string): Promise<IContent[]> {
  const rows: IContent[] = [];
  for await (const row of streamRecordedRows(filePath)) rows.push(row);
  return rows;
}

export async function seedSessionRows(
  recording: SessionRecordingPort,
  rows: readonly IContent[],
): Promise<void> {
  await recordRowsForTest(recording, rows);
  const recorder = requireJournalRecorder(recording);
  for (const row of rows) {
    const preview = previewOfContent(row);
    if (preview !== undefined) recorder.recordFirstUserPreview(preview);
  }
  await recorder.flush();
}
