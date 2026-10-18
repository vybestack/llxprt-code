/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalRecordingService } from '@vybestack/llxprt-code-core/recording/journalRecordingService.js';
import { SessionRecordingService } from '@vybestack/llxprt-code-core/recording/SessionRecordingService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { SessionRecordingPort } from '@vybestack/llxprt-code-core/recording/recordingPort.js';
import { createSessionRecorder } from '@vybestack/llxprt-code-core/recording/sessionRecorderFactory.js';
import type { SessionRecordingServiceConfig } from '@vybestack/llxprt-code-core/recording/types.js';

export type RecorderTestConfig = Partial<SessionRecordingServiceConfig> &
  Pick<SessionRecordingServiceConfig, 'chatsDir'>;

/**
 * A session recorder of the backend `LLXPRT_HISTORY_BACKEND` selects, built
 * through the production factory, for fixtures that do not test the recorder's
 * file layout. Only `chatsDir` is required; the rest of the config defaults to
 * values that identify a test session.
 */
export function createRecorderForTest(
  config: RecorderTestConfig,
  env: Readonly<Record<string, string | undefined>> = process.env,
): SessionRecordingPort {
  return createSessionRecorder(
    {
      sessionId: 'test-session',
      projectHash: 'test-project',
      workspaceDirs: [config.chatsDir],
      provider: 'test',
      model: 'test',
      ...config,
    },
    env,
  );
}

/**
 * Writes seed rows into the session of a recorder built by
 * {@link createRecorderForTest}, the way that recorder's backend takes rows
 * from a history. The caller flushes and disposes the recorder.
 */
export async function recordRowsForTest(
  recorder: SessionRecordingPort,
  rows: readonly IContent[],
): Promise<void> {
  if (recorder instanceof JournalRecordingService) {
    await (await recorder.session()).append(rows);
    return;
  }
  if (recorder instanceof SessionRecordingService) {
    for (const row of rows) recorder.recordContent(row);
    return;
  }
  throw new Error('recordRowsForTest needs a recorder from the factory');
}
