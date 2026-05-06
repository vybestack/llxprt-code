/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type Config,
  type ToolCallRequestInfo,
  type ExecutingToolCall,
  type ScheduledToolCall,
  type ValidatingToolCall,
  type WaitingToolCall,
  type CompletedToolCall,
  type CancelledToolCall,
  type CoreToolScheduler,
  type OutputUpdateHandler,
  type ToolCallsUpdateHandler,
  type ToolCall,
  type EditorType,
  DEFAULT_AGENT_ID,
  DebugLogger,
  type AnsiOutput,
  type MessageBus,
} from '@vybestack/llxprt-code-core';
import { useCallback, useState, useMemo, useEffect, useRef } from 'react';
import type { HistoryItemWithoutId } from '../types.js';
import { ToolCallStatus } from '../types.js';

type ExternalSchedulerFactory = (args: {
  schedulerConfig: Config;
  onAllToolCallsComplete: (calls: CompletedToolCall[]) => Promise<void>;
  outputUpdateHandler: OutputUpdateHandler;
  onToolCallsUpdate?: ToolCallsUpdateHandler;
}) => {
  schedule(
    request: ToolCallRequestInfo | ToolCallRequestInfo[],
    signal: AbortSignal,
  ): Promise<void> | void;
};

type SchedulerConfigWithExplicitMessageBus = Config & {
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
  ): Promise<CoreToolScheduler>;
};

const logger = DebugLogger.getLogger('llxprt:cli:react-tool-scheduler');

export type ScheduleFn = (
  request: ToolCallRequestInfo | ToolCallRequestInfo[],
  signal: AbortSignal,
) => Promise<void>;
export type MarkToolsAsSubmittedFn = (callIds: string[]) => void;

export type TrackedScheduledToolCall = ScheduledToolCall & {
  responseSubmittedToGemini?: boolean;
};
export type TrackedValidatingToolCall = ValidatingToolCall & {
  responseSubmittedToGemini?: boolean;
};
export type TrackedWaitingToolCall = WaitingToolCall & {
  responseSubmittedToGemini?: boolean;
};
export type TrackedExecutingToolCall = ExecutingToolCall & {
  responseSubmittedToGemini?: boolean;
};
export type TrackedCompletedToolCall = CompletedToolCall & {
  responseSubmittedToGemini?: boolean;
};
export type TrackedCancelledToolCall = CancelledToolCall & {
  responseSubmittedToGemini?: boolean;
};

export type TrackedToolCall =
  | TrackedScheduledToolCall
  | TrackedValidatingToolCall
  | TrackedWaitingToolCall
  | TrackedExecutingToolCall
  | TrackedCompletedToolCall
  | TrackedCancelledToolCall;

export type CancelAllFn = () => void;

/**
 * Ensures a request has an agentId, defaulting to DEFAULT_AGENT_ID.
 */
function ensureAgentId(req: ToolCallRequestInfo): ToolCallRequestInfo {
  return { ...req, agentId: req.agentId ?? DEFAULT_AGENT_ID };
}

/**
 * Normalizes a request to ensure all requests have agentId.
 */
function normalizeRequest(
  request: ToolCallRequestInfo | ToolCallRequestInfo[],
): ToolCallRequestInfo | ToolCallRequestInfo[] {
  return Array.isArray(request)
    ? request.map(ensureAgentId)
    : ensureAgentId(request);
}

/**
 * Updates a pending history item with output for a specific tool call.
 */
function updatePendingItemWithOutput(
  prevItem: HistoryItemWithoutId | null,
  toolCallId: string,
  outputChunk: string | AnsiOutput,
): HistoryItemWithoutId | null {
  if (prevItem?.type !== 'tool_group') return prevItem;
  return {
    ...prevItem,
    tools: prevItem.tools.map((toolDisplay) =>
      toolDisplay.callId === toolCallId &&
      toolDisplay.status === ToolCallStatus.Executing
        ? { ...toolDisplay, resultDisplay: outputChunk }
        : toolDisplay,
    ),
  };
}

/**
 * Maps updated calls preserving the responseSubmittedToGemini flag.
 */
function mapCallsWithSubmittedFlag(
  prevCalls: TrackedToolCall[],
  updatedCalls: ToolCall[],
): TrackedToolCall[] {
  if (updatedCalls.length === 0) return [];
  const previousCallMap = new Map(
    prevCalls.map((call) => [call.request.callId, call]),
  );
  return updatedCalls.map((call) => ({
    ...call,
    responseSubmittedToGemini:
      previousCallMap.get(call.request.callId)?.responseSubmittedToGemini ??
      false,
  })) as TrackedToolCall[];
}

