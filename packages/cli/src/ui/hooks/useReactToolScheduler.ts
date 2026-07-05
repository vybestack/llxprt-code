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
  type ToolCall,
  type EditorType,
  type AnsiOutput,
  type MessageBus,
} from '@vybestack/llxprt-code-core';
import { useCallback, useState, useMemo, useEffect, useRef } from 'react';

import type { HistoryItemWithoutId } from '../types.js';
import { ToolCallStatus } from '../types.js';
import {
  createInteractiveToolScheduler,
  type InteractiveToolScheduler,
} from '../../runtime/interactiveToolScheduler.js';

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

  return useMemo(
    () => ({ updateToolCallOutput, replaceToolCallsForScheduler }),
    [updateToolCallOutput, replaceToolCallsForScheduler],
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
 * Hook that manages ref synchronization for the latest callback props so the
 * capability's stable closures always invoke current implementations.
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
 * Derives the flattened tool-call list and a cancel-all callback from the
 * per-scheduler tracked tool-call state.
 */
function useDerivedToolCallState(
  toolCallsByScheduler: Map<symbol, TrackedToolCall[]>,
  capability: InteractiveToolScheduler,
): { toolCalls: TrackedToolCall[]; cancelAllToolCalls: CancelAllFn } {
  const cancelAllToolCalls = useCallback(
    () => capability.cancelAll(),
    [capability],
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

/**
 * Memoized main-scheduler display callbacks bound to the main scheduler ID.
 */
function useMainSchedulerCallbacks(
  toolCallUpdaters: ReturnType<typeof useToolCallUpdaters>,
  syncedRefs: ReturnType<typeof useRefState>,
  mainSchedulerId: symbol,
  setLastToolOutputTime: React.Dispatch<React.SetStateAction<number>>,
): MainSchedulerCallbacks {
  return useMemo(
    () => ({
      outputUpdateHandler: (toolCallId: string, chunk: string | AnsiOutput) => {
        toolCallUpdaters.updateToolCallOutput(
          mainSchedulerId,
          toolCallId,
          chunk,
        );
        setLastToolOutputTime(Date.now());
      },
      onAllToolCallsComplete: async (
        completedToolCalls: CompletedToolCall[],
      ) => {
        if (completedToolCalls.length > 0) {
          await syncedRefs.onCompleteRef.current(
            mainSchedulerId,
            completedToolCalls,
            { isPrimary: true },
          );
        }
        toolCallUpdaters.replaceToolCallsForScheduler(mainSchedulerId, []);
      },
      onToolCallsUpdate: (calls: ToolCall[]) =>
        toolCallUpdaters.replaceToolCallsForScheduler(mainSchedulerId, calls),
      getPreferredEditor: () => syncedRefs.getPreferredEditorRef.current(),
      onEditorClose: () => syncedRefs.onEditorCloseRef.current(),
      onEditorOpen: () => syncedRefs.onEditorOpenRef.current(),
    }),
    [toolCallUpdaters, syncedRefs, mainSchedulerId, setLastToolOutputTime],
  );
}

/**
 * Memoized subagent display callbacks, keyed by per-scheduler symbols.
 */
function useSubagentCallbacks(
  toolCallUpdaters: ReturnType<typeof useToolCallUpdaters>,
  syncedRefs: ReturnType<typeof useRefState>,
  setLastToolOutputTime: React.Dispatch<React.SetStateAction<number>>,
): SubagentCallbacks {
  return useMemo(
    () => ({
      updateToolCallOutput: toolCallUpdaters.updateToolCallOutput,
      replaceToolCalls: toolCallUpdaters.replaceToolCallsForScheduler,
      onComplete: (
        ...args: [
          schedulerId: symbol,
          tools: CompletedToolCall[],
          options: { isPrimary: boolean },
        ]
      ) => syncedRefs.onCompleteRef.current(...args),
      getPreferredEditor: () => syncedRefs.getPreferredEditorRef.current(),
      onEditorClose: () => syncedRefs.onEditorCloseRef.current(),
      onEditorOpen: () => syncedRefs.onEditorOpenRef.current(),
      setLastToolOutputTime,
    }),
    [toolCallUpdaters, syncedRefs, setLastToolOutputTime],
  );
}

/**
 * Wires the capability to the React lifecycle: attaches on mount (creating the
 * scheduler, registering the subagent factory, flushing pending requests) and
 * detaches on unmount (disposing the scheduler, de-registering the factory).
 */
function useCapabilityAttach(
  capability: InteractiveToolScheduler,
  mainSchedulerCallbacks: MainSchedulerCallbacks,
  subagentCallbacks: SubagentCallbacks,
  setLastToolOutputTime: React.Dispatch<React.SetStateAction<number>>,
  setInteractiveRuntimeReady: React.Dispatch<React.SetStateAction<boolean>>,
): void {
  useEffect(() => {
    const mounted = { current: true };
    let detach: (() => void) | null = null;

    const mainHooks = {
      ...mainSchedulerCallbacks,
      setLastToolOutputTime,
      isMounted: () => mounted.current,
    };

    void capability.attach(mainHooks, subagentCallbacks).then((d) => {
      detach = d;
      if (mounted.current) {
        setInteractiveRuntimeReady(capability.isReady());
      } else {
        d();
      }
    });

    return () => {
      mounted.current = false;
      detach?.();
      setInteractiveRuntimeReady(false);
    };
  }, [
    capability,
    mainSchedulerCallbacks,
    subagentCallbacks,
    setLastToolOutputTime,
    setInteractiveRuntimeReady,
  ]);
}

/** Shape of the main-scheduler display callbacks memoized by the hook. */
type MainSchedulerCallbacks = {
  outputUpdateHandler: (toolCallId: string, chunk: string | AnsiOutput) => void;
  onAllToolCallsComplete: (
    completedToolCalls: CompletedToolCall[],
  ) => Promise<void>;
  onToolCallsUpdate: (calls: ToolCall[]) => void;
  getPreferredEditor: () => EditorType | undefined;
  onEditorClose: () => void;
  onEditorOpen: () => void;
};

/** Shape of the subagent display callbacks memoized by the hook. */
type SubagentCallbacks = {
  updateToolCallOutput: (
    schedulerId: symbol,
    toolCallId: string,
    chunk: string | AnsiOutput,
  ) => void;
  replaceToolCalls: (schedulerId: symbol, calls: ToolCall[]) => void;
  onComplete: (
    schedulerId: symbol,
    tools: CompletedToolCall[],
    options: { isPrimary: boolean },
  ) => Promise<void> | void;
  getPreferredEditor: () => EditorType | undefined;
  onEditorClose: () => void;
  onEditorOpen: () => void;
  setLastToolOutputTime: (time: number) => void;
};

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
  const [interactiveRuntimeReady, setInteractiveRuntimeReady] = useState(false);
  const mainSchedulerId = useState(() => Symbol('main-scheduler'))[0];

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
  const capability = useMemo(
    () => createInteractiveToolScheduler(config, runtimeMessageBus),
    [config, runtimeMessageBus],
  );
  const mainSchedulerCallbacks = useMainSchedulerCallbacks(
    toolCallUpdaters,
    syncedRefs,
    mainSchedulerId,
    setLastToolOutputTime,
  );
  const subagentCallbacks = useSubagentCallbacks(
    toolCallUpdaters,
    syncedRefs,
    setLastToolOutputTime,
  );

  useCapabilityAttach(
    capability,
    mainSchedulerCallbacks,
    subagentCallbacks,
    setLastToolOutputTime,
    setInteractiveRuntimeReady,
  );

  const schedule = useCallback<ScheduleFn>(
    (request, signal) => capability.schedule(request, signal),
    [capability],
  );
  const markToolsAsDisplayCleared = useMarkToolsAsDisplayCleared(
    setToolCallsByScheduler,
  );
  const { toolCalls, cancelAllToolCalls } = useDerivedToolCallState(
    toolCallsByScheduler,
    capability,
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
