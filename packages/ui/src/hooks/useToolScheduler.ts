import { useCallback, useState, useRef, useEffect } from 'react';
import type {
  Config,
  ToolCallRequestInfo,
  ToolConfirmationOutcome,
  CoreToolScheduler,
  ToolCall as CoreToolCall,
  CompletedToolCall,
  WaitingToolCall,
  ExecutingToolCall,
  CancelledToolCall,
  ToolCallConfirmationDetails,
  AnsiOutput,
} from '@vybestack/llxprt-code-core';
import type { ToolStatus } from '../types/events';
import { getLogger } from '../lib/logger';

const logger = getLogger('nui:tool-scheduler');

/**
 * Tracked tool call with response submission state
 */
export type TrackedToolCall = CoreToolCall & {
  responseSubmittedToModel?: boolean;
};

export type TrackedCompletedToolCall = CompletedToolCall & {
  responseSubmittedToModel?: boolean;
};

export type TrackedCancelledToolCall = CancelledToolCall & {
  responseSubmittedToModel?: boolean;
};

export type TrackedWaitingToolCall = WaitingToolCall & {
  responseSubmittedToModel?: boolean;
};

export type TrackedExecutingToolCall = ExecutingToolCall & {
  responseSubmittedToModel?: boolean;
  liveOutput?: string;
};

/**
 * Tool call display info for the UI
 */
export interface ToolCallDisplayInfo {
  callId: string;
  name: string;
  displayName: string;
  description: string;
  status: ToolStatus;
  output?: string;
  errorMessage?: string;
  confirmationDetails?: ToolCallConfirmationDetails;
}

export type ScheduleFn = (
  request: ToolCallRequestInfo | ToolCallRequestInfo[],
  signal: AbortSignal,
) => void;

export type MarkToolsAsSubmittedFn = (callIds: string[]) => void;
export type CancelAllFn = () => void;
export type RespondToConfirmationFn = (
  callId: string,
  outcome: ToolConfirmationOutcome,
) => void;

export interface UseToolSchedulerResult {
  toolCalls: TrackedToolCall[];
  schedule: ScheduleFn;
  markToolsAsSubmitted: MarkToolsAsSubmittedFn;
  cancelAll: CancelAllFn;
  getToolDisplayInfo: () => ToolCallDisplayInfo[];
  respondToConfirmation: RespondToConfirmationFn;
}

/**
 * Map CoreToolScheduler status to UI ToolStatus
 */
function mapCoreStatusToToolStatus(status: CoreToolCall['status']): ToolStatus {
  switch (status) {
    case 'scheduled':
      return 'pending';
    case 'validating':
      return 'executing';
    case 'awaiting_approval':
      return 'confirming';
    case 'executing':
      return 'executing';
    case 'success':
      return 'complete';
    case 'error':
      return 'error';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'pending';
  }
}

type OnCompleteCallback = (
  completedTools: CompletedToolCall[],
) => Promise<void> | void;
type OnUpdateCallback = (tools: TrackedToolCall[]) => void;

/**
 * Convert AnsiOutput to plain text by extracting token text content.
 */
function ansiOutputToText(output: AnsiOutput): string {
  const newline = '\n';
  return output
    .map((line) => line.map((token) => token.text).join(''))
    .join(newline);
}

/**
 * Update a single tool call with live output
 */
function updateToolCallOutput(
  call: TrackedToolCall,
  toolCallId: string,
  outputChunk: string,
): TrackedToolCall {
  if (call.request.callId !== toolCallId || call.status !== 'executing') {
    return call;
  }
  return { ...call, liveOutput: outputChunk } as TrackedExecutingToolCall;
}

/**
 * Apply output update to all tool calls
 */
function applyOutputUpdate(
  prevCalls: TrackedToolCall[],
  toolCallId: string,
  outputChunk: string,
): TrackedToolCall[] {
  // Check if any call would be updated
  const hasMatch = prevCalls.some(
    (call) => call.request.callId === toolCallId && call.status === 'executing',
  );
  if (!hasMatch) {
    return prevCalls;
  }
  return prevCalls.map((call) =>
    updateToolCallOutput(call, toolCallId, outputChunk),
  );
}

/**
 * Transform core tool calls to tracked tool calls
 */
function transformToTrackedCalls(
  updatedCalls: CoreToolCall[],
  prevCalls: TrackedToolCall[],
): TrackedToolCall[] {
  const previousCallMap = new Map(
    prevCalls.map((call) => [call.request.callId, call]),
  );
  return updatedCalls.map((call) => ({
    ...call,
    responseSubmittedToModel:
      previousCallMap.get(call.request.callId)?.responseSubmittedToModel ??
      false,
  })) as TrackedToolCall[];
}

