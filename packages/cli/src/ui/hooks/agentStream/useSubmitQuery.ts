/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * useSubmitQuery — extracted submit query orchestration from useAgentStream.
 * Contains the submitQuery callback, queued-submission scheduling,
 * submitQueryRef update effect, idle-queue-drain effect, and
 * async-task-auto-trigger effect.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';
import {
  type MessageSenderType,
  type RecordingIntegration,
  type ThinkingBlock,
  type ThoughtSummary,
  type ToolCallRequestInfo,
  type AgentRequestInput,
} from '@vybestack/llxprt-code-core';
import {
  StreamingState,
  type HistoryItem,
  type HistoryItemWithoutId,
  type SlashCommandProcessorResult,
} from '../../types.js';
import { isSlashCommand } from '../../utils/commandUtils.js';
import { useSessionStats } from '../../contexts/SessionContext.js';
import { useStreamEventHandlers } from './useStreamEventHandlers.js';
import { dispatchAgentEvent } from './agentEventDispatcher.js';
import type { AgentEventRouter } from './useAgentEventStream.js';
import {
  resolveContentPrefixIdentity,
  createCliModelIdentityRuntime,
} from '../../utils/modelIdentity.js';
import type { QueuedSubmission } from './types.js';
import type { StreamRuntime, UiSubagentManager } from '../../cliUiRuntime.js';
import { observeAgentEvent } from '../../../observation/jspWiring.js';

import type { PendingResponseBuffer } from './pendingResponseBuffer.js';
import type { OperationLifecycleRegistry } from './operationLifecycle.js';
import {
  runSubmitQueryCore,
  finaliseOnceAfterBegin,
  isCurrentTurn,
  type TurnInit,
  type SubmitQueryCallbackDeps,
} from './submitQueryTurnLifecycle.js';
export type SubmissionDisposition =
  | 'consumed'
  | 'requeue'
  | 'requeue-await-event';

const MAX_QUEUED_SUBMISSION_RETRIES = 3;
// A one-second pause avoids a tight failure loop while keeping transient
// submitter-initialization races responsive.
const QUEUED_SUBMISSION_RETRY_DELAY_MS = 1000;

export type SubmissionExecutor = (
  query: AgentRequestInput,
  options?: { isContinuation: boolean },
  prompt_id?: string,
  fromQueue?: boolean,
) => Promise<SubmissionDisposition>;

/**
 * Shared content-prefix identity resolver for the AgentEvent dispatcher. Reads
 * fresh runtime state at call time so a single stable reference can be reused.
 */
function defaultGetContentPrefixIdentity(): string | null {
  try {
    return resolveContentPrefixIdentity(createCliModelIdentityRuntime());
  } catch {
    return null;
  }
}

