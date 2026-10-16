/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useCallback, useMemo } from 'react';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { RecordingIntegration } from '@vybestack/llxprt-code-core';
import {
  resolveContentPrefixIdentity,
  createCliModelIdentityRuntime,
} from '../../utils/modelIdentity.js';

function defaultGetContentPrefixIdentity(
  identity: Parameters<typeof createCliModelIdentityRuntime>[0],
): string | null {
  try {
    return resolveContentPrefixIdentity(
      createCliModelIdentityRuntime(identity),
    );
  } catch {
    return null;
  }
}

export function useCancelRunningSubagents(
  tasks: Pick<Agent['tasks'], 'listRunning' | 'cancel'>,
): () => void {
  return useCallback(() => {
    for (const task of tasks.listRunning()) {
      if (task.kind === 'subagent') void tasks.cancel(task.id);
    }
  }, [tasks]);
}

export function useContentIdentityReader(
  identity: Parameters<typeof createCliModelIdentityRuntime>[0],
): () => string | null {
  return useCallback(
    () => defaultGetContentPrefixIdentity(identity),
    [identity],
  );
}

export function useTurnFlush(
  session: Pick<Agent['session'], 'flushRecording'>,
  recordingOwner: 'agent' | 'raw' | undefined,
  recordingIntegration:
    | Pick<RecordingIntegration, 'flushAtTurnBoundary'>
    | undefined,
): () => Promise<void> {
  return useCallback(async () => {
    if (recordingOwner === 'agent') {
      await session.flushRecording();
      return;
    }
    try {
      await recordingIntegration?.flushAtTurnBoundary();
    } catch {
      /* non-fatal */
    }
  }, [session, recordingOwner, recordingIntegration]);
}

export function useBound<Owner, Args extends unknown[], Result>(
  owner: Owner,
  operation: (this: Owner, ...args: Args) => Result,
): (...args: Args) => Result {
  return useMemo(() => operation.bind(owner), [owner, operation]);
}
