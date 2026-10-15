/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { RecordingIntegration } from '@vybestack/llxprt-code-core';

export function bindCommandErrorRecorder(
  agent: Agent | null,
  recordingOwner: 'agent' | 'raw' | undefined,
  rawRecording: Pick<RecordingIntegration, 'recordSessionEvent'> | undefined,
): (message: string) => Promise<void> {
  if (recordingOwner === 'agent') {
    const session = agent?.session;
    return async (message) => {
      if (!session) throw new Error('Session agent is unavailable');
      await session.recordRecordingEvent({
        type: 'session_event',
        severity: 'error',
        message,
      });
    };
  }
  return async (message) => {
    rawRecording?.recordSessionEvent('error', message);
  };
}
