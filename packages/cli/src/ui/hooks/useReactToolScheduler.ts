/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Config,
  ToolCallRequestInfo,
  ExecutingToolCall,
  ScheduledToolCall,
  ValidatingToolCall,
  WaitingToolCall,
  CompletedToolCall,
  CancelledToolCall,
  CoreToolScheduler,
  OutputUpdateHandler,
  ToolCallsUpdateHandler,
  ToolCall,
  Status as CoreStatus,
  EditorType,
  DEFAULT_AGENT_ID,
  DebugLogger,
  type AnsiOutput,
} from '@vybestack/llxprt-code-core';
import { useCallback, useState, useMemo, useEffect, useRef } from 'react';
import {
  HistoryItemToolGroup,
  IndividualToolCallDisplay,
  ToolCallStatus,
  HistoryItemWithoutId,
} from '../types.js';

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

const logger = DebugLogger.getLogger('llxprt:cli:react-tool-scheduler');

export type ScheduleFn = (
  request: ToolCallRequestInfo | ToolCallRequestInfo[],
  signal: AbortSignal,
) => void;
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

  const updatePendingHistoryItem = useCallback(
    (toolCallId: string, outputChunk: string | AnsiOutput) => {
      setPendingHistoryItem((prevItem) => {
        if (prevItem?.type === 'tool_group') {
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
        return prevItem;
      });
    },
    [setPendingHistoryItem],
  );

  const updateToolCallsForScheduler = useCallback(
    (
      schedulerId: symbol,
      updater: (prevCalls: TrackedToolCall[]) => TrackedToolCall[] | null,
    ) => {
      setToolCallsByScheduler((prev) => {
        const currentCalls = prev.get(schedulerId) ?? [];
        const updatedCalls = updater(currentCalls);
        if (updatedCalls === currentCalls) {
          return prev;
        }
        const next = new Map(prev);
        if (!updatedCalls || updatedCalls.length === 0) {
          next.delete(schedulerId);
        } else {
          next.set(schedulerId, updatedCalls);
        }
        return next;
      });
    },
    [],
  );

  const replaceToolCallsForScheduler = useCallback(
    (schedulerId: symbol, updatedCalls: ToolCall[]) => {
      updateToolCallsForScheduler(schedulerId, (prevCalls) => {
        if (updatedCalls.length === 0) {
          return [];
        }
        const previousCallMap = new Map(
          prevCalls.map((call) => [call.request.callId, call]),
        );
        return updatedCalls.map((call) => ({
          ...call,
          responseSubmittedToGemini:
            previousCallMap.get(call.request.callId)
              ?.responseSubmittedToGemini ?? false,
        })) as TrackedToolCall[];
      });
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
        let updated = false;
        const nextCalls = prevCalls.map((call) => {
          if (call.request.callId !== toolCallId) {
            return call;
          }
          if (call.status !== 'executing') {
            return call;
          }
          updated = true;
          const executingCall = call as TrackedExecutingToolCall;
          return { ...executingCall, liveOutput: outputChunk };
        });
        return updated ? nextCalls : prevCalls;
      });
      updatePendingHistoryItem(toolCallId, outputChunk);
    },
    [updateToolCallsForScheduler, updatePendingHistoryItem],
  );

  const toolCalls = useMemo(
    () => Array.from(toolCallsByScheduler.values()).flat(),
    [toolCallsByScheduler],
  );

  const [lastToolOutputTime, setLastToolOutputTime] = useState(0);

  const mainSchedulerId = useState(() => Symbol('main-scheduler'))[0];
  const sessionId = useMemo(() => config.getSessionId(), [config]);
  const [scheduler, setScheduler] = useState<CoreToolScheduler | null>(null);
  const pendingScheduleRequests = useRef<
    Array<{
      request: ToolCallRequestInfo | ToolCallRequestInfo[];
      signal: AbortSignal;
    }>
  >([]);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // Use the singleton scheduler from config to ensure all schedulers in a session
  // share the same CoreToolScheduler instance, avoiding duplicate MessageBus
  // subscriptions and "unknown correlationId" errors.
  useEffect(() => {
    let mounted = true;
    let resolved = false;

    const initializeScheduler = async () => {
      try {
        const instance = await config.getOrCreateScheduler(sessionId, {
          outputUpdateHandler: (toolCallId, chunk) => {
            if (!mounted) {
              return;
            }
            updateToolCallOutput(mainSchedulerId, toolCallId, chunk);
            setLastToolOutputTime(Date.now());
          },
          onAllToolCallsComplete: async (completedToolCalls) => {
            if (!mounted) {
              return;
            }
            if (completedToolCalls.length > 0) {
              await onCompleteRef.current(mainSchedulerId, completedToolCalls, {
                isPrimary: true,
              });
            }
            replaceToolCallsForScheduler(mainSchedulerId, []);
          },
          onToolCallsUpdate: (calls) => {
            if (!mounted) {
              return;
            }
            replaceToolCallsForScheduler(mainSchedulerId, calls);
          },
          getPreferredEditor,
          onEditorClose,
          onEditorOpen,
        });

        resolved = true;
        if (!mounted) {
          config.disposeScheduler(sessionId);
          return;
        }
        if (pendingScheduleRequests.current.length > 0) {
          for (const { request, signal } of pendingScheduleRequests.current) {
            if (signal.aborted) {
              continue;
            }
            instance.schedule(request, signal).catch(() => {
              // Silently ignore cancellation rejections - this is expected behavior
              // when the user presses ESC to cancel queued tool calls
            });
          }
          pendingScheduleRequests.current = [];
        }

        setScheduler(instance);
      } catch (error) {
        logger.warn(
          () =>
            `Failed to initialize scheduler: ${
              error instanceof Error ? error.message : String(error)
            }`,
        );
        if (mounted) {
          setScheduler(null);
        }
      }
    };

    void initializeScheduler();

    return () => {
      mounted = false;
      if (resolved) {
        config.disposeScheduler(sessionId);
      }
    };
  }, [
    config,
    sessionId,
    mainSchedulerId,
    replaceToolCallsForScheduler,
    updateToolCallOutput,
    getPreferredEditor,
    onEditorClose,
    onEditorOpen,
  ]);

  const createExternalScheduler = useCallback(
    async (args: Parameters<ExternalSchedulerFactory>[0]) => {
      const {
        schedulerConfig,
        onAllToolCallsComplete,
        outputUpdateHandler: _outputUpdateHandler,
        onToolCallsUpdate,
      } = args;
      // Note: _outputUpdateHandler is intentionally not called - see comment below

      const schedulerId = Symbol('subagent-scheduler');
      const schedulerSessionId = schedulerConfig.getSessionId();

      // Use the shared scheduler instance for this session to avoid multiple
      // MessageBus subscriptions and "unknown correlationId" errors
      const instance = await schedulerConfig.getOrCreateScheduler(
        schedulerSessionId,
        {
          // Only update the local UI state - don't call outputUpdateHandler as well,
          // since that would cause duplicate output (the subagent's outputUpdateHandler
          // calls onMessage which goes to task.updateOutput, creating a second display).
          // The local updateToolCallOutput handles the UI rendering for subagent tools.
          outputUpdateHandler: (toolCallId, chunk) => {
            updateToolCallOutput(schedulerId, toolCallId, chunk);
            setLastToolOutputTime(Date.now());
          },
          onToolCallsUpdate: (calls) => {
            replaceToolCallsForScheduler(schedulerId, calls);
            onToolCallsUpdate?.(calls);
          },
          onAllToolCallsComplete: async (calls) => {
            if (calls.length > 0) {
              await onCompleteRef.current(schedulerId, calls, {
                isPrimary: false,
              });
              await onAllToolCallsComplete?.(calls);
            }
            replaceToolCallsForScheduler(schedulerId, []);
          },
          getPreferredEditor,
          onEditorClose,
          onEditorOpen,
        },
      );

      return {
        schedule: (
          request: ToolCallRequestInfo | ToolCallRequestInfo[],
          signal: AbortSignal,
        ) => instance.schedule(request, signal),
        dispose: () => schedulerConfig.disposeScheduler(schedulerSessionId),
      };
    },
    [
      getPreferredEditor,
      onEditorClose,
      replaceToolCallsForScheduler,
      updateToolCallOutput,
      onEditorOpen,
    ],
  ) as unknown as ExternalSchedulerFactory;

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
      return;
    }

    configWithFactory.setInteractiveSubagentSchedulerFactory(
      createExternalScheduler as ExternalSchedulerFactory,
    );

    return () => {
      configWithFactory.setInteractiveSubagentSchedulerFactory?.(undefined);
    };
  }, [config, createExternalScheduler]);

  const schedule: ScheduleFn = useCallback(
    (
      request: ToolCallRequestInfo | ToolCallRequestInfo[],
      signal: AbortSignal,
    ) => {
      const ensureAgentId = (
        req: ToolCallRequestInfo,
      ): ToolCallRequestInfo => ({
        ...req,
        agentId: req.agentId ?? DEFAULT_AGENT_ID,
      });

      const normalizedRequest = Array.isArray(request)
        ? request.map(ensureAgentId)
        : ensureAgentId(request);

      if (!scheduler) {
        pendingScheduleRequests.current.push({
          request: normalizedRequest,
          signal,
        });
        return Promise.resolve();
      }

      // The scheduler.schedule() returns a Promise that rejects when the abort
      // signal fires while tool calls are queued. We intentionally catch and
      // ignore these rejections because:
      // 1. Cancellation is an expected user action, not an error
      // 2. The UI state is updated via cancelAllToolCalls() synchronously
      // 3. Tool results are not needed after cancellation
      return scheduler.schedule(normalizedRequest, signal).catch(() => {
        // Silently ignore cancellation rejections - this is expected behavior
        // when the user presses ESC to cancel queued tool calls
      });
    },
    [scheduler],
  );

  const markToolsAsSubmitted: MarkToolsAsSubmittedFn = useCallback(
    (callIdsToMark: string[]) => {
      if (callIdsToMark.length === 0) {
        return;
      }
      setToolCallsByScheduler((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const [schedulerId, calls] of prev) {
          const updatedCalls = calls.map((call) =>
            callIdsToMark.includes(call.request.callId)
              ? { ...call, responseSubmittedToGemini: true }
              : call,
          );
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
    [],
  );

  const cancelAllToolCalls = useCallback(() => {
    scheduler?.cancelAll();
  }, [scheduler]);

  return [
    toolCalls,
    schedule,
    markToolsAsSubmitted,
    cancelAllToolCalls,
    lastToolOutputTime,
  ] as const;
}

/**
 * Maps a CoreToolScheduler status to the UI's ToolCallStatus enum.
 * Memoized as a constant map for better performance.
 */
const STATUS_MAP: Record<CoreStatus, ToolCallStatus> = {
  validating: ToolCallStatus.Executing,
  awaiting_approval: ToolCallStatus.Confirming,
  executing: ToolCallStatus.Executing,
  success: ToolCallStatus.Success,
  cancelled: ToolCallStatus.Canceled,
  error: ToolCallStatus.Error,
  scheduled: ToolCallStatus.Pending,
};

function mapCoreStatusToDisplayStatus(coreStatus: CoreStatus): ToolCallStatus {
  const mappedStatus = STATUS_MAP[coreStatus];
  if (mappedStatus !== undefined) {
    return mappedStatus;
  }

  // This should be unreachable if CoreStatus is exhaustive
  logger.warn(() => `Unknown core status encountered: ${coreStatus}`);
  return ToolCallStatus.Error;
}

/**
 * Transforms `TrackedToolCall` objects into `HistoryItemToolGroup` objects for UI display.
 */
export function mapToDisplay(
  toolOrTools: TrackedToolCall[] | TrackedToolCall,
): HistoryItemToolGroup {
  const toolCalls = Array.isArray(toolOrTools) ? toolOrTools : [toolOrTools];

  const groupAgentId =
    toolCalls
      .map((trackedCall) => {
        const responseAgentId =
          'response' in trackedCall ? trackedCall.response?.agentId : undefined;
        return responseAgentId ?? trackedCall.request.agentId;
      })
      .find(
        (agentId): agentId is string =>
          typeof agentId === 'string' && agentId.trim().length > 0,
      ) ?? DEFAULT_AGENT_ID;

  const toolDisplays = toolCalls.map(
    (trackedCall): IndividualToolCallDisplay => {
      let displayName: string;
      let description: string;
      let renderOutputAsMarkdown = false;

      if (trackedCall.status === 'error') {
        displayName =
          trackedCall.tool === undefined
            ? trackedCall.request.name
            : trackedCall.tool.displayName;
        description = JSON.stringify(trackedCall.request.args);
      } else {
        displayName = trackedCall.tool.displayName;
        description = trackedCall.invocation.getDescription();
        renderOutputAsMarkdown = trackedCall.tool.isOutputMarkdown;
      }

      const baseDisplayProperties: Omit<
        IndividualToolCallDisplay,
        'status' | 'resultDisplay' | 'confirmationDetails'
      > = {
        callId: trackedCall.request.callId,
        name: displayName,
        description,
        renderOutputAsMarkdown,
      };

      switch (trackedCall.status) {
        case 'success':
          logger.debug(
            `mapToDisplay: success call ${trackedCall.request.callId}, toolName=${trackedCall.request.name}, resultDisplay type: ${typeof trackedCall.response.resultDisplay}, hasValue: ${!!trackedCall.response.resultDisplay}, preview: ${typeof trackedCall.response.resultDisplay === 'string' ? trackedCall.response.resultDisplay.slice(0, 100) : 'non-string'}`,
          );
          return {
            ...baseDisplayProperties,
            status: mapCoreStatusToDisplayStatus(trackedCall.status),
            resultDisplay: trackedCall.response.resultDisplay,
            confirmationDetails: undefined,
          };
        case 'error':
          return {
            ...baseDisplayProperties,
            status: mapCoreStatusToDisplayStatus(trackedCall.status),
            resultDisplay: trackedCall.response.resultDisplay,
            confirmationDetails: undefined,
          };
        case 'cancelled':
          return {
            ...baseDisplayProperties,
            status: mapCoreStatusToDisplayStatus(trackedCall.status),
            resultDisplay: trackedCall.response.resultDisplay,
            confirmationDetails: undefined,
          };
        case 'awaiting_approval':
          return {
            ...baseDisplayProperties,
            status: mapCoreStatusToDisplayStatus(trackedCall.status),
            resultDisplay: undefined,
            confirmationDetails: trackedCall.confirmationDetails,
          };
        case 'executing': {
          const executingCall = trackedCall as TrackedExecutingToolCall;
          return {
            ...baseDisplayProperties,
            status: mapCoreStatusToDisplayStatus(trackedCall.status),
            resultDisplay: executingCall.liveOutput ?? undefined,
            confirmationDetails: undefined,
            ptyId: executingCall.pid,
          };
        }
        case 'validating': // Fallthrough
        case 'scheduled':
          return {
            ...baseDisplayProperties,
            status: mapCoreStatusToDisplayStatus(trackedCall.status),
            resultDisplay: undefined,
            confirmationDetails: undefined,
          };
        default: {
          const exhaustiveCheck: never = trackedCall;
          return {
            callId: (exhaustiveCheck as TrackedToolCall).request.callId,
            name: 'Unknown Tool',
            description: 'Encountered an unknown tool call state.',
            status: ToolCallStatus.Error,
            resultDisplay: 'Unknown tool call state',
            confirmationDetails: undefined,
            renderOutputAsMarkdown: false,
          };
        }
      }
    },
  );

  return {
    type: 'tool_group',
    agentId: groupAgentId,
    tools: toolDisplays,
  };
}
