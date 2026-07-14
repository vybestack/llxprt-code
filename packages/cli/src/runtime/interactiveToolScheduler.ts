/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Interactive tool-scheduler construction, relocated out of the UI layer
 * (packages/cli/src/ui) so that no non-test file under cli/src/ui imports
 * `ToolSchedulerContract` or calls `getOrCreateScheduler`/`disposeScheduler`
 * (see #2376). The React state that renders tool-call progress still lives in
 * `useReactToolScheduler`; this module owns the core-scheduler primitives it
 * consumes via `SchedulerRefs` (a display-callback surface the hook supplies).
 *
 * Behavior is byte-for-byte identical to the previous in-hook implementation;
 * this is a mechanical relocation, not a redesign.
 */

import {
  type Config,
  type ToolCallRequestInfo,
  type CompletedToolCall,
  type OutputUpdateHandler,
  type ToolCallsUpdateHandler,
  type ToolCall,
  type EditorType,
  type SubagentSchedulerFactory,
  type ToolSchedulerContract,
  hasInteractiveSubagentScheduler,
  DEFAULT_AGENT_ID,
  type AnsiOutput,
  type MessageBus,
} from '@vybestack/llxprt-code-core';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import { useCallback, useEffect, useState } from 'react';
import type React from 'react';

/**
 * The explicit-message-bus getOrCreateScheduler shape the interactive path
 * relies on. The public `Config` type keeps `getOrCreateScheduler`
 * intentionally loose; this documents the exact scheduler surface we depend on
 * and is shared by both the main runtime access and the subagent config narrow.
 *
 * @plan:ISSUE-2376
 */
export interface ExplicitMessageBusScheduler {
  disposeScheduler(sessionId: string): void;
  getOrCreateScheduler(
    sessionId: string,
    callbacks: {
      outputUpdateHandler?: OutputUpdateHandler;
      onAllToolCallsComplete?: (
        calls: CompletedToolCall[],
      ) => Promise<void> | void;
      onToolCallsUpdate?: ToolCallsUpdateHandler;
      getPreferredEditor?: () => EditorType | undefined;
      onEditorClose?: () => void;
      onEditorOpen?: () => void;
    },
    options?: Record<string, unknown>,
    dependencies?: {
      messageBus?: MessageBus;
    },
  ): Promise<ToolSchedulerContract>;
  setInteractiveSubagentSchedulerFactory(
    factory: SubagentSchedulerFactory | undefined,
  ): void;
}

/**
 * A subagent's own `Config` narrowed to the explicit-message-bus scheduler
 * factory the interactive path relies on. Used only for the subagent scheduler
 * args (core's SubagentSchedulerFactory always supplies a Config).
 *
 * @plan:ISSUE-2376
 */
export type SchedulerConfigWithExplicitMessageBus = Config &
  ExplicitMessageBusScheduler;

/**
 * The scheduler sub-runtime (session + scheduler capabilities) this module
 * consumes. Introduced by #2384's CliUiRuntime split; structurally a
 * `Pick<StreamRuntime, 'scheduler' | 'session'>`. Declared locally so the
 * runtime layer does not depend on the UI layer's cliUiRuntime module while
 * remaining structurally compatible with the `ReactToolSchedulerRuntime` the
 * hook passes.
 *
 * @plan:ISSUE-2376
 */
export interface SchedulerRuntimeAccess {
  session: { getSessionId(): string };
  scheduler: ExplicitMessageBusScheduler;
}

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
  instance: ToolSchedulerContract,
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
    chunk: string | AnsiOutput,
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
): Parameters<
  SchedulerConfigWithExplicitMessageBus['getOrCreateScheduler']
