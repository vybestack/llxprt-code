/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  IContent,
  SessionRecordingPort,
} from '@vybestack/llxprt-code-core';
import { recordRowsForTest } from '@vybestack/llxprt-code-test-utils/core/recorder-for-test.js';
import { requireJournalRecorder } from '@vybestack/llxprt-code-core/services/history/recorderBackend.js';
import { previewOfContent } from '@vybestack/llxprt-code-core/recording/sessionMetaKeys.js';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import {
  readSessionFacts,
  type SessionFacts,
} from '@vybestack/llxprt-code-core/recording/sessionMetaKeys.js';

export async function readRecordedFacts(
  filePath: string,
): Promise<SessionFacts> {
  const session = await JournalSession.open(filePath);
  try {
    const facts = await readSessionFacts((key) => session.store.getState(key));
    if (facts === undefined) throw new Error('Recording has no session facts');
    return facts;
  } finally {
    await session.close();
  }
}

export async function readRecordedRows(filePath: string): Promise<IContent[]> {
  const session = await JournalSession.open(filePath);
  try {
    const rows: IContent[] = [];
    for await (const row of session.rows()) rows.push(row.content);
    return rows;
  } finally {
    await session.close();
  }
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
