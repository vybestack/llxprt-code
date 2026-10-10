/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SessionHookOwner } from '@vybestack/llxprt-code-core/hooks/session-hook-owner.js';
import type { AgentChatRecordingExecution } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { SessionControl } from './control/sessionControl.js';

export function currentRecordingPath(
  session: SessionControl,
): string | undefined {
  const recording = session.getRecording();
  return recording.enabled ? recording.path : undefined;
}

export function createRecordingExecution(
  session: SessionControl,
  sessionId: () => string,
  hooks?: Pick<SessionHookOwner, 'execution'>,
): AgentChatRecordingExecution {
  const identity = {
    sessionId,
    transcriptPath: () => currentRecordingPath(session),
  };
  return {
    historyOrigin: session,
    hookOwner: hooks?.execution(identity) ?? identity,
    transcriptPath: () => currentRecordingPath(session),
    persistSemanticMediaPurge: (history, frontier) =>
      session.persistSemanticMediaPurge(history, frontier),
  };
}

export function createCompressionRecordingOptions(
  session: SessionControl,
  sessionId: () => string,
  hooks?: Pick<SessionHookOwner, 'execution'>,
): {
  transcriptPathProvider: () => string | undefined;
  historyOrigin: AgentChatRecordingExecution['historyOrigin'];
  hookOwner: AgentChatRecordingExecution['hookOwner'];
} {
  const execution = createRecordingExecution(session, sessionId, hooks);
  return {
    transcriptPathProvider: execution.transcriptPath,
    historyOrigin: execution.historyOrigin,
    hookOwner: execution.hookOwner,
  };
}
