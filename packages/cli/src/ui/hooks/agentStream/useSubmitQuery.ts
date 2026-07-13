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
import { handleSubmissionError } from './streamUtils.js';
import { prepareTurnForQuery } from './turnPreparation.js';
import { useStreamEventHandlers } from './useStreamEventHandlers.js';
import { dispatchAgentEvent } from './agentEventDispatcher.js';
import type { AgentEventRouter } from './useAgentEventStream.js';
import {
  resolveContentPrefixIdentity,
  createCliModelIdentityRuntime,
} from '../../utils/modelIdentity.js';
import type { QueuedSubmission } from './types.js';
import type { StreamRuntime } from '../../cliUiRuntime.js';

export type SubmissionDisposition =
  | 'consumed'
  | 'requeue'
  | 'requeue-await-event';

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
  pendingHistoryItemRef: React.MutableRefObject<HistoryItemWithoutId | null>;
  thinkingBlocksRef: React.MutableRefObject<ThinkingBlock[]>;
  turnCancelledRef: React.MutableRefObject<boolean>;
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
    onDebugMessage: deps.onDebugMessage,
    onCancelSubmit: deps.onCancelSubmit,
    sanitizeContent: deps.sanitizeContent,
    flushPendingHistoryItem: deps.flushPendingHistoryItem,
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
  });

  const processAgentEvent = useProcessAgentEvent(deps, handlers);

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
    | 'handleUserCancelledEvent'
    | 'handleErrorEvent'
    | 'handleChatCompressionEvent'
    | 'handleFinishedNotice'
    | 'handleMaxSessionTurnsEvent'
    | 'handleContextWindowWillOverflowEvent'
    | 'handleCitationEvent'
  >,
) {
  const agentBufferRef = useRef('');
  // Latest-ref pattern: store deps+handlers in a ref so the useCallback
  // never needs to change identity (avoids recreating every render).
  const latestDeps = useRef(deps);
  latestDeps.current = deps;
  const latestHandlers = useRef(handlers);
  latestHandlers.current = handlers;
  return useCallback<AgentEventRouter>((event, userMessageTimestamp) => {
    const result = dispatchAgentEvent(
      event,
      {
        addItem: latestDeps.current.addItem,
        sanitizeContent: latestDeps.current.sanitizeContent,
        flushPendingHistoryItem: latestDeps.current.flushPendingHistoryItem,
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
  }, []);
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
      if (pendingSubmissionRef.current !== null) {
        requeueSubmission(pendingSubmissionRef.current);
        pendingSubmissionRef.current = null;
        releaseDrain();
      }
    };
  }, [
    drainTimeoutRef,
    mountedRef,
    pendingSubmissionRef,
    releaseDrain,
    requeueSubmission,
  ]);
}

function useDrainSubmission(
  drainTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
  pendingSubmissionRef: React.MutableRefObject<QueuedSubmission | null>,
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
        if (pendingSubmissionRef.current === next) {
          pendingSubmissionRef.current = null;
          if (disposition !== 'consumed') {
            requeueSubmission(next);
          }
          releaseDrain();
          if (disposition !== 'requeue-await-event') {
            scheduleRef.current();
          }
        }
      }
    },
    [
      drainTimeoutRef,
      pendingSubmissionRef,
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
  } = deps;
  const drainTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSubmissionRef = useRef<QueuedSubmission | null>(null);
  const mountedRef = useRef(true);
  const scheduleRef = useRef<() => void>(() => undefined);
  const streamingStateRef = useRef(deps.streamingState);
  streamingStateRef.current = deps.streamingState;
  useDrainCleanup(
    drainTimeoutRef,
    pendingSubmissionRef,
    mountedRef,
    requeueSubmission,
    releaseDrain,
  );

  const drainSubmission = useDrainSubmission(
    drainTimeoutRef,
    pendingSubmissionRef,
    scheduleRef,
    submitQueryRef,
    requeueSubmission,
    releaseDrain,
  );

  const schedule = useCallback(() => {
    const cannotDrain =
      !mountedRef.current ||
      activeTurnRef.current ||
      streamingStateRef.current !== StreamingState.Idle ||
      queuedSubmissionsRef.current.length === 0;
    if (cannotDrain || !tryReserveDrain()) {
      return;
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
    dequeueSubmission,
    drainSubmission,
    tryReserveDrain,
    releaseDrain,
  ]);
  scheduleRef.current = schedule;
  return schedule;
}

interface SubmitQueryCallbackDeps extends UseSubmitQueryDeps {
  displayUserMessage: (q: string, t: number) => void;
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
  startNewPrompt: () => void;
  getPromptCount: () => number;
  activeTurnRef: React.MutableRefObject<boolean>;
  scheduleNextQueuedSubmission: () => void;
}