export interface UseSubmitQueryDeps {
  runtime: StreamRuntime;
  agent: Agent;
  addItem: (
    item: Omit<HistoryItem, 'id'>,
    timestamp?: number,
    isResuming?: boolean,
  ) => number;
  removeItems?: (ids: readonly number[]) => void;
  settings: Parameters<typeof useStreamEventHandlers>[0]['settings'];
  onDebugMessage: (message: string) => void;
  onCancelSubmit: (shouldRestorePrompt?: boolean) => void;
  onAuthError: () => void;
  recordingIntegration?: RecordingIntegration;
  sanitizeContent: (text: string) => {
    text: string;
    blocked: boolean;
    feedback?: string;
  };
  flushPendingHistoryItem: (timestamp: number) => void;
  pendingResponse: PendingResponseBuffer;
  pendingHistoryItemRef: React.MutableRefObject<HistoryItemWithoutId | null>;
  thinkingBlocksRef: React.MutableRefObject<ThinkingBlock[]>;
  turnCancelledRef: React.MutableRefObject<boolean>;
  drainSuppressedRef: React.MutableRefObject<boolean>;
  setTurnCancelled: (value: boolean) => void;
  queuedSubmissionsRef: React.MutableRefObject<QueuedSubmission[]>;
  enqueueSubmission: (submission: QueuedSubmission) => void;
  requeueSubmission: (submission: QueuedSubmission) => void;
  dequeueSubmission: () => QueuedSubmission | undefined;
  clearSubmissions: () => void;
  tryReserveDrain: () => boolean;
  releaseDrain: () => void;
  setPendingHistoryItem: React.Dispatch<
    React.SetStateAction<HistoryItemWithoutId | null>
  >;
  setIsResponding: React.Dispatch<React.SetStateAction<boolean>>;
  setInitError: React.Dispatch<React.SetStateAction<string | null>>;
  setThought: React.Dispatch<React.SetStateAction<ThoughtSummary | null>>;
  setLastAgentActivityTime: React.Dispatch<React.SetStateAction<number>>;
  scheduleToolCalls: (
    requests: ToolCallRequestInfo[],
    signal: AbortSignal,
  ) => Promise<void>;
  abortActiveStream: (reason?: unknown) => void;
  handleShellCommand: (query: string, signal: AbortSignal) => boolean;
  handleSlashCommand: (
    cmd: AgentRequestInput,
  ) => Promise<SlashCommandProcessorResult | false>;
  logger:
    | { logMessage: (sender: MessageSenderType, text: string) => Promise<void> }
    | null
    | undefined;
  shellModeActive: boolean;
  loopDetectedRef: React.MutableRefObject<boolean>;
  lastProfileNameRef: React.MutableRefObject<string | undefined>;
  lastModelInfoRef: React.MutableRefObject<string | null>;
  lastModelIdentityRef: React.MutableRefObject<string | null>;
  abortControllerRef: React.MutableRefObject<AbortController | null>;
  subagentManager?: UiSubagentManager;
  /**
   * Ref to the Agent event-stream runner. Held as a ref to break the circular
   * dependency: runStream comes from useAgentEventStream which needs
   * processAgentEvent from useStreamEventHandlers (created inside this hook).
   * The ref is populated synchronously during render and read at call time.
   */
  runStreamRef: React.MutableRefObject<
    | ((
        message: AgentRequestInput,
        signal: AbortSignal,
        promptId: string,
      ) => Promise<void>)
    | null
  >;
  submitQueryRef: React.MutableRefObject<SubmissionExecutor | null>;
  isResponding: boolean;
  streamingState: StreamingState;
  /**
   * Optional operation lifecycle registry for perf telemetry (P06). When
   * undefined (perf disabled), no lifecycle instrumentation occurs. Supplied
   * later by P12 integration wiring.
   */
  operationLifecycle?: OperationLifecycleRegistry;
}

export interface UseSubmitQueryReturn {
  submitQuery: (
    query: AgentRequestInput,
    options?: { isContinuation: boolean },
    prompt_id?: string,
  ) => Promise<void>;
  scheduleNextQueuedSubmission: () => void;
  /** Processes a single AgentEvent into React state (for the event-stream router). */
  processAgentEvent: AgentEventRouter;
  displayUserMessage: (
    trimmedQuery: string,
    userMessageTimestamp: number,
  ) => void;
  prepareQueryForAgent: (
    query: AgentRequestInput,
    userMessageTimestamp: number,
    abortSignal: AbortSignal,
    promptId: string,
  ) => Promise<{
    queryToSend: AgentRequestInput | null;
    shouldProceed: boolean;
  }>;
  handleLoopDetectedEvent: () => void;
}