/**
 * Updates tool calls with live output for a specific tool call.
 */
function updateCallsWithLiveOutput(
  prevCalls: TrackedToolCall[],
  toolCallId: string,
  outputChunk: string | AnsiOutput,
): TrackedToolCall[] {
  return prevCalls.map((call) =>
    call.request.callId === toolCallId && call.status === 'executing'
      ? { ...call, liveOutput: outputChunk }
      : call,
  );
}

/**
 * Updates scheduler state with new calls, handling empty arrays.
 */
function updateSchedulerState(
  prev: Map<symbol, TrackedToolCall[]>,
  schedulerId: symbol,
  updatedCalls: TrackedToolCall[] | null,
): Map<symbol, TrackedToolCall[]> {
  if (updatedCalls === null || updatedCalls.length === 0) {
    if (prev.has(schedulerId)) {
      const next = new Map(prev);
      next.delete(schedulerId);
      return next;
    }
    return prev;
  }
  const next = new Map(prev);
  next.set(schedulerId, updatedCalls);
  return next;
}

/**
 * Marks tool calls as submitted to Gemini.
 */
function markCallsAsSubmitted(
  calls: TrackedToolCall[],
  callIdsToMark: string[],
): TrackedToolCall[] {
  return calls.map((call) =>
    callIdsToMark.includes(call.request.callId)
      ? { ...call, responseSubmittedToGemini: true }
      : call,
  );
}

/**
 * Processes pending schedule requests after scheduler initialization.
 */
function processPendingRequests(
  instance: CoreToolScheduler,
  requests: Array<{
    request: ToolCallRequestInfo | ToolCallRequestInfo[];
    signal: AbortSignal;
  }>,
): void {
  for (const { request, signal } of requests) {
    if (signal.aborted) continue;
    instance.schedule(request, signal).catch(() => {});
  }
}