/**
 * Get description from a tool call
 */
function getToolCallDescription(call: TrackedToolCall): string {
  if ('invocation' in call) {
    const invocation = call.invocation as
      | { getDescription(): string }
      | undefined;
    if (invocation) {
      return invocation.getDescription();
    }
  }
  return JSON.stringify(call.request.args);
}

/**
 * Get output from a completed tool call
 */
function getToolCallOutput(call: TrackedToolCall): string | undefined {
  if (
    call.status === 'success' ||
    call.status === 'error' ||
    call.status === 'cancelled'
  ) {
    const completed = call as CompletedToolCall | CancelledToolCall;
    if (completed.response.resultDisplay != null) {
      return typeof completed.response.resultDisplay === 'string'
        ? completed.response.resultDisplay
        : JSON.stringify(completed.response.resultDisplay);
    }
  }
  if (call.status === 'executing') {
    const executing = call as TrackedExecutingToolCall;
    return executing.liveOutput;
  }
  return undefined;
}

/**
 * Get error message from a failed tool call
 */
function getToolCallError(call: TrackedToolCall): string | undefined {
  if (call.status === 'error') {
    const completed = call as CompletedToolCall;
    const error = completed.response.error;
    if (error) {
      return error.message;
    }
  }
  return undefined;
}

/**
 * Convert a TrackedToolCall to ToolCallDisplayInfo
 */
function toDisplayInfo(call: TrackedToolCall): ToolCallDisplayInfo {
  const displayName = call.tool?.displayName ?? call.request.name;
  const description = getToolCallDescription(call);
  const output = getToolCallOutput(call);
  const errorMessage = getToolCallError(call);

  const result: ToolCallDisplayInfo = {
    callId: call.request.callId,
    name: call.request.name,
    displayName,
    description,
    status: mapCoreStatusToToolStatus(call.status),
  };

  if (output !== undefined) {
    result.output = output;
  }
  if (errorMessage !== undefined) {
    result.errorMessage = errorMessage;
  }
  if (call.status === 'awaiting_approval') {
    const waiting = call as WaitingToolCall;
    result.confirmationDetails = waiting.confirmationDetails;
  }

  return result;
}

/**
 * Mark specified tool calls as submitted
 */
function markCallsAsSubmitted(
  prevCalls: TrackedToolCall[],
  callIdsToMark: string[],
): TrackedToolCall[] {
  const hasMatch = prevCalls.some((call) =>
    callIdsToMark.includes(call.request.callId),
  );
  if (!hasMatch) {
    return prevCalls;
  }
  return prevCalls.map((call) => {
    if (callIdsToMark.includes(call.request.callId)) {
      return { ...call, responseSubmittedToModel: true };
    }
    return call;
  });
}

/**
 * Hook that wraps CoreToolScheduler for React usage.
 * Handles tool execution lifecycle with confirmation support.
 */
