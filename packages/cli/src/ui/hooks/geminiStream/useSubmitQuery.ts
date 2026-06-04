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
import {
  type Config,
  type GeminiClient,
  type MessageSenderType,
  type RecordingIntegration,
  type ServerGeminiStreamEvent,
  type ThinkingBlock,
  type ThoughtSummary,
  type ToolCallRequestInfo,
  MCPDiscoveryState,
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
import { StreamProcessingStatus, type QueuedSubmission } from './types.js';

export interface UseSubmitQueryDeps {
  config: Config;
  geminiClient: GeminiClient;
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
  abortControllerRef: React.MutableRefObject<AbortController | null>;
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
  processGeminiStreamEvents: (
    stream: AsyncIterable<ServerGeminiStreamEvent>,
    userMessageTimestamp: number,
    signal: AbortSignal,
  ) => Promise<StreamProcessingStatus>;
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
    processGeminiStreamEvents,
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
  });

  const scheduleNextQueuedSubmission = useScheduleNext(deps);

  const submitQuery = useSubmitQueryCallback({
    ...deps,
    displayUserMessage,
    prepareQueryForGemini,
    processGeminiStreamEvents,
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
    processGeminiStreamEvents,
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
  processGeminiStreamEvents: (
    stream: AsyncIterable<ServerGeminiStreamEvent>,
    userMessageTimestamp: number,
    signal: AbortSignal,
  ) => Promise<StreamProcessingStatus>;
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
      if (isQueueable(cbd.streamingState, options)) {
        cbd.queuedSubmissionsRef.current.push({
          query,
          options,
          promptId: prompt_id,
        });
        return;
      }

      const turn = initTurn(cbd, query, options, prompt_id, cbd.getPromptCount);

      if (isMcpDiscoveryBlocking(cbd.config, turn.trimmedStr, options)) {
        cbd.addItem(
          {
            type: 'info' as const,
            text: 'Waiting for MCP servers to initialize... Slash commands are still available.',
          },
          Date.now(),
        );
        return;
      }

      if (shouldDisplayUserMessage(turn.trimmedStr, options)) {
        cbd.displayUserMessage(turn.trimmedStr, turn.userMessageTimestamp);
      }

      await runSubmitQueryCore(cbd, query, options, turn);
    },
    [cbd],
  );
}

async function runSubmitQueryCore(
  cbd: SubmitQueryCallbackDeps,
  query: PartListUnion,
  options: { isContinuation: boolean } | undefined,
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
    options?.isContinuation === true,
    cbd.config,
    cbd.startNewPrompt,
    cbd.setThought,
    cbd.thinkingBlocksRef,
  );
  cbd.setIsResponding(true);
  cbd.setInitError(null);

  try {
    await executeStream(
      cbd,
      cbd.processGeminiStreamEvents,
      cbd.handleLoopDetectedEvent,
      queryToSend,
      turn,
    );
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

function isQueueable(
  streamingState: StreamingState,
  options?: { isContinuation: boolean },
): boolean {
  return (
    (streamingState === StreamingState.Responding ||
      streamingState === StreamingState.WaitingForConfirmation) &&
    options?.isContinuation !== true
  );
}

function shouldDisplayUserMessage(
  trimmedStr: string,
  options?: { isContinuation: boolean },
): boolean {
  return (
    !!trimmedStr &&
    options?.isContinuation !== true &&
    !isSlashCommand(trimmedStr)
  );
}

function isMcpDiscoveryBlocking(
  config: Config,
  trimmedStr: string,
  options?: { isContinuation: boolean },
): boolean {
  if (options?.isContinuation === true) return false;
  if (!trimmedStr) return false;
  if (isSlashCommand(trimmedStr)) return false;

  const mcpManager = config.getMcpClientManager();
  const discoveryState = mcpManager?.getDiscoveryState();
  const configuredMcpServers = mcpManager
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
  options: { isContinuation: boolean } | undefined,
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
  processGeminiStreamEvents: (
    stream: AsyncIterable<ServerGeminiStreamEvent>,
    userMessageTimestamp: number,
    signal: AbortSignal,
  ) => Promise<StreamProcessingStatus>,
  handleLoopDetectedEvent: () => void,
  queryToSend: PartListUnion,
  turn: TurnInit,
): Promise<void> {
  const stream = deps.geminiClient.sendMessageStream(
    queryToSend,
    turn.abortSignal,
    turn.promptId,
  );
  const status = await processGeminiStreamEvents(
    stream,
    turn.userMessageTimestamp,
    turn.abortSignal,
  );
  if (status === StreamProcessingStatus.UserCancelled) return;
  if (deps.pendingHistoryItemRef.current) {
    deps.flushPendingHistoryItem(turn.userMessageTimestamp);
    deps.setPendingHistoryItem(null);
  }
  if (deps.loopDetectedRef.current) {
    deps.loopDetectedRef.current = false;
    handleLoopDetectedEvent();
  }
}