>[1] {
  return {
    outputUpdateHandler: (toolCallId, chunk) => {
      if (!mounted.current) return;
      refs.updateToolCallOutput(mainSchedulerId, toolCallId, chunk);
      refs.setLastToolOutputTime(Date.now());
    },
    onAllToolCallsComplete: async (completedToolCalls) => {
      if (!mounted.current) return;
      if (completedToolCalls.length > 0) {
        await refs.onCompleteRef.current(mainSchedulerId, completedToolCalls, {
          isPrimary: true,
        });
      }
      refs.replaceToolCallsForScheduler(mainSchedulerId, []);
    },
    onToolCallsUpdate: (calls) => {
      if (!mounted.current) return;
      refs.replaceToolCallsForScheduler(mainSchedulerId, calls);
    },
    getPreferredEditor: () => refs.getPreferredEditorRef.current(),
    onEditorClose: () => refs.onEditorCloseRef.current(),
    onEditorOpen: () => refs.onEditorOpenRef.current(),
  };
}

/**
 * Creates callbacks for an external scheduler.
 */
function createSubagentCallbacks(
  schedulerId: symbol,
  refs: SchedulerRefs,
  args: Parameters<SubagentSchedulerFactory>[0],
): Parameters<
  SchedulerConfigWithExplicitMessageBus['getOrCreateScheduler']
>[1] {
  return {
    outputUpdateHandler: (toolCallId, chunk) => {
      refs.updateToolCallOutput(schedulerId, toolCallId, chunk);
      refs.setLastToolOutputTime(Date.now());
    },
    onToolCallsUpdate: (calls) => {
      refs.replaceToolCallsForScheduler(schedulerId, calls);
      args.onToolCallsUpdate?.(calls);
    },
    onAllToolCallsComplete: async (calls) => {
      if (calls.length > 0) {
        await refs.onCompleteRef.current(schedulerId, calls, {
          isPrimary: false,
        });
        await args.onAllToolCallsComplete(calls);
      }
      refs.replaceToolCallsForScheduler(schedulerId, []);
    },
    getPreferredEditor: () => refs.getPreferredEditorRef.current(),
    onEditorClose: () => refs.onEditorCloseRef.current(),
    onEditorOpen: () => refs.onEditorOpenRef.current(),
  };
}

/**
 * Initializes a scheduler instance.
 */
