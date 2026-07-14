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
  submitQueryRef: React.MutableRefObject<
    | ((
        query: AgentRequestInput,
        options?: { isContinuation: boolean },
        prompt_id?: string,
      ) => Promise<void>)
    | null
  >;
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
    queuedSubmissionsRef: deps.queuedSubmissionsRef,
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

  const scheduleNextQueuedSubmission = useScheduleNext(deps);

  const submitQuery = useSubmitQueryCallback({
    ...deps,
    displayUserMessage: handlers.displayUserMessage,
    prepareQueryForAgent: handlers.prepareQueryForAgent,
    handleLoopDetectedEvent: handlers.handleLoopDetectedEvent,
    scheduleNextQueuedSubmission,
    startNewPrompt,
    getPromptCount,
  });

  useSubmitQueryEffects(deps, submitQuery, scheduleNextQueuedSubmission);

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
  useEffect(() => {
    deps.submitQueryRef.current = submitQuery;
  }, [submitQuery, deps.submitQueryRef]);

  useEffect(() => {
    if (deps.streamingState === StreamingState.Idle) {
      scheduleNextQueuedSubmission();
    }
  }, [deps.streamingState, scheduleNextQueuedSubmission]);

  useEffect(() => {
    const isAgentBusy = () => deps.streamingState !== StreamingState.Idle;
    const triggerAgentTurn = async (message: string) => {
      deps.queuedSubmissionsRef.current.push({
        query: [{ type: 'text', text: message }],
      });
      scheduleNextQueuedSubmission();
    };

    const unsubscribe = deps.runtime.asyncTasks.setupAsyncTaskAutoTrigger(
      isAgentBusy,
      triggerAgentTurn,
    );

    return () => {
      unsubscribe();
    };
  }, [
    deps.runtime,
    deps.streamingState,
    scheduleNextQueuedSubmission,
    deps.queuedSubmissionsRef,
  ]);
}

function useScheduleNext(deps: UseSubmitQueryDeps) {
  return useCallback(() => {
    if (deps.queuedSubmissionsRef.current.length === 0) {
      return;
    }

    const next = deps.queuedSubmissionsRef.current.shift();
    if (!next) {
      return;
    }

    setTimeout(() => {
      void deps.submitQueryRef.current?.(
        next.query,
        next.options,
        next.promptId,
      );
    }, 0);
  }, [deps.queuedSubmissionsRef, deps.submitQueryRef]);
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
  scheduleNextQueuedSubmission: () => void;
  startNewPrompt: () => void;
  getPromptCount: () => number;
}

function useSubmitQueryCallback(cbd: SubmitQueryCallbackDeps) {
  return useCallback(
    async (
      query: AgentRequestInput,
      options?: { isContinuation: boolean },
      prompt_id?: string,
    ) => {
      // submitQuery handles NEW user prompts only; the Agent's event stream
      // drives multi-turn continuation internally.
      void options;

      if (isQueueable(cbd.streamingState)) {
        cbd.queuedSubmissionsRef.current.push({
          query,
          promptId: prompt_id,
        });
        return;
      }

      const turn = initTurn(cbd, query, prompt_id, cbd.getPromptCount);

      if (shouldDisplayUserMessage(turn.trimmedStr)) {
        cbd.displayUserMessage(turn.trimmedStr, turn.userMessageTimestamp);
      }

      await runSubmitQueryCore(cbd, query, turn);
    },
    [cbd],
  );
}

async function runSubmitQueryCore(
  cbd: SubmitQueryCallbackDeps,
  query: AgentRequestInput,
  turn: TurnInit,
): Promise<void> {
  const { queryToSend, shouldProceed } = await cbd.prepareQueryForAgent(
    query,
    turn.userMessageTimestamp,
    turn.abortSignal,
    turn.promptId,
  );
  if (!shouldProceed || queryToSend === null) {
    cbd.scheduleNextQueuedSubmission();
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

  try {
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
    // Only clear isResponding when this turn is still the active one. When a
    // newer turn supersedes this one it replaces abortControllerRef.current
    // with a fresh AbortController; if the signals differ, the newer turn
    // already set isResponding(true) and clearing it here would cancel the
    // new turn (issue #2259).
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