export function useSubmitQuery(deps: UseSubmitQueryDeps): UseSubmitQueryReturn {
  const { startNewPrompt, getPromptCount } = useSessionStats();
  const activeTurnRef = useRef(false);

  const handlers = useStreamEventHandlers({
    runtime: deps.runtime,
    agent: deps.agent,
    settings: deps.settings,
    addItem: deps.addItem,
    removeItems: deps.removeItems,
    onDebugMessage: deps.onDebugMessage,
    onCancelSubmit: deps.onCancelSubmit,
    sanitizeContent: deps.sanitizeContent,
    flushPendingHistoryItem: deps.flushPendingHistoryItem,
    pendingResponse: deps.pendingResponse,
    pendingHistoryItemRef: deps.pendingHistoryItemRef,
    thinkingBlocksRef: deps.thinkingBlocksRef,
    turnCancelledRef: deps.turnCancelledRef,
    clearSubmissions: deps.clearSubmissions,
    setPendingHistoryItem: deps.setPendingHistoryItem,
    setIsResponding: deps.setIsResponding,
    setThought: deps.setThought,
    setLastAgentActivityTime: deps.setLastAgentActivityTime,
    scheduleToolCalls: deps.scheduleToolCalls,
    abortActiveStream: deps.abortActiveStream,
    handleShellCommand: deps.handleShellCommand,
    handleSlashCommand: deps.handleSlashCommand,
    logger: deps.logger,
    shellModeActive: deps.shellModeActive,
    loopDetectedRef: deps.loopDetectedRef,
    lastProfileNameRef: deps.lastProfileNameRef,
    lastModelInfoRef: deps.lastModelInfoRef,
    lastModelIdentityRef: deps.lastModelIdentityRef,
    subagentManager: deps.subagentManager,
  });

  const processAgentEvent = useProcessAgentEvent(deps, handlers, activeTurnRef);

  const scheduleNextQueuedSubmission = useScheduleNext(deps, activeTurnRef);

  const executeSubmission = useSubmitQueryCallback({
    ...deps,
    displayUserMessage: handlers.displayUserMessage,
    prepareQueryForAgent: handlers.prepareQueryForAgent,
    handleLoopDetectedEvent: handlers.handleLoopDetectedEvent,
    startNewPrompt,
    getPromptCount,
    activeTurnRef,
    scheduleNextQueuedSubmission,
  });
  const submitQuery = useCallback<UseSubmitQueryReturn['submitQuery']>(
    async (query, options, promptId) => {
      // Dispositions are an internal queue-drain protocol; the public API
      // intentionally remains Promise<void> for existing callers.
      await executeSubmission(query, options, promptId);
    },
    [executeSubmission],
  );

  useSubmitQueryEffects(deps, executeSubmission, scheduleNextQueuedSubmission);

  return {
    submitQuery,
    scheduleNextQueuedSubmission,
    processAgentEvent,
    displayUserMessage: handlers.displayUserMessage,
    prepareQueryForAgent: handlers.prepareQueryForAgent,
    handleLoopDetectedEvent: handlers.handleLoopDetectedEvent,
  };
}

function useProcessAgentEvent(
  deps: UseSubmitQueryDeps,
  handlers: Pick<
    ReturnType<typeof useStreamEventHandlers>,
    | 'handleContentEvent'
    | 'handleStreamAttemptDiscarded'
    | 'handleUserCancelledEvent'
    | 'handleErrorEvent'
    | 'handleChatCompressionEvent'
    | 'handleFinishedNotice'
    | 'handleMaxSessionTurnsEvent'
    | 'handleContextWindowWillOverflowEvent'
    | 'handleCitationEvent'
  >,
  activeTurnRef: React.MutableRefObject<boolean>,
) {
  const agentBufferRef = useRef('');
  // Latest-ref pattern: store deps+handlers in a ref so the useCallback
  // never needs to change identity (avoids recreating every render).
  const latestDeps = useRef(deps);
  latestDeps.current = deps;
  const latestHandlers = useRef(handlers);
  latestHandlers.current = handlers;
  return useCallback<AgentEventRouter>(
    (event, userMessageTimestamp, signal) => {
      if (!isCurrentTurn(latestDeps.current, signal)) {
        return;
      }
      // P07: live phase tracking for granular cancellation classification is
      // routed OUTSIDE this handler's call site (via the
      // onAgentEventObserved callback in useAgentEventStream, invoked directly
      // outside the generic catch — D8). It must NOT live inside
      // processAgentEvent, where it could be swallowed by this handler's
      // callers. See useAgentStreamOrchestration.useEventStreamForAgent.
      // Release the interactive active-turn gate and responding state BEFORE
      // dispatching fallible event rendering for terminal public Agent
      // error/idle-timeout events. If rendering throws, the gate must already
      // be released so follow-up submissions are not queued while the
      // iterator/promise settles (issue #2954). The dispatcher preserves the
      // existing error-queue-clearing / idle-timeout-queue-preservation
      // semantics via handleErrorEvent's clearQueue option.
      const isTerminal =
        event.type === 'error' || event.type === 'idle-timeout';
      if (isTerminal) {
        activeTurnRef.current = false;
        latestDeps.current.setIsResponding(false);
        agentBufferRef.current = '';
      }
      observeAgentEvent(event);
      const result = dispatchAgentEvent(
        event,
        {
          addItem: latestDeps.current.addItem,
          sanitizeContent: latestDeps.current.sanitizeContent,
          flushPendingHistoryItem: latestDeps.current.flushPendingHistoryItem,
          pendingResponse: latestDeps.current.pendingResponse,
          pendingHistoryItemRef: latestDeps.current.pendingHistoryItemRef,
          thinkingBlocksRef: latestDeps.current.thinkingBlocksRef,
          turnCancelledRef: latestDeps.current.turnCancelledRef,
          loopDetectedRef: latestDeps.current.loopDetectedRef,
          lastModelInfoRef: latestDeps.current.lastModelInfoRef,
          lastModelIdentityRef: latestDeps.current.lastModelIdentityRef,
          setPendingHistoryItem: latestDeps.current.setPendingHistoryItem,
          setLastAgentActivityTime: latestDeps.current.setLastAgentActivityTime,
          setThought: latestDeps.current.setThought,
          getContentPrefixIdentity: defaultGetContentPrefixIdentity,
          ...latestHandlers.current,
        },
        agentBufferRef.current,
        userMessageTimestamp,
      );
      agentBufferRef.current = result.agentMessageBuffer;
    },
    [activeTurnRef],
  );
}

