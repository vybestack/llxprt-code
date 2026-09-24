/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { RecordingPort } from '@vybestack/llxprt-code-core/session/sessionExecutionServices.js';
import { SemanticMediaPurgeSession } from './semanticMediaPurgeSession.js';

export function createSemanticMediaPurgeSession(
  runtimeContext: AgentRuntimeContext,
  history: HistoryService,
  readRecording: () => RecordingPort | undefined,
): SemanticMediaPurgeSession {
  return new SemanticMediaPurgeSession({
    history,
    mode: () => runtimeContext.ephemerals.semanticMediaPurge(),
    persist: async (candidateHistory, frontier) => {
      const recording = readRecording();
      if (recording?.isActive() !== true) {
        throw new Error(
          'Semantic media purge requires an active session recording',
        );
      }
      recording.recordSemanticMediaPurge(candidateHistory, frontier);
      await recording.flush();
      if (!recording.isActive()) {
        throw new Error('Semantic media purge recording did not remain active');
      }
    },
  });
}
