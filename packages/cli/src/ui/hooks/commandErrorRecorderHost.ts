/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SessionRecordingEvent } from '@vybestack/llxprt-code-agents';
import type { RecordingIntegration } from '@vybestack/llxprt-code-core';

export function bindCommandErrorRecorder(
  recordEvent: ((event: SessionRecordingEvent) => Promise<void>) | null,
  recordingOwner: 'agent' | 'raw' | undefined,
  rawRecording: Pick<RecordingIntegration, 'recordSessionEvent'> | undefined,
): (message: string) => Promise<void> {
  if (recordingOwner === 'agent') {
    return async (message) => {
      if (recordEvent === null) throw new Error('Session agent is unavailable');
      await recordEvent({
        type: 'session_event',
        severity: 'error',
        message,
        presentation: 'already-appended',
      });
    };
  }
  return async (message) => {
    rawRecording?.recordSessionEvent('error', message);
  };
}
