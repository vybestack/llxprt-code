/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
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
