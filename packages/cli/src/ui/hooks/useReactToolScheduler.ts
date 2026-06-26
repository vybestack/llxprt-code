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
  type OutputUpdateHandler,
  type ToolCallsUpdateHandler,
  type ToolCall,
  type EditorType,
  type SubagentSchedulerFactory,
  DEFAULT_AGENT_ID,
  DebugLogger,
  type AnsiOutput,
  type MessageBus,
} from '@vybestack/llxprt-code-core';
import { useCallback, useState, useMemo, useEffect, useRef } from 'react';
import type { CoreToolScheduler } from '@vybestack/llxprt-code-agents';

import type { HistoryItemWithoutId } from '../types.js';
import { ToolCallStatus } from '../types.js';

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
export type MarkToolsAsDisplayClearedFn = (callIds: string[]) => void;

export type TrackedScheduledToolCall = ScheduledToolCall & {
  displayCleared?: boolean;
};
export type TrackedValidatingToolCall = ValidatingToolCall & {
  displayCleared?: boolean;
};
export type TrackedWaitingToolCall = WaitingToolCall & {
  displayCleared?: boolean;
};
export type TrackedExecutingToolCall = ExecutingToolCall & {
  displayCleared?: boolean;
};
export type TrackedCompletedToolCall = CompletedToolCall & {
  displayCleared?: boolean;
};
export type TrackedCancelledToolCall = CancelledToolCall & {
  displayCleared?: boolean;
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
 * Replaces the display tool-calls for the main scheduler, bound to the main
 * scheduler ID so callers (e.g. the AgenticLoop's displayCallbacks) don't need
 * to know the internal symbol.
 */
export type ReplaceToolCallsFn = (calls: ToolCall[]) => void;
export type UpdateToolOutputFn = (
  toolCallId: string,
  chunk: string | AnsiOutput,
) => void;
export type ReactToolSchedulerResult = readonly [
  TrackedToolCall[],
  ScheduleFn,
  MarkToolsAsDisplayClearedFn,
  CancelAllFn,
  number,
  boolean,
  ReplaceToolCallsFn,
  UpdateToolOutputFn,
];
type PendingScheduleRequests = Array<{
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
 * Maps updated calls preserving the displayCleared flag.
 */
function mapCallsWithDisplayClearedFlag(
  prevCalls: TrackedToolCall[],
  updatedCalls: ToolCall[],
): TrackedToolCall[] {
  if (updatedCalls.length === 0) return [];
  const previousCallMap = new Map(
    prevCalls.map((call) => [call.request.callId, call]),
  );
  return updatedCalls.map((call) => ({
    ...call,
    displayCleared:
      previousCallMap.get(call.request.callId)?.displayCleared ?? false,
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
 * Marks tool calls as cleared from display.
 */
function markCallsAsDisplayCleared(
  calls: TrackedToolCall[],
  callIdsToMark: string[],
): TrackedToolCall[] {
  return calls.map((call) =>
    callIdsToMark.includes(call.request.callId)
      ? { ...call, displayCleared: true }
      : call,
  );
}

/**
 * Processes pending schedule requests after scheduler initialization.
 */
function processPendingRequests(
  instance: CoreToolScheduler,
  requests: PendingScheduleRequests,
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
        mapCallsWithDisplayClearedFlag(prevCalls, updatedCalls),
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
  pendingScheduleRequests: React.MutableRefObject<PendingScheduleRequests>,
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
  pendingScheduleRequests: React.MutableRefObject<PendingScheduleRequests>,
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
): SubagentSchedulerFactory {
  const factory = useCallback(
    async (args: Parameters<SubagentSchedulerFactory>[0]) => {
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
  return factory;
}

/**
 * Hook that manages external scheduler factory setup.
 */
function useExternalSchedulerSetup(
  config: Config,
  createExternalScheduler: SubagentSchedulerFactory,
  setExternalSchedulerRegistered: (registered: boolean) => void,
): void {
  type ConfigWithSchedulerFactory = Config & {
    setInteractiveSubagentSchedulerFactory?: (
      factory: SubagentSchedulerFactory | undefined,
    ) => void;
  };

  useEffect(() => {
    const configWithFactory = config as ConfigWithSchedulerFactory;
    if (
      typeof configWithFactory.setInteractiveSubagentSchedulerFactory !==
      'function'
    ) {
      setExternalSchedulerRegistered(true);
      return () => setExternalSchedulerRegistered(false);
    }
    configWithFactory.setInteractiveSubagentSchedulerFactory(
      createExternalScheduler,
    );
    setExternalSchedulerRegistered(true);
    return () => {
      setExternalSchedulerRegistered(false);
      configWithFactory.setInteractiveSubagentSchedulerFactory(undefined);
    };
  }, [config, createExternalScheduler, setExternalSchedulerRegistered]);
}

/**
 * Composes external scheduler factory creation with its registration effect.
 */
function useExternalSchedulerRegistration(
  config: Config,
  refs: SchedulerRefs,
  runtimeMessageBus: MessageBus | undefined,
  setExternalSchedulerRegistered: (registered: boolean) => void,
): void {
  const createExternalScheduler = useExternalSchedulerFactoryCreator(
    refs,
    runtimeMessageBus,
  );
  useExternalSchedulerSetup(
    config,
    createExternalScheduler,
    setExternalSchedulerRegistered,
  );
}

/**
 * Hook that manages schedule function.
 */
function useScheduleFn(
  scheduler: CoreToolScheduler | null,
  pendingScheduleRequests: React.MutableRefObject<PendingScheduleRequests>,
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
 * Hook that manages markToolsAsDisplayCleared function.
 */
function useMarkToolsAsDisplayCleared(
  setToolCallsByScheduler: React.Dispatch<
    React.SetStateAction<Map<symbol, TrackedToolCall[]>>
  >,
): MarkToolsAsDisplayClearedFn {
  return useCallback(
    (callIdsToMark: string[]) => {
      if (callIdsToMark.length === 0) return;
      setToolCallsByScheduler((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const [schedulerId, calls] of prev) {
          const updatedCalls = markCallsAsDisplayCleared(calls, callIdsToMark);
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

function useToolSchedulerReadiness(
  scheduler: CoreToolScheduler | null,
  externalSchedulerRegistered: boolean,
): boolean {
  return scheduler !== null && externalSchedulerRegistered;
}

/**
 * Derives the flattened tool-call list and a cancel-all callback from the
 * per-scheduler tracked tool-call state.
 */
function useDerivedToolCallState(
  toolCallsByScheduler: Map<symbol, TrackedToolCall[]>,
  scheduler: CoreToolScheduler | null,
): { toolCalls: TrackedToolCall[]; cancelAllToolCalls: CancelAllFn } {
  const cancelAllToolCalls = useCallback(
    () => scheduler?.cancelAll(),
    [scheduler],
  );
  const toolCalls = useMemo(
    () => Array.from(toolCallsByScheduler.values()).flat(),
    [toolCallsByScheduler],
  );
  return { toolCalls, cancelAllToolCalls };
}

function buildReactToolSchedulerResult(
  toolCalls: TrackedToolCall[],
  schedule: ScheduleFn,
  markToolsAsDisplayCleared: MarkToolsAsDisplayClearedFn,
  cancelAllToolCalls: CancelAllFn,
  lastToolOutputTime: number,
  interactiveRuntimeReady: boolean,
  replaceToolCallsForScheduler: ReplaceToolCallsFn,
  updateToolCallOutput: UpdateToolOutputFn,
): ReactToolSchedulerResult {
  return [
    toolCalls,
    schedule,
    markToolsAsDisplayCleared,
    cancelAllToolCalls,
    lastToolOutputTime,
    interactiveRuntimeReady,
    replaceToolCallsForScheduler,
    updateToolCallOutput,
  ] as const;
}

/**
 * Creates bound display-state updaters for the AgenticLoop's displayCallbacks.
 * Binds the main scheduler ID so the loop's onToolCallsUpdate /
 * outputUpdateHandler feed the SAME React display state.
 */
function useBoundDisplayUpdaters(
  toolCallUpdaters: ReturnType<typeof useToolCallUpdaters>,
  mainSchedulerId: symbol,
): {
  replaceToolCalls: ReplaceToolCallsFn;
  updateToolOutput: UpdateToolOutputFn;
} {
  const { replaceToolCallsForScheduler, updateToolCallOutput } =
    toolCallUpdaters;
  const replaceToolCalls = useCallback(
    (calls: ToolCall[]) => replaceToolCallsForScheduler(mainSchedulerId, calls),
    [replaceToolCallsForScheduler, mainSchedulerId],
  );
  const updateToolOutput = useCallback(
    (toolCallId: string, chunk: string | AnsiOutput) =>
      updateToolCallOutput(mainSchedulerId, toolCallId, chunk),
    [updateToolCallOutput, mainSchedulerId],
  );
  return { replaceToolCalls, updateToolOutput };
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
): ReactToolSchedulerResult {
  const [toolCallsByScheduler, setToolCallsByScheduler] = useState<
    Map<symbol, TrackedToolCall[]>
  >(new Map());
  const [lastToolOutputTime, setLastToolOutputTime] = useState(0);
  const [externalSchedulerRegistered, setExternalSchedulerRegistered] =
    useState(false);
  const mainSchedulerId = useState(() => Symbol('main-scheduler'))[0];
  const sessionId = useMemo(() => config.getSessionId(), [config]);
  const pendingScheduleRequests = useRef<PendingScheduleRequests>([]);

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

  useExternalSchedulerRegistration(
    config,
    refs,
    runtimeMessageBus,
    setExternalSchedulerRegistered,
  );

  const schedule = useScheduleFn(scheduler, pendingScheduleRequests);
  const markToolsAsDisplayCleared = useMarkToolsAsDisplayCleared(
    setToolCallsByScheduler,
  );
  const { toolCalls, cancelAllToolCalls } = useDerivedToolCallState(
    toolCallsByScheduler,
    scheduler,
  );

  const interactiveRuntimeReady = useToolSchedulerReadiness(
    scheduler,
    externalSchedulerRegistered,
  );

  const {
    replaceToolCalls: boundReplaceToolCalls,
    updateToolOutput: boundUpdateToolOutput,
  } = useBoundDisplayUpdaters(toolCallUpdaters, mainSchedulerId);

  return buildReactToolSchedulerResult(
    toolCalls,
    schedule,
    markToolsAsDisplayCleared,
    cancelAllToolCalls,
    lastToolOutputTime,
    interactiveRuntimeReady,
    boundReplaceToolCalls,
    boundUpdateToolOutput,
  );
}
