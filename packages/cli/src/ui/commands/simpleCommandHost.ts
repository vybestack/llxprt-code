/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  SessionEndReason,
  SessionStartSource,
} from '@vybestack/llxprt-code-core';
import type { ClearSessionOperations } from './clearCommand.js';

export function bindClearSession(
  endSession:
    | ((
        reason: SessionEndReason,
      ) => ReturnType<ClearSessionOperations['endSession']>)
    | null,
  startNewSession: ClearSessionOperations['startNewSession'],
  startSession: (
    source: SessionStartSource,
  ) => ReturnType<ClearSessionOperations['startSession']>,
): ClearSessionOperations | null {
  if (endSession === null) return null;
  return {
    endSession: () => endSession(SessionEndReason.Clear),
    startNewSession,
    startSession: () => startSession(SessionStartSource.Clear),
  };
}
