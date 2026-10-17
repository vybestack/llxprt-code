/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { randomUUID } from 'node:crypto';
import { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import type { RecordingPort } from '../../recording/recordingPort.js';
import { createScratchDirSync } from '../../storage/scratch-root.js';

/** The private recorder, and its directory, of a history that was given none. */
export function createScratchRecorder(): {
  readonly recorder: RecordingPort;
  readonly directory: string;
} {
  const directory = createScratchDirSync('llxprt-history-');
  const recorder = new SessionRecordingService({
    sessionId: `history-${randomUUID()}`,
    projectHash: 'llxprt-history-service',
    chatsDir: directory,
    workspaceDirs: [directory],
    provider: 'history-service',
    model: 'local',
  });
  return { recorder, directory };
}