function useSubmitQueryCallback(cbd: SubmitQueryCallbackDeps) {
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
      try {
        const turn = initTurn(current, query, promptId, current.getPromptCount);
        if (shouldDisplayUserMessage(turn.trimmedStr)) {
          current.displayUserMessage(
            turn.trimmedStr,
            turn.userMessageTimestamp,
          );
        }

        await runSubmitQueryCore(current, query, turn);
        return 'consumed';
      } finally {
        current.activeTurnRef.current = false;
        current.scheduleNextQueuedSubmission();
      }
    },
    [],
  );
}

async function runSubmitQueryCore(
  cbd: SubmitQueryCallbackDeps,
  query: AgentRequestInput,
  turn: TurnInit,
): Promise<void> {
  try {
    const { queryToSend, shouldProceed } = await cbd.prepareQueryForAgent(
      query,
      turn.userMessageTimestamp,
      turn.abortSignal,
      turn.promptId,
    );
    if (!shouldProceed || queryToSend === null) {
      return;
    }

    await prepareTurnForQuery(
      false,
      cbd.runtime,
      cbd.startNewPrompt,
      cbd.setThought,
      cbd.thinkingBlocksRef,
    );
    cbd.setIsResponding(true);
    cbd.setInitError(null);

    await executeStream(cbd, cbd.handleLoopDetectedEvent, queryToSend, turn);
  } catch (error: unknown) {
    // Only surface errors for the active turn. A superseded turn's stale
    // errors (e.g. AbortError or auth failures from a cancelled request)
    // must not leak into the newer turn (issue #2259).
    if (isCurrentTurn(cbd, turn)) {
      handleSubmissionError(
        error,
        cbd.addItem,
        cbd.runtime,
        cbd.onAuthError,
        turn.userMessageTimestamp,
      );
    }
  } finally {
    if (isCurrentTurn(cbd, turn)) {
      cbd.setIsResponding(false);
    }
    if (isCurrentTurn(cbd, turn)) {
      try {
        await cbd.recordingIntegration?.flushAtTurnBoundary();
      } catch {
        /* non-fatal */
      }
    }
    // The active-turn owner releases and schedules only after this promise
    // settles; scheduleNextQueuedSubmission also requires an Idle render and a
    // drain reservation, so cancellation cannot start overlapping work.
  }
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

interface TurnInit {
  userMessageTimestamp: number;
  abortSignal: AbortSignal;
  promptId: string;
  trimmedStr: string;
}

function initTurn(
  deps: UseSubmitQueryDeps,
  query: AgentRequestInput,
  promptId: string | undefined,
  getPromptCount: () => number,
): TurnInit {
  const userMessageTimestamp = Date.now();
  deps.abortControllerRef.current = new AbortController();
  const abortSignal = deps.abortControllerRef.current.signal;
  deps.turnCancelledRef.current = false;

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

async function executeStream(
  deps: UseSubmitQueryDeps,
  handleLoopDetectedEvent: () => void,
  queryToSend: AgentRequestInput,
  turn: TurnInit,
): Promise<void> {
  const runStream = deps.runStreamRef.current;
  if (!runStream) {
    throw new Error('Agent event-stream runner is not initialized.');
  }

  // The Agent owns the entire multi-turn flow: send → stream → schedule →
  // execute → feed-back → repeat.
  await runStream(queryToSend, turn.abortSignal, turn.promptId);

  // A newer turn may have started while runStream was settling (e.g. the user
  // cancelled this turn and submitted a new prompt). If the current
  // AbortController no longer belongs to this turn, skip post-stream cleanup
  // so it does not clobber the newer turn's state. Clear loopDetectedRef
  // silently to prevent a stale detection from leaking into the new turn
  // (issue #2259).
  if (!isCurrentTurn(deps, turn)) {
    deps.loopDetectedRef.current = false;
    return;
  }

  if (deps.pendingHistoryItemRef.current) {
    deps.flushPendingHistoryItem(turn.userMessageTimestamp);
    deps.setPendingHistoryItem(null);
  }
  if (deps.loopDetectedRef.current) {
    deps.loopDetectedRef.current = false;
    handleLoopDetectedEvent();
  }
}

/**
 * Returns true when `turn` is still the active turn. When a newer turn starts
 * (via initTurn) it replaces abortControllerRef.current with a fresh
 * AbortController; comparing signals proves this turn owns the current
 * AbortController (issue #2259).
 */
function isCurrentTurn(deps: UseSubmitQueryDeps, turn: TurnInit): boolean {
  return deps.abortControllerRef.current?.signal === turn.abortSignal;
}