async function initializeSchedulerInstance(
  runtime: SchedulerRuntimeAccess,
  sessionId: string,
  mainSchedulerId: symbol,
  refs: SchedulerRefs,
  runtimeMessageBus: MessageBus | undefined,
  mounted: React.MutableRefObject<boolean>,
): Promise<ToolSchedulerContract | null> {
  try {
    const instance = await runtime.scheduler.getOrCreateScheduler(
      sessionId,
      createMainSchedulerCallbacks(mainSchedulerId, refs, mounted),
      undefined,
      { messageBus: runtimeMessageBus },
    );
    if (!mounted.current) {
      runtime.scheduler.disposeScheduler(sessionId);
      return null;
    }
    return instance;
  } catch (error) {
    logger.warn(
      () =>
        `Failed to initialize scheduler: ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
    return null;
  }
}

/**
 * Hook that manages scheduler initialization effect.
 */
function useSchedulerEffect(
  runtime: SchedulerRuntimeAccess,
  sessionId: string,
  mainSchedulerId: symbol,
  refs: SchedulerRefs,
  runtimeMessageBus: MessageBus | undefined,
  pendingScheduleRequests: React.MutableRefObject<PendingScheduleRequests>,
  setScheduler: (s: ToolSchedulerContract | null) => void,
): void {
  useEffect(() => {
    const mounted = { current: true };
    const resolved = { current: false };

    const init = async () => {
      const instance = await initializeSchedulerInstance(
        runtime,
        sessionId,
        mainSchedulerId,
        refs,
        runtimeMessageBus,
        mounted,
      );
      if (!mounted.current) return;
      if (!instance) {
        setScheduler(null);
        return;
      }
      resolved.current = true;
      processPendingRequests(instance, pendingScheduleRequests.current);
      pendingScheduleRequests.current = [];
      setScheduler(instance);
    };

    void init();

    return () => {
      mounted.current = false;
      if (resolved.current) {
        runtime.scheduler.disposeScheduler(sessionId);
      }
    };
  }, [
    runtime,
    sessionId,
    mainSchedulerId,
    refs,
    runtimeMessageBus,
    pendingScheduleRequests,
    setScheduler,
  ]);
}

/**
 * Hook that manages scheduler initialization.
 */
export function useScheduler(
  runtime: SchedulerRuntimeAccess,
  sessionId: string,
  mainSchedulerId: symbol,
  refs: SchedulerRefs,
  runtimeMessageBus: MessageBus | undefined,
  pendingScheduleRequests: React.MutableRefObject<PendingScheduleRequests>,
): InteractiveSchedulerHandle | null {
  const [scheduler, setScheduler] = useState<ToolSchedulerContract | null>(
    null,
  );
  useSchedulerEffect(
    runtime,
    sessionId,
    mainSchedulerId,
    refs,
    runtimeMessageBus,
    pendingScheduleRequests,
    setScheduler,
  );
  return scheduler;
}

/**
 * Hook that creates the external scheduler factory.
 */
function useExternalSchedulerFactoryCreator(
  refs: SchedulerRefs,
  runtimeMessageBus: MessageBus | undefined,
): SubagentSchedulerFactory {
  const factory = useCallback(
    async (args: Parameters<SubagentSchedulerFactory>[0]) => {
      const schedulerId = Symbol('subagent-scheduler');
      const schedulerSessionId = args.schedulerConfig.getSessionId();
      // args.schedulerConfig is the subagent's own Config (from core's
      // SubagentSchedulerFactory), not the interactive runtime; narrow it to the
      // explicit-message-bus getOrCreateScheduler shape the interactive path
      // depends on (the public Config type keeps it intentionally loose).
      const instance = await (
        args.schedulerConfig as SchedulerConfigWithExplicitMessageBus
      ).getOrCreateScheduler(
        schedulerSessionId,
        createSubagentCallbacks(schedulerId, refs, args),
        undefined,
        { messageBus: runtimeMessageBus },
      );
      return {
        schedule: (
          request: ToolCallRequestInfo | ToolCallRequestInfo[],
          signal: AbortSignal,
        ) => instance.schedule(request, signal),
        dispose: () =>
          args.schedulerConfig.disposeScheduler(schedulerSessionId),
      };
    },
    [refs, runtimeMessageBus],
  );
  return factory;
}

/**
 * Hook that manages external scheduler factory setup.
 */
function useExternalSchedulerSetup(
  runtime: SchedulerRuntimeAccess,
  createExternalScheduler: SubagentSchedulerFactory,
  setExternalSchedulerRegistered: (registered: boolean) => void,
): void {
  useEffect(() => {
    if (!hasInteractiveSubagentScheduler(runtime.scheduler)) {
      setExternalSchedulerRegistered(true);
      return () => setExternalSchedulerRegistered(false);
    }
    runtime.scheduler.setInteractiveSubagentSchedulerFactory(
      createExternalScheduler,
    );
    setExternalSchedulerRegistered(true);
    return () => {
      setExternalSchedulerRegistered(false);
      runtime.scheduler.setInteractiveSubagentSchedulerFactory(undefined);
    };
  }, [runtime, createExternalScheduler, setExternalSchedulerRegistered]);
}

/**
 * Composes external scheduler factory creation with its registration effect.
 */
export function useExternalSchedulerRegistration(
  runtime: SchedulerRuntimeAccess,
  refs: SchedulerRefs,
  runtimeMessageBus: MessageBus | undefined,
  setExternalSchedulerRegistered: (registered: boolean) => void,
): void {
  const createExternalScheduler = useExternalSchedulerFactoryCreator(
    refs,
    runtimeMessageBus,
  );
  useExternalSchedulerSetup(
    runtime,
    createExternalScheduler,
    setExternalSchedulerRegistered,
  );
}