function useSubmitQueryEffects(
  deps: UseSubmitQueryDeps,
  submitQuery: ReturnType<typeof useSubmitQueryCallback>,
  scheduleNextQueuedSubmission: () => void,
) {
  const { submitQueryRef, streamingState, runtime, enqueueSubmission } = deps;
  useEffect(() => {
    submitQueryRef.current = submitQuery;
  }, [submitQuery, submitQueryRef]);

  useEffect(() => {
    if (streamingState === StreamingState.Idle) {
      scheduleNextQueuedSubmission();
    }
  }, [streamingState, scheduleNextQueuedSubmission]);

  useEffect(() => {
    const unsubscribe = runtime.events.onMcpClientUpdate(
      scheduleNextQueuedSubmission,
    );
    return () => {
      unsubscribe();
    };
  }, [runtime, scheduleNextQueuedSubmission]);

  useEffect(() => {
    const isAgentBusy = () => streamingState !== StreamingState.Idle;
    const triggerAgentTurn = async (message: string) => {
      enqueueSubmission({
        query: [{ type: 'text', text: message }],
      });
      scheduleNextQueuedSubmission();
    };

    const unsubscribe = runtime.asyncTasks.setupAsyncTaskAutoTrigger(
      isAgentBusy,
      triggerAgentTurn,
    );

    return () => {
      unsubscribe();
    };
  }, [
    runtime,
    streamingState,
    scheduleNextQueuedSubmission,
    enqueueSubmission,
  ]);
}

function useDrainCleanup(
  drainTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
  retryTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
  pendingSubmissionRef: React.MutableRefObject<QueuedSubmission | null>,
  mountedRef: React.MutableRefObject<boolean>,
  requeueSubmission: (submission: QueuedSubmission) => void,
  releaseDrain: () => void,
) {
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (drainTimeoutRef.current !== null) {
        clearTimeout(drainTimeoutRef.current);
        drainTimeoutRef.current = null;
      }
      if (retryTimeoutRef.current !== null) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      if (pendingSubmissionRef.current !== null) {
        requeueSubmission(pendingSubmissionRef.current);
        pendingSubmissionRef.current = null;
        releaseDrain();
      }
    };
  }, [
    drainTimeoutRef,
    retryTimeoutRef,
    mountedRef,
    pendingSubmissionRef,
    releaseDrain,
    requeueSubmission,
  ]);
}

