/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  ContinueTarget,
  SessionSummary,
} from '@vybestack/llxprt-code-core';
import type {
  EnrichedSessionSummary,
  PreviewState,
} from './useSessionBrowser.js';

export function buildEnrichedSession(
  target: ContinueTarget,
  source: SessionSummary,
  locked: boolean,
  cached: { text: string | null; state: PreviewState } | undefined,
): EnrichedSessionSummary {
  return {
    ...source,
    target,
    targetKey:
      target.kind === 'session'
        ? `session:${target.session.sessionId}`
        : `checkpoint:${target.checkpointId}`,
    ...(target.kind === 'checkpoint'
      ? { checkpointName: target.checkpointName }
      : {}),
    isLocked: locked,
    previewState: cached ? cached.state : 'loading',
    firstUserMessage: cached?.text ?? undefined,
  };
}
