/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type ToolCallRequestInfo,
  type CompletedToolCall,
  type ToolCall,
  type EditorType,
  DEFAULT_AGENT_ID,
  type LiveOutputUpdate,
} from '@vybestack/llxprt-code-core';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import { useEffect, useState } from 'react';
import type {
  Agent,
  AgentDisplayCallbacks,
} from '@vybestack/llxprt-code-agents';
import type React from 'react';

const logger = DebugLogger.getLogger('llxprt:cli:interactive-tool-scheduler');

/**
 * The narrow scheduler surface the renderer hook consumes. Exposing only
 * `schedule`/`cancelAll` keeps `ToolSchedulerContract` (a core primitive) out
 * of the UI layer while preserving the exact runtime behavior (see #2376).
 * `useScheduler` returns a value assignable to this handle.
 */
export interface InteractiveSchedulerHandle {
  schedule(
    request: ToolCallRequestInfo | ToolCallRequestInfo[],
    signal: AbortSignal,
  ): Promise<void>;
  cancelAll(): void;
}

export type PendingScheduleRequests = Array<{
  request: ToolCallRequestInfo | ToolCallRequestInfo[];
  signal: AbortSignal;
}>;

/**
 * Ensures a request has an agentId, defaulting to DEFAULT_AGENT_ID.
 */
function ensureAgentId(req: ToolCallRequestInfo): ToolCallRequestInfo {
  return { ...req, agentId: req.agentId ?? DEFAULT_AGENT_ID };
}

/**
 * Normalizes a request to ensure all requests have agentId.
 */
export function normalizeRequest(
  request: ToolCallRequestInfo | ToolCallRequestInfo[],
): ToolCallRequestInfo | ToolCallRequestInfo[] {
  return Array.isArray(request)
    ? request.map(ensureAgentId)
    : ensureAgentId(request);
}

/**
 * Processes pending schedule requests after scheduler initialization.
 */
function processPendingRequests(
  instance: InteractiveSchedulerHandle,
  requests: PendingScheduleRequests,
): void {
  for (const { request, signal } of requests) {
    if (signal.aborted) continue;
    instance.schedule(request, signal).catch(() => {});
  }
}

/** Shared refs type for scheduler callbacks. Supplied by the renderer hook. */
export type SchedulerRefs = {
  updateToolCallOutput: (
    schedulerId: symbol,
    toolCallId: string,
    update: LiveOutputUpdate,
  ) => void;
  replaceToolCallsForScheduler: (
    schedulerId: symbol,
    calls: ToolCall[],
  ) => void;
  onCompleteRef: React.MutableRefObject<
    (
      schedulerId: symbol,
      tools: CompletedToolCall[],
      options: { isPrimary: boolean },
    ) => Promise<void> | void
  >;
  getPreferredEditorRef: React.MutableRefObject<() => EditorType | undefined>;
  onEditorCloseRef: React.MutableRefObject<() => void>;
  onEditorOpenRef: React.MutableRefObject<() => void>;
  setLastToolOutputTime: (time: number) => void;
};

/**
 * Creates callbacks for the main scheduler.
 */
function createMainSchedulerCallbacks(
  mainSchedulerId: symbol,
  refs: SchedulerRefs,
  mounted: React.MutableRefObject<boolean>,
): AgentDisplayCallbacks {
  const isMounted = (): boolean => mounted.current;
  return {
    outputUpdateHandler: (toolCallId, update) => {
      if (!isMounted()) return;
      refs.updateToolCallOutput(mainSchedulerId, toolCallId, update);
      refs.setLastToolOutputTime(Date.now());
    },
    onAllToolCallsComplete: async (completedToolCalls) => {
      if (!isMounted()) return;
      if (completedToolCalls.length > 0) {
        await refs.onCompleteRef.current(mainSchedulerId, completedToolCalls, {
          isPrimary: true,
        });
      }
      if (mounted.current)
        refs.replaceToolCallsForScheduler(mainSchedulerId, []);
    },
    onToolCallsUpdate: (calls) => {
      if (!isMounted()) return;
      refs.replaceToolCallsForScheduler(mainSchedulerId, calls);
    },
  };
}

export function useScheduler(
  agent: Agent,
  mainSchedulerId: symbol,
  refs: SchedulerRefs,
  pendingScheduleRequests: React.MutableRefObject<PendingScheduleRequests>,
): InteractiveSchedulerHandle | null {
  const [scheduler, setScheduler] = useState<InteractiveSchedulerHandle | null>(
    null,
  );
  useEffect(() => {
    const mounted = { current: true };
    const channel = agent.tools.openClientChannel();
    const detach = channel.subscribe(
      createMainSchedulerCallbacks(mainSchedulerId, refs, mounted),
    );
    void channel.ready
      .then(() => {
        if (!mounted.current) return;
        processPendingRequests(channel, pendingScheduleRequests.current);
        pendingScheduleRequests.current = [];
        setScheduler(channel);
      })
      .catch((error: unknown) => {
        if (mounted.current)
          logger.warn(
            () => `Failed to initialize client tools: ${String(error)}`,
          );
      });
    return () => {
      mounted.current = false;
      detach();
      pendingScheduleRequests.current = [];
      void channel.release().catch((error: unknown) => {
        logger.warn(() => `Failed to release client tools: ${String(error)}`);
      });
    };
  }, [agent, mainSchedulerId, refs, pendingScheduleRequests]);
  return scheduler;
}

export function useChildToolDisplay(
  agent: Agent,
  refs: SchedulerRefs,
  setReady: (ready: boolean) => void,
): void {
  useEffect(() => {
    const mounted = { current: true };
    const isMounted = (): boolean => mounted.current;
    const detach = agent.tools.subscribeChildTools({
      outputUpdateHandler: (id, callId, update) => {
        if (!isMounted()) return;
        refs.updateToolCallOutput(id, callId, update);
        refs.setLastToolOutputTime(Date.now());
      },
      onToolCallsUpdate: (id, calls) => {
        if (mounted.current) refs.replaceToolCallsForScheduler(id, calls);
      },
      onAllToolCallsComplete: async (id, calls) => {
        if (!isMounted()) return;
        if (calls.length > 0)
          await refs.onCompleteRef.current(id, calls, { isPrimary: false });
        if (mounted.current) refs.replaceToolCallsForScheduler(id, []);
      },
    });
    setReady(true);
    return () => {
      mounted.current = false;
      detach();
      setReady(false);
    };
  }, [agent, refs, setReady]);
}