function useDrainSubmission(
  drainTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
  retryTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
  pendingSubmissionRef: React.MutableRefObject<QueuedSubmission | null>,
  retryCountRef: React.MutableRefObject<number>,
  scheduleRef: React.MutableRefObject<() => void>,
  submitQueryRef: UseSubmitQueryDeps['submitQueryRef'],
  requeueSubmission: UseSubmitQueryDeps['requeueSubmission'],
  releaseDrain: UseSubmitQueryDeps['releaseDrain'],
) {
  return useCallback(
    async (next: QueuedSubmission): Promise<void> => {
      drainTimeoutRef.current = null;
      let disposition: SubmissionDisposition = 'requeue-await-event';
      try {
        const submit = submitQueryRef.current;
        if (submit === null) {
          debugLogger.error(
            'Cannot drain queued submission before the submitter is ready.',
          );
        } else {
          disposition = await submit(
            next.query,
            next.options,
            next.promptId,
            true,
          );
        }
      } catch (error: unknown) {
        debugLogger.error('Queued submission failed unexpectedly:', error);
      } finally {
        const ownsPendingSubmission = pendingSubmissionRef.current === next;
        const shouldRetry =
          ownsPendingSubmission &&
          disposition === 'requeue-await-event' &&
          retryCountRef.current < MAX_QUEUED_SUBMISSION_RETRIES;
        const retryLimitReached =
          ownsPendingSubmission &&
          disposition === 'requeue-await-event' &&
          !shouldRetry;

        if (ownsPendingSubmission) {
          pendingSubmissionRef.current = null;
          if (disposition !== 'consumed' && !retryLimitReached) {
            requeueSubmission(next);
          }
          releaseDrain();
        }

        if (shouldRetry) {
          retryCountRef.current += 1;
          retryTimeoutRef.current = setTimeout(() => {
            retryTimeoutRef.current = null;
            scheduleRef.current();
          }, QUEUED_SUBMISSION_RETRY_DELAY_MS);
        }

        if (ownsPendingSubmission && !shouldRetry) {
          retryCountRef.current = 0;
          if (retryLimitReached) {
            debugLogger.error(
              'Dropping queued submission after repeated drain failures.',
            );
          }
          scheduleRef.current();
        }
      }
    },
    [
      drainTimeoutRef,
      retryTimeoutRef,
      pendingSubmissionRef,
      retryCountRef,
      scheduleRef,
      submitQueryRef,
      requeueSubmission,
      releaseDrain,
    ],
  );
}

function useScheduleNext(
  deps: UseSubmitQueryDeps,
  activeTurnRef: React.MutableRefObject<boolean>,
) {
  const {
    queuedSubmissionsRef,
    dequeueSubmission,
    requeueSubmission,
    submitQueryRef,
    tryReserveDrain,
    releaseDrain,
    drainSuppressedRef,
  } = deps;
  const drainTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSubmissionRef = useRef<QueuedSubmission | null>(null);
  const retryCountRef = useRef(0);
  const mountedRef = useRef(true);
  // The mutable indirection breaks the schedule/drain callback cycle while
  // allowing delayed retries to invoke the latest stable scheduler.
  const scheduleRef = useRef<() => void>(() => undefined);
  const streamingStateRef = useRef(deps.streamingState);
  streamingStateRef.current = deps.streamingState;
  useDrainCleanup(
    drainTimeoutRef,
    retryTimeoutRef,
    pendingSubmissionRef,
    mountedRef,
    requeueSubmission,
    releaseDrain,
  );

  const drainSubmission = useDrainSubmission(
    drainTimeoutRef,
    retryTimeoutRef,
    pendingSubmissionRef,
    retryCountRef,
    scheduleRef,
    submitQueryRef,
    requeueSubmission,
    releaseDrain,
  );

  const schedule = useCallback(() => {
    const queueEmpty = queuedSubmissionsRef.current.length === 0;
    const busyOrNotIdle =
      activeTurnRef.current ||
      streamingStateRef.current !== StreamingState.Idle;
    const cannotDrain =
      !mountedRef.current ||
      busyOrNotIdle ||
      queueEmpty ||
      drainSuppressedRef.current;
    if (cannotDrain || !tryReserveDrain()) {
      return;
    }
    if (retryTimeoutRef.current !== null) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }

    const next = dequeueSubmission();
    if (!next) {
      releaseDrain();
      return;
    }
    pendingSubmissionRef.current = next;
    drainTimeoutRef.current = setTimeout(() => {
      void drainSubmission(next);
    }, 0);
  }, [
    activeTurnRef,
    queuedSubmissionsRef,
    retryTimeoutRef,
    dequeueSubmission,
    drainSubmission,
    tryReserveDrain,
    releaseDrain,
    drainSuppressedRef,
  ]);
  scheduleRef.current = schedule;
  return schedule;
}