/** Shared refs type for scheduler callbacks */
type SchedulerRefs = {
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
  args: Parameters<ExternalSchedulerFactory>[0],
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
  config: Config,
  sessionId: string,
  mainSchedulerId: symbol,
  refs: SchedulerRefs,
  runtimeMessageBus: MessageBus | undefined,
  mounted: React.MutableRefObject<boolean>,
): Promise<CoreToolScheduler | null> {
  try {
    const instance = await (
      config as SchedulerConfigWithExplicitMessageBus
    ).getOrCreateScheduler(
      sessionId,
      createMainSchedulerCallbacks(mainSchedulerId, refs, mounted),
      undefined,
      { messageBus: runtimeMessageBus },
    );
    if (!mounted.current) {
      config.disposeScheduler(sessionId);
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
 * Hook that provides tool call update callbacks.
 */
function useToolCallUpdaters(
  setPendingHistoryItem: React.Dispatch<
    React.SetStateAction<HistoryItemWithoutId | null>
  >,
  setToolCallsByScheduler: React.Dispatch<
    React.SetStateAction<Map<symbol, TrackedToolCall[]>>
  >,
): {
  updateToolCallOutput: (
    schedulerId: symbol,
    toolCallId: string,
    outputChunk: string | AnsiOutput,
  ) => void;
  replaceToolCallsForScheduler: (
    schedulerId: symbol,
    calls: ToolCall[],
  ) => void;
} {
  const updateToolCallsForScheduler = useCallback(
    (
      schedulerId: symbol,
      updater: (prevCalls: TrackedToolCall[]) => TrackedToolCall[] | null,
    ) => {
      setToolCallsByScheduler((prev) => {
        const currentCalls = prev.get(schedulerId) ?? [];
        const updatedCalls = updater(currentCalls);
        return updateSchedulerState(prev, schedulerId, updatedCalls);
      });
    },
    [setToolCallsByScheduler],
  );

  const replaceToolCallsForScheduler = useCallback(
    (schedulerId: symbol, updatedCalls: ToolCall[]) => {
      updateToolCallsForScheduler(schedulerId, (prevCalls) =>
        mapCallsWithSubmittedFlag(prevCalls, updatedCalls),
      );
    },
    [updateToolCallsForScheduler],
  );

  const updateToolCallOutput = useCallback(
    (
      schedulerId: symbol,
      toolCallId: string,
      outputChunk: string | AnsiOutput,
    ) => {
      updateToolCallsForScheduler(schedulerId, (prevCalls) => {
        const nextCalls = updateCallsWithLiveOutput(
          prevCalls,
          toolCallId,
          outputChunk,
        );
        return nextCalls.some((call, index) => call !== prevCalls[index])
          ? nextCalls
          : prevCalls;
      });
      setPendingHistoryItem((prev) =>
        updatePendingItemWithOutput(prev, toolCallId, outputChunk),
      );
    },
    [updateToolCallsForScheduler, setPendingHistoryItem],
  );

  return { updateToolCallOutput, replaceToolCallsForScheduler };
}

/**
 * Hook that manages scheduler initialization effect.
 */
function useSchedulerEffect(
  config: Config,
  sessionId: string,
  mainSchedulerId: symbol,
  refs: SchedulerRefs,
  runtimeMessageBus: MessageBus | undefined,
  pendingScheduleRequests: React.MutableRefObject<
    Array<{
      request: ToolCallRequestInfo | ToolCallRequestInfo[];
      signal: AbortSignal;
    }>
  >,
  setScheduler: (s: CoreToolScheduler | null) => void,
): void {
  useEffect(() => {
    const mounted = { current: true };
    const resolved = { current: false };

    const init = async () => {
      const instance = await initializeSchedulerInstance(
        config,
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
        config.disposeScheduler(sessionId);
      }
    };
  }, [
    config,
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
function useScheduler(
  config: Config,
  sessionId: string,
  mainSchedulerId: symbol,
  refs: SchedulerRefs,
  runtimeMessageBus: MessageBus | undefined,
  pendingScheduleRequests: React.MutableRefObject<
    Array<{
      request: ToolCallRequestInfo | ToolCallRequestInfo[];
      signal: AbortSignal;
    }>
  >,
): CoreToolScheduler | null {
  const [scheduler, setScheduler] = useState<CoreToolScheduler | null>(null);
  useSchedulerEffect(
    config,
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
): ExternalSchedulerFactory {
  const factory = useCallback(
    async (args: Parameters<ExternalSchedulerFactory>[0]) => {
      const schedulerId = Symbol('subagent-scheduler');
      const schedulerSessionId = args.schedulerConfig.getSessionId();
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
  return factory as unknown as ExternalSchedulerFactory;
}

/**
 * Hook that manages external scheduler factory setup.
 */
function useExternalSchedulerSetup(
  config: Config,
  createExternalScheduler: ExternalSchedulerFactory,
): void {
  type ConfigWithSchedulerFactory = Config & {
    setInteractiveSubagentSchedulerFactory?: (
      factory: ExternalSchedulerFactory | undefined,
    ) => void;
  };

  useEffect(() => {
    const configWithFactory = config as ConfigWithSchedulerFactory;
    if (
      typeof configWithFactory.setInteractiveSubagentSchedulerFactory !==
      'function'
    ) {
      return undefined;
    }
    configWithFactory.setInteractiveSubagentSchedulerFactory(
      createExternalScheduler,
    );
    return () => {
      configWithFactory.setInteractiveSubagentSchedulerFactory(undefined);
    };
  }, [config, createExternalScheduler]);
}

/**
 * Hook that manages schedule function.
 */
function useScheduleFn(
  scheduler: CoreToolScheduler | null,
  pendingScheduleRequests: React.MutableRefObject<
    Array<{
      request: ToolCallRequestInfo | ToolCallRequestInfo[];
      signal: AbortSignal;
    }>
  >,
): ScheduleFn {
  return useCallback(
    (request, signal) => {
      const normalizedRequest = normalizeRequest(request);
      if (!scheduler) {
        pendingScheduleRequests.current.push({
          request: normalizedRequest,
          signal,
        });
        return Promise.resolve();
      }
      return scheduler.schedule(normalizedRequest, signal).catch(() => {});
    },
    [scheduler, pendingScheduleRequests],
  );
}

/**
 * Hook that manages markToolsAsSubmitted function.
 */
function useMarkToolsAsSubmitted(
  setToolCallsByScheduler: React.Dispatch<
    React.SetStateAction<Map<symbol, TrackedToolCall[]>>
  >,
): MarkToolsAsSubmittedFn {
  return useCallback(
    (callIdsToMark: string[]) => {
      if (callIdsToMark.length === 0) return;
      setToolCallsByScheduler((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const [schedulerId, calls] of prev) {
          const updatedCalls = markCallsAsSubmitted(calls, callIdsToMark);
          const hasChange = updatedCalls.some(
            (call, index) => call !== calls[index],
          );
          if (hasChange) {
            changed = true;
            next.set(schedulerId, updatedCalls);
          }
        }
        return changed ? next : prev;
      });
    },
    [setToolCallsByScheduler],
  );
}

/**
 * Hook that manages ref synchronization and creation.
 */
function useRefState(
  onComplete: (
    schedulerId: symbol,
    tools: CompletedToolCall[],
    options: { isPrimary: boolean },
  ) => Promise<void> | void,
  getPreferredEditor: () => EditorType | undefined,
  onEditorClose: () => void,
  onEditorOpen: () => void,
): {
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
} {
  const onCompleteRef = useRef(onComplete);
  const getPreferredEditorRef = useRef(getPreferredEditor);
  const onEditorCloseRef = useRef(onEditorClose);
  const onEditorOpenRef = useRef(onEditorOpen);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    getPreferredEditorRef.current = getPreferredEditor;
    onEditorCloseRef.current = onEditorClose;
    onEditorOpenRef.current = onEditorOpen;
  }, [getPreferredEditor, onEditorClose, onEditorOpen]);

  return useMemo(
    () => ({
      onCompleteRef,
      getPreferredEditorRef,
      onEditorCloseRef,
      onEditorOpenRef,
    }),
    [],
  );
}

/**
 * Hook that creates scheduler refs from constituent parts.
 */
function useSchedulerRefs(
  refs: ReturnType<typeof useRefState>,
  callbacks: {
    updateToolCallOutput: (
      schedulerId: symbol,
      toolCallId: string,
      chunk: string | AnsiOutput,
    ) => void;
    replaceToolCallsForScheduler: (
      schedulerId: symbol,
      calls: ToolCall[],
    ) => void;
    setLastToolOutputTime: (time: number) => void;
  },
): SchedulerRefs {
  return useMemo(
    () => ({
      updateToolCallOutput: callbacks.updateToolCallOutput,
      replaceToolCallsForScheduler: callbacks.replaceToolCallsForScheduler,
      setLastToolOutputTime: callbacks.setLastToolOutputTime,
      ...refs,
    }),
    [
      callbacks.updateToolCallOutput,
      callbacks.replaceToolCallsForScheduler,
      callbacks.setLastToolOutputTime,
      refs,
    ],
  );
}

export function useReactToolScheduler(
  onComplete: (
    schedulerId: symbol,
    tools: CompletedToolCall[],
    options: { isPrimary: boolean },
  ) => Promise<void> | void,
  config: Config,
  setPendingHistoryItem: React.Dispatch<
    React.SetStateAction<HistoryItemWithoutId | null>
  >,
  getPreferredEditor: () => EditorType | undefined,
  onEditorClose: () => void,
  onEditorOpen: () => void = () => {},
  runtimeMessageBus?: MessageBus,
): readonly [
  TrackedToolCall[],
  ScheduleFn,
  MarkToolsAsSubmittedFn,
  CancelAllFn,
  number,
] {
  const [toolCallsByScheduler, setToolCallsByScheduler] = useState<
    Map<symbol, TrackedToolCall[]>
  >(new Map());
  const [lastToolOutputTime, setLastToolOutputTime] = useState(0);
  const mainSchedulerId = useState(() => Symbol('main-scheduler'))[0];
  const sessionId = useMemo(() => config.getSessionId(), [config]);
  const pendingScheduleRequests = useRef<
    Array<{
      request: ToolCallRequestInfo | ToolCallRequestInfo[];
      signal: AbortSignal;
    }>
  >([]);

  const syncedRefs = useRefState(
    onComplete,
    getPreferredEditor,
    onEditorClose,
    onEditorOpen,
  );
  const toolCallUpdaters = useToolCallUpdaters(
    setPendingHistoryItem,
    setToolCallsByScheduler,
  );
  const refs = useSchedulerRefs(syncedRefs, {
    ...toolCallUpdaters,
    setLastToolOutputTime,
  });

  const scheduler = useScheduler(
    config,
    sessionId,
    mainSchedulerId,
    refs,
    runtimeMessageBus,
    pendingScheduleRequests,
  );

  const createExternalScheduler = useExternalSchedulerFactoryCreator(
    refs,
    runtimeMessageBus,
  );
  useExternalSchedulerSetup(config, createExternalScheduler);

  const schedule = useScheduleFn(scheduler, pendingScheduleRequests);
  const markToolsAsSubmitted = useMarkToolsAsSubmitted(setToolCallsByScheduler);
  const cancelAllToolCalls = useCallback(
    () => scheduler?.cancelAll(),
    [scheduler],
  );
  const toolCalls = useMemo(
    () => Array.from(toolCallsByScheduler.values()).flat(),
    [toolCallsByScheduler],
  );

  return [
    toolCalls,
    schedule,
    markToolsAsSubmitted,
    cancelAllToolCalls,
    lastToolOutputTime,
  ] as const;
}