export function useToolScheduler(
  config: Config | null,
  onAllToolCallsComplete: OnCompleteCallback,
  onToolCallsUpdate?: OnUpdateCallback,
): UseToolSchedulerResult {
  const [toolCalls, setToolCalls] = useState<TrackedToolCall[]>([]);
  const schedulerRef = useRef<CoreToolScheduler | null>(null);
  const pendingScheduleRequests = useRef<
    {
      request: ToolCallRequestInfo | ToolCallRequestInfo[];
      signal: AbortSignal;
    }[]
  >([]);

  // Use refs to store callbacks so they don't trigger effect re-runs
  const onCompleteRef = useRef<OnCompleteCallback>(onAllToolCallsComplete);
  const onUpdateRef = useRef<OnUpdateCallback | undefined>(onToolCallsUpdate);

  // Keep refs in sync with props
  useEffect(() => {
    onCompleteRef.current = onAllToolCallsComplete;
  }, [onAllToolCallsComplete]);

  useEffect(() => {
    onUpdateRef.current = onToolCallsUpdate;
  }, [onToolCallsUpdate]);

  // Create scheduler when config changes
  useEffect(() => {
    if (!config) {
      schedulerRef.current = null;
      return;
    }

    const sessionId = config.getSessionId();
    let mounted = true;

    const handleOutputUpdate = (
      toolCallId: string,
      outputChunk: string | AnsiOutput,
    ): void => {
      if (!mounted) {
        return;
      }
      const text =
        typeof outputChunk === 'string'
          ? outputChunk
          : ansiOutputToText(outputChunk);
      setToolCalls((prev) => applyOutputUpdate(prev, toolCallId, text));
    };

    const handleToolCallsUpdate = (updatedCalls: CoreToolCall[]): void => {
      if (!mounted) {
        return;
      }
      setToolCalls((prevCalls) => {
        if (updatedCalls.length === 0) {
          return [];
        }
        const newCalls = transformToTrackedCalls(updatedCalls, prevCalls);
        const updateCallback = onUpdateRef.current;
        if (updateCallback) {
          updateCallback(newCalls);
        }
        return newCalls;
      });
    };

    const handleAllComplete = async (
      completedToolCalls: CompletedToolCall[],
    ): Promise<void> => {
      if (!mounted) {
        return;
      }
      logger.debug(
        'handleAllComplete called',
        'toolCount:',
        completedToolCalls.length,
      );
      if (completedToolCalls.length > 0) {
        logger.debug('handleAllComplete: calling onCompleteRef.current');
        await onCompleteRef.current(completedToolCalls);
        logger.debug('handleAllComplete: onCompleteRef.current returned');
      } else {
        logger.debug(
          'handleAllComplete: no completed tools, skipping callback',
        );
      }
      handleToolCallsUpdate([]);
    };

    // Use the singleton scheduler from config to ensure all schedulers in a session
    // share the same CoreToolScheduler instance, avoiding duplicate MessageBus
    // subscriptions and "unknown correlationId" errors.
    const initializeScheduler = async () => {
      try {
        const scheduler = await config.getOrCreateScheduler(sessionId, {
          outputUpdateHandler: handleOutputUpdate,
          onAllToolCallsComplete: handleAllComplete,
          onToolCallsUpdate: handleToolCallsUpdate,
          getPreferredEditor: () => undefined,
          onEditorClose: () => {
            /* no-op */
          },
        });

        if (!mounted) {
          config.disposeScheduler(sessionId);
          return;
        }

        schedulerRef.current = scheduler;

        if (pendingScheduleRequests.current.length > 0) {
          for (const { request, signal } of pendingScheduleRequests.current) {
            if (signal.aborted) {
              continue;
            }
            void scheduler.schedule(request, signal);
          }
          pendingScheduleRequests.current = [];
        }
      } catch (error) {
        logger.error('Failed to initialize scheduler:', error);
        if (mounted) {
          schedulerRef.current = null;
        }
      }
    };

    void initializeScheduler();

    return () => {
      mounted = false;
      config.disposeScheduler(sessionId);
      schedulerRef.current = null;
    };
  }, [config]);

  // Schedule new tool calls
  const schedule: ScheduleFn = useCallback(
    (
      request: ToolCallRequestInfo | ToolCallRequestInfo[],
      signal: AbortSignal,
    ) => {
      const scheduler = schedulerRef.current;
      if (scheduler) {
        void scheduler.schedule(request, signal);
        return;
      }

      pendingScheduleRequests.current.push({ request, signal });
    },
    [],
  );

  // Mark tools as submitted to the model
  const markToolsAsSubmitted: MarkToolsAsSubmittedFn = useCallback(
    (callIdsToMark: string[]) => {
      if (callIdsToMark.length > 0) {
        setToolCalls((prev) => markCallsAsSubmitted(prev, callIdsToMark));
      }
    },
    [],
  );

  // Cancel all pending tool calls
  const cancelAll: CancelAllFn = useCallback(() => {
    const scheduler = schedulerRef.current;
    if (scheduler !== null) {
      // Cast needed as types may be out of sync with runtime
      (scheduler as unknown as { cancelAll(): void }).cancelAll();
    }
  }, []);

  // Get tool display info for UI rendering
  const getToolDisplayInfo = useCallback((): ToolCallDisplayInfo[] => {
    return toolCalls.map(toDisplayInfo);
  }, [toolCalls]);

  // Respond to a tool confirmation request
  const respondToConfirmation: RespondToConfirmationFn = useCallback(
    (callId: string, outcome: ToolConfirmationOutcome) => {
      logger.debug(
        'respondToConfirmation called',
        'callId:',
        callId,
        'outcome:',
        outcome,
      );

      // Find the tool call with matching callId that is awaiting approval
      const toolCall = toolCalls.find(
        (tc) =>
          tc.request.callId === callId && tc.status === 'awaiting_approval',
      );

      if (!toolCall) {
        logger.warn(
          'respondToConfirmation: tool call not found or not awaiting approval',
          'callId:',
          callId,
        );
        return;
      }

      const waitingCall = toolCall as WaitingToolCall;
      logger.debug('Calling onConfirm callback', 'callId:', callId);
      void waitingCall.confirmationDetails.onConfirm(outcome);
    },
    [toolCalls],
  );

  return {
    toolCalls,
    schedule,
    markToolsAsSubmitted,
    cancelAll,
    getToolDisplayInfo,
    respondToConfirmation,
  };
}
