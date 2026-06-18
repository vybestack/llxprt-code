/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * useSubmitQuery — extracted submit query orchestration from useGeminiStream.
 * Contains the submitQuery callback, the MCP discovery gate, queued-submission
 * scheduling, submitQueryRef update effect, idle-queue-drain effect, and
 * async-task-auto-trigger effect.
 */

import { useCallback, useEffect } from 'react';
import { MCPDiscoveryState } from '@vybestack/llxprt-code-mcp';
import {
  type Config,
  type AgentClientContract,
  type MessageSenderType,
  type RecordingIntegration,
  type ServerGeminiStreamEvent,
  type ThinkingBlock,
  type ThoughtSummary,
  type ToolCallRequestInfo,
} from '@vybestack/llxprt-code-core';
import { type PartListUnion } from '@google/genai';
import {
  StreamingState,
  type HistoryItem,
  type HistoryItemWithoutId,
  type SlashCommandProcessorResult,
} from '../../types.js';
import { isSlashCommand } from '../../utils/commandUtils.js';
import { useSessionStats } from '../../contexts/SessionContext.js';
import { handleSubmissionError } from './streamUtils.js';
import { prepareTurnForQuery } from './useGeminiStream.js';
import { useStreamEventHandlers } from './useStreamEventHandlers.js';
import type { QueuedSubmission } from './types.js';

