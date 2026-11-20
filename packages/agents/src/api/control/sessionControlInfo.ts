/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type SessionSummary } from '@vybestack/llxprt-code-core';
import {
  readRecordingMetadata,
  type RecordingMetadata,
} from './recordingMetadata.js';
import type { SessionInfo } from '../agent.js';

export function sessionInfoFromReplay(
  id: string,
  replay: RecordingMetadata,
  modifiedAt: string,
): SessionInfo {
  return {
    id,
    name: replay.sessionName ?? null,
    title: replay.metadata.title,
    createdAt: replay.metadata.startTime,
    modifiedAt,
    ...(replay.ancestry === undefined
      ? {}
      : {
          parentSessionId: replay.ancestry.parentSessionId,
          parentSequence: replay.ancestry.parentSequence,
          checkpointId: replay.ancestry.checkpointId,
          checkpointName: replay.ancestry.checkpointName,
        }),
  };
}

export async function readSessionInfo(
  summary: SessionSummary,
  projectHash: string,
): Promise<SessionInfo> {
  const replay = await readRecordingMetadata(summary.filePath, projectHash);
  return sessionInfoFromReplay(
    summary.sessionId,
    replay,
    summary.lastModified.toISOString(),
  );
}
