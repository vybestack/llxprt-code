/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Agent } from '@vybestack/llxprt-code-agents';
import {
  SessionEndReason,
  SessionStartSource,
} from '@vybestack/llxprt-code-core';
import type { ClearSessionOperations } from './clearCommand.js';

export function bindClearSession(
  agent: Agent | null,
): ClearSessionOperations | null {
  if (agent === null) return null;
  return {
    endSession: () => agent.hooks.triggerSessionEnd(SessionEndReason.Clear),
    startNewSession: () => agent.session.startNewSession(),
    startSession: () =>
      agent.hooks.triggerSessionStart(SessionStartSource.Clear),
  };
}