export interface UseSubmitQueryDeps {
  config: Config;
  agentClient: AgentClientContract;
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
  setLastGeminiActivityTime: React.Dispatch<React.SetStateAction<number>>;
  scheduleToolCalls: (
    requests: ToolCallRequestInfo[],
    signal: AbortSignal,
  ) => Promise<void>;
  abortActiveStream: (reason?: unknown) => void;
  handleShellCommand: (query: string, signal: AbortSignal) => boolean;
  handleSlashCommand: (
    cmd: PartListUnion,
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
   * Ref to the engine-owned loop runner. Held as a ref to break the circular
   * dependency: runLoop comes from useAgenticLoop which needs processStreamEvent
   * from useStreamEventHandlers (created inside this hook). The ref is populated
   * synchronously during render and read at call time.
   */
  runLoopRef: React.MutableRefObject<
    | ((
        message: PartListUnion,
        signal: AbortSignal,
        promptId: string,
      ) => Promise<void>)
    | null
  >;
  submitQueryRef: React.MutableRefObject<
    | ((
        query: PartListUnion,
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
    query: PartListUnion,
    options?: { isContinuation: boolean },
    prompt_id?: string,
  ) => Promise<void>;
  scheduleNextQueuedSubmission: () => void;
  /** Processes a single stream event (for the AgenticLoop router). */
  processStreamEvent: (
    event: ServerGeminiStreamEvent,
    userMessageTimestamp: number,
  ) => void;
  displayUserMessage: (
    trimmedQuery: string,
    userMessageTimestamp: number,
  ) => void;
  prepareQueryForGemini: (
    query: PartListUnion,
    userMessageTimestamp: number,
    abortSignal: AbortSignal,
    promptId: string,
  ) => Promise<{
    queryToSend: PartListUnion | null;
    shouldProceed: boolean;
  }>;
  handleLoopDetectedEvent: () => void;
}

export function useSubmitQuery(deps: UseSubmitQueryDeps): UseSubmitQueryReturn {
  const { startNewPrompt, getPromptCount } = useSessionStats();

  const {
    processStreamEvent,
    displayUserMessage,
    prepareQueryForGemini,
    handleLoopDetectedEvent,
  } = useStreamEventHandlers({
    config: deps.config,
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
    setLastGeminiActivityTime: deps.setLastGeminiActivityTime,
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

  const scheduleNextQueuedSubmission = useScheduleNext(deps);

  const submitQuery = useSubmitQueryCallback({
    ...deps,
    displayUserMessage,
    prepareQueryForGemini,
    handleLoopDetectedEvent,
    scheduleNextQueuedSubmission,
    startNewPrompt,
    getPromptCount,
  });

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
      deps.queuedSubmissionsRef.current.push({ query: [{ text: message }] });
      scheduleNextQueuedSubmission();
    };

    const unsubscribe = deps.config.setupAsyncTaskAutoTrigger(
      isAgentBusy,
      triggerAgentTurn,
    );

    return () => {
      unsubscribe();
    };
  }, [
    deps.config,
    deps.streamingState,
    scheduleNextQueuedSubmission,
    deps.queuedSubmissionsRef,
  ]);

  return {
    submitQuery,
    scheduleNextQueuedSubmission,
    processStreamEvent,
    displayUserMessage,
    prepareQueryForGemini,
    handleLoopDetectedEvent,
  };
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
  prepareQueryForGemini: (
    query: PartListUnion,
    userMessageTimestamp: number,
    abortSignal: AbortSignal,
    promptId: string,
  ) => Promise<{ queryToSend: PartListUnion | null; shouldProceed: boolean }>;
  handleLoopDetectedEvent: () => void;
  scheduleNextQueuedSubmission: () => void;
  startNewPrompt: () => void;
  getPromptCount: () => number;
}

function useSubmitQueryCallback(cbd: SubmitQueryCallbackDeps) {
  return useCallback(
    async (
      query: PartListUnion,
      options?: { isContinuation: boolean },
      prompt_id?: string,
    ) => {
      // submitQuery handles NEW user prompts only; the engine-owned
      // AgenticLoop drives multi-turn continuation internally.
      void options;

      if (isQueueable(cbd.streamingState)) {
        cbd.queuedSubmissionsRef.current.push({
          query,
          promptId: prompt_id,
        });
        return;
      }

      const turn = initTurn(cbd, query, prompt_id, cbd.getPromptCount);

      if (isMcpDiscoveryBlocking(cbd.config, turn.trimmedStr)) {
        cbd.addItem(
          {
            type: 'info' as const,
            text: 'Waiting for MCP servers to initialize... Slash commands are still available.',
          },
          Date.now(),
        );
        return;
      }

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
  query: PartListUnion,
  turn: TurnInit,
): Promise<void> {
  const { queryToSend, shouldProceed } = await cbd.prepareQueryForGemini(
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
    cbd.config,
    cbd.startNewPrompt,
    cbd.setThought,
    cbd.thinkingBlocksRef,
  );
  cbd.setIsResponding(true);
  cbd.setInitError(null);

  try {
    await executeStream(cbd, cbd.handleLoopDetectedEvent, queryToSend, turn);
  } catch (error: unknown) {
    handleSubmissionError(
      error,
      cbd.addItem,
      cbd.config,
      cbd.onAuthError,
      turn.userMessageTimestamp,
    );
  } finally {
    cbd.setIsResponding(false);
    try {
      await cbd.recordingIntegration?.flushAtTurnBoundary();
    } catch {
      /* non-fatal */
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

function isMcpDiscoveryBlocking(config: Config, trimmedStr: string): boolean {
  if (!trimmedStr) return false;
  if (isSlashCommand(trimmedStr)) return false;

  const mcpManager = config.getMcpClientManager();
  const discoveryState = mcpManager?.getDiscoveryState();
  const configuredMcpServers =
    mcpManager !== undefined
      ? Object.keys(config.getMcpServers() ?? {}).length
      : 0;

  return (
    configuredMcpServers > 0 && discoveryState !== MCPDiscoveryState.COMPLETED
  );
}

interface TurnInit {
  userMessageTimestamp: number;
  abortSignal: AbortSignal;
  promptId: string;
  trimmedStr: string;
}

function initTurn(
  deps: UseSubmitQueryDeps,
  query: PartListUnion,
  promptId: string | undefined,
  getPromptCount: () => number,
): TurnInit {
  const userMessageTimestamp = Date.now();
  deps.abortControllerRef.current = new AbortController();
  const abortSignal = deps.abortControllerRef.current.signal;
  deps.turnCancelledRef.current = false;

  const resolvedPromptId =
    promptId ?? deps.config.getSessionId() + '########' + getPromptCount();

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
  queryToSend: PartListUnion,
  turn: TurnInit,
): Promise<void> {
  const runLoop = deps.runLoopRef.current;
  if (!runLoop) {
    throw new Error('AgenticLoop runner is not initialized.');
  }

  // The engine-owned AgenticLoop drives the entire multi-turn flow:
  // send → stream → schedule → execute → feed-back → repeat.
  await runLoop(queryToSend, turn.abortSignal, turn.promptId);

  if (deps.pendingHistoryItemRef.current) {
    deps.flushPendingHistoryItem(turn.userMessageTimestamp);
    deps.setPendingHistoryItem(null);
  }
  if (deps.loopDetectedRef.current) {
    deps.loopDetectedRef.current = false;
    handleLoopDetectedEvent();
  }
}