function useSubmitQueryCallback(cbd: SubmitQueryCallbackDeps) {
  // Keep the callback identity stable while every invocation reads current deps.
  const latestCbdRef = useRef(cbd);
  latestCbdRef.current = cbd;
  return useCallback<SubmissionExecutor>(
    async (query, options, promptId, fromQueue = false) => {
      const current = latestCbdRef.current;
      // submitQuery handles NEW user prompts only; the Agent's event stream
      // drives multi-turn continuation internally.
      void options;

      if (
        current.activeTurnRef.current ||
        isQueueable(current.streamingState)
      ) {
        if (fromQueue) {
          return 'requeue';
        }
        current.enqueueSubmission({
          query,
          promptId,
        });
        return 'consumed';
      }

      current.activeTurnRef.current = true;
      // Starting a fresh user-initiated turn resumes normal drain behavior.
      // A cancel may have suppressed draining to keep queued messages in the
      // drawer; the user explicitly submitting a new message signals intent
      // to resume automatic processing.
      current.drainSuppressedRef.current = false;
      // Install the turn's AbortController BEFORE any potentially throwing
      // initialization so the outer finally can verify ownership even when
      // initTurn rejects. The signal is captured immediately so a throw
      // inside initTurn cannot leave the gate locked (issue #2954).
      const turnController = new AbortController();
      current.abortControllerRef.current = turnController;
      const turnSignal = turnController.signal;
      try {
        const turn = initTurn(
          current,
          query,
          promptId,
          current.getPromptCount,
          turnSignal,
        );
        current.operationLifecycle?.begin(turnSignal, turn.promptId);
        // Once `begin` has succeeded, any throw before `runSubmitQueryCore`
        // must finalise the operation exactly once as 'error' so the registry
        // record is not leaked. `displayUserMessage` is the only fallible step
        // here; if it throws, the original failure is preserved and, should
        // finalisation also fail, both errors surface via AggregateError.
        if (shouldDisplayUserMessage(turn.trimmedStr)) {
          try {
            current.displayUserMessage(
              turn.trimmedStr,
              turn.userMessageTimestamp,
            );
          } catch (displayError) {
            await finaliseOnceAfterBegin(
              current.operationLifecycle,
              turnSignal,
              displayError,
              'Display user message failed',
            );
          }
        }

        await runSubmitQueryCore(current, query, turn);
        return 'consumed';
      } finally {
        // Guard against stale cleanup: a terminal error/idle-timeout event
        // may have already released interactive ownership, allowing a newer
        // turn to start and replace abortControllerRef.current. If this turn
        // no longer owns the current AbortController, clearing ownership or
        // scheduling a drain would clobber the newer turn (issue #2954).
        if (isCurrentTurn(current, turnSignal)) {
          current.activeTurnRef.current = false;
          current.scheduleNextQueuedSubmission();
        }
      }
    },
    [],
  );
}

function isQueueable(streamingState: StreamingState): boolean {
  return (
    streamingState === StreamingState.Responding ||
    streamingState === StreamingState.WaitingForConfirmation
  );
}

function shouldDisplayUserMessage(trimmedStr: string): boolean {
  return !!trimmedStr && !isSlashCommand(trimmedStr);
}

function initTurn(
  deps: UseSubmitQueryDeps,
  query: AgentRequestInput,
  promptId: string | undefined,
  getPromptCount: () => number,
  abortSignal: AbortSignal,
): TurnInit {
  const userMessageTimestamp = Date.now();
  deps.setTurnCancelled(false);
  deps.loopDetectedRef.current = false;

  const resolvedPromptId =
    promptId ??
    deps.runtime.session.getSessionId() + '########' + getPromptCount();

  const trimmedStr = typeof query === 'string' ? query.trim() : '';

  return {
    userMessageTimestamp,
    abortSignal,
    promptId: resolvedPromptId,
    trimmedStr,
  };
}
