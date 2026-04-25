/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  type Config,
  type GeminiClient,
  type EditorType,
  type ThoughtSummary,
  EmojiFilter,
  MCPDiscoveryState,
  type EmojiFilterMode,
  type ThinkingBlock,
  GitService,
  type RecordingIntegration,
  type MessageBus,
  debugLogger,
} from '@vybestack/llxprt-code-core';
import { type PartListUnion } from '@google/genai';
import { type LoadedSettings } from '../../../config/settings.js';
import {
  StreamingState,
  type HistoryItem,
  type HistoryItemWithoutId,
  MessageType,
  type SlashCommandProcessorResult,
} from '../../types.js';
import { isSlashCommand } from '../../utils/commandUtils.js';
import { useShellCommandProcessor } from '../shellCommandProcessor.js';
import { useStateAndRef } from '../useStateAndRef.js';
import { type UseHistoryManagerReturn } from '../useHistoryManager.js';
import { useLogger } from '../useLogger.js';
import {
  useReactToolScheduler,
  type TrackedToolCall,
  type TrackedCompletedToolCall,
  type TrackedCancelledToolCall,
} from '../useReactToolScheduler.js';
import { mapToDisplay as mapTrackedToolCallsToDisplay } from '../toolMapping.js';
import { useSessionStats } from '../../contexts/SessionContext.js';
import { useKeypress, type Key } from '../useKeypress.js';
import {
  mergePendingToolGroupsForDisplay,
  handleSubmissionError,
} from './streamUtils.js';
import { useToolCompletionHandler } from './toolCompletionHandler.js';
import { useCheckpointPersistence } from './checkpointPersistence.js';
import { useStreamEventHandlers } from './useStreamEventHandlers.js';
import { StreamProcessingStatus, type QueuedSubmission } from './types.js';

/**
 * Resets or carries-over per-turn state depending on whether this is a new
 * prompt or a continuation. Also handles bucket failover reset/reauth.
 */
export async function prepareTurnForQuery(
  isContinuation: boolean,
  config: Config,
  startNewPrompt: () => void,
  setThought: (t: null) => void,
  thinkingBlocksRef: React.MutableRefObject<ThinkingBlock[]>,
): Promise<void> {
  const getBucketFailoverHandler = config.getBucketFailoverHandler as
    | Config['getBucketFailoverHandler']
    | undefined;

  if (!isContinuation) {
    startNewPrompt();
    setThought(null);
    thinkingBlocksRef.current = [];
    getBucketFailoverHandler?.()?.reset?.();

    // Invalidate auth cache at turn boundaries for new turns
    // This ensures tokens updated by other processes are picked up
    const handler = getBucketFailoverHandler?.();
    if (handler?.invalidateAuthCache) {
      const getRuntimeSessionId = config.getSessionId as
        | (() => string | undefined)
        | undefined;
      const runtimeId = getRuntimeSessionId?.() ?? 'default';
      handler.invalidateAuthCache(runtimeId);
    }
  } else {
    getBucketFailoverHandler?.()?.resetSession?.();
  }
  try {
    await getBucketFailoverHandler?.()?.ensureBucketsAuthenticated?.();
  } catch {
    // Swallow — partial auth is acceptable.
  }
}

/**
 * Manages the Gemini stream, including user input, command processing,
 * API interaction, and tool call lifecycle.
 */
/**
 * @plan:PLAN-20260211-SESSIONRECORDING.P26
 * @pseudocode recording-integration.md lines 100-108
 */
export const useGeminiStream = (
  geminiClient: GeminiClient,
  history: HistoryItem[],
  addItem: UseHistoryManagerReturn['addItem'],
  config: Config,
  settings: LoadedSettings,
  onDebugMessage: (message: string) => void,
  handleSlashCommand: (
    cmd: PartListUnion,
  ) => Promise<SlashCommandProcessorResult | false>,
  shellModeActive: boolean,
  getPreferredEditor: () => EditorType | undefined,
  onAuthError: () => void,
  performMemoryRefresh: () => Promise<void>,
  onEditorClose: () => void,
  onCancelSubmit: (shouldRestorePrompt?: boolean) => void,
  setShellInputFocused: (value: boolean) => void,
  terminalWidth?: number,
  terminalHeight?: number,
  onTodoPause?: () => void,
  onEditorOpen: () => void = () => {},
  recordingIntegration?: RecordingIntegration,
  runtimeMessageBus?: MessageBus,
) => {
  const [initError, setInitError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const abortActiveStream = useCallback((reason?: unknown) => {
    abortControllerRef.current?.abort(reason);
  }, []);
  const turnCancelledRef = useRef(false);
  const [isResponding, setIsResponding] = useState<boolean>(false);
  const lastProfileNameRef = useRef<string | undefined>(undefined);
  const [thought, setThought] = useState<ThoughtSummary | null>(null);
  const [pendingHistoryItem, pendingHistoryItemRef, setPendingHistoryItem] =
    useStateAndRef<HistoryItemWithoutId | null>(null);
  const [lastGeminiActivityTime, setLastGeminiActivityTime] =
    useState<number>(0);
  const queuedSubmissionsRef = useRef<QueuedSubmission[]>([]);
  const submitQueryRef = useRef<
    | ((
        query: PartListUnion,
        options?: { isContinuation: boolean },
        prompt_id?: string,
      ) => Promise<void>)
    | null
  >(null);
  const { startNewPrompt, getPromptCount } = useSessionStats();
  const storage = config.storage;

  const thinkingBlocksRef = useRef<ThinkingBlock[]>([]);

  const emojiFilter = useMemo(() => {
    const getEphemeralSetting = config.getEphemeralSetting as
      | Config['getEphemeralSetting']
      | undefined;
    const emojiFilterMode = getEphemeralSetting?.('emojifilter');
    const mode: EmojiFilterMode =
      typeof emojiFilterMode === 'string' && emojiFilterMode.length > 0
        ? (emojiFilterMode as EmojiFilterMode)
        : 'auto';

    return mode !== 'allowed' ? new EmojiFilter({ mode }) : undefined;
  }, [config]);

  const sanitizeContent = useCallback(
    (text: string) => {
      if (!emojiFilter) {
        return {
          text,
          feedback: undefined as string | undefined,
          blocked: false,
        };
      }

      const result = emojiFilter.filterText(text);
      if (result.blocked) {
        return {
          text: '',
          feedback: result.systemFeedback,
          blocked: true as const,
        };
      }

      const sanitized =
        typeof result.filtered === 'string' ? result.filtered : '';

      return {
        text: sanitized,
        feedback: result.systemFeedback,
        blocked: false as const,
      };
    },
    [emojiFilter],
  );

  const flushPendingHistoryItem = useCallback(
    (timestamp: number) => {
      const pending = pendingHistoryItemRef.current;
      if (!pending) {
        return;
      }

      if (pending.type === 'gemini' || pending.type === 'gemini_content') {
        const {
          text: sanitized,
          feedback,
          blocked,
        } = sanitizeContent(pending.text);

        if (blocked) {
          addItem(
            {
              type: MessageType.ERROR,
              text: '[Error: Response blocked due to emoji detection]',
            },
            timestamp,
          );

          if (feedback) {
            addItem({ type: MessageType.INFO, text: feedback }, timestamp);
          }

          setPendingHistoryItem(null);
          return;
        }

        const itemWithThinking = {
          ...pending,
          text: sanitized,
          ...(thinkingBlocksRef.current.length > 0
            ? { thinkingBlocks: [...thinkingBlocksRef.current] }
            : {}),
        };

        addItem(itemWithThinking, timestamp);
        thinkingBlocksRef.current = [];

        if (feedback) {
          addItem({ type: MessageType.INFO, text: feedback }, timestamp);
        }
      } else {
        addItem(pending, timestamp);
      }

      setPendingHistoryItem(null);
    },
    [addItem, pendingHistoryItemRef, sanitizeContent, setPendingHistoryItem],
  );
  const logger = useLogger(storage);
  const gitService = useMemo(
    () => new GitService(config.getProjectRoot(), storage),
    [config, storage],
  );

  const [
    toolCalls,
    scheduleToolCalls,
    markToolsAsSubmitted,
    cancelAllToolCalls,
    lastToolOutputTime,
  ] = useReactToolScheduler(
    async (schedulerId, completedToolCallsFromScheduler, { isPrimary }) => {
      if (completedToolCallsFromScheduler.length === 0) {
        return;
      }

      if (isPrimary) {
        addItem(
          mapTrackedToolCallsToDisplay(
            completedToolCallsFromScheduler as TrackedToolCall[],
          ),
          Date.now(),
        );

        try {
          const currentModel =
            config.getGeminiClient().getCurrentSequenceModel() ??
            config.getModel();
          config
            .getGeminiClient()
            .getChat()
            .recordCompletedToolCalls(
              currentModel,
              completedToolCallsFromScheduler,
            );
        } catch (error) {
          debugLogger.error(
            `Error recording completed tool call information: ${error}`,
          );
        }

        await handleCompletedTools(
          completedToolCallsFromScheduler as TrackedToolCall[],
        );
        return;
      }

      const callIdsToMark = completedToolCallsFromScheduler.map(
        (toolCall) => toolCall.request.callId,
      );
      if (callIdsToMark.length > 0) {
        markToolsAsSubmitted(callIdsToMark);
      }

      addItem(
        mapTrackedToolCallsToDisplay(
          completedToolCallsFromScheduler as TrackedToolCall[],
        ),
        Date.now(),
      );
    },
    config,
    setPendingHistoryItem,
    getPreferredEditor,
    onEditorClose,
    onEditorOpen,
    runtimeMessageBus,
  );

  const pendingToolCallGroupDisplay = useMemo(
    () =>
      toolCalls.length > 0
        ? mapTrackedToolCallsToDisplay(toolCalls)
        : undefined,
    [toolCalls],
  );

  const loopDetectedRef = useRef(false);

  const onExec = useCallback(async (done: Promise<void>) => {
    setIsResponding(true);
    await done;
    setIsResponding(false);
  }, []);
  const { handleShellCommand, activeShellPtyId, lastShellOutputTime } =
    useShellCommandProcessor(
      addItem,
      setPendingHistoryItem,
      onExec,
      onDebugMessage,
      config,
      geminiClient,
      setShellInputFocused,
      terminalWidth,
      terminalHeight,
      pendingHistoryItemRef,
    );

  const streamingState = useMemo(() => {
    if (toolCalls.some((tc) => tc.status === 'awaiting_approval')) {
      return StreamingState.WaitingForConfirmation;
    }
    if (
      isResponding ||
      toolCalls.some(
        (tc) =>
          tc.status === 'executing' ||
          tc.status === 'scheduled' ||
          tc.status === 'validating' ||
          ((tc.status === 'success' ||
            tc.status === 'error' ||
            tc.status === 'cancelled') &&
            (tc as TrackedCompletedToolCall | TrackedCancelledToolCall)
              .responseSubmittedToGemini !== true),
      )
    ) {
      return StreamingState.Responding;
    }
    return StreamingState.Idle;
  }, [isResponding, toolCalls]);

  const cancelOngoingRequest = useCallback(() => {
    if (streamingState !== StreamingState.Responding) {
      return;
    }
    if (turnCancelledRef.current) {
      return;
    }
    turnCancelledRef.current = true;
    abortControllerRef.current?.abort();
    if (abortControllerRef.current) {
      cancelAllToolCalls();
    }
    if (pendingHistoryItemRef.current) {
      flushPendingHistoryItem(Date.now());
    }
    addItem(
      {
        type: MessageType.INFO,
        text: 'Request cancelled.',
      },
      Date.now(),
    );
    setPendingHistoryItem(null);
    onCancelSubmit();
    setIsResponding(false);
    queuedSubmissionsRef.current = [];
  }, [
    streamingState,
    addItem,
    setPendingHistoryItem,
    onCancelSubmit,
    pendingHistoryItemRef,
    flushPendingHistoryItem,
    cancelAllToolCalls,
  ]);

  const cancelOngoingRequestRef = useRef(cancelOngoingRequest);
  cancelOngoingRequestRef.current = cancelOngoingRequest;

  const handleEscapeKeypress = useCallback((key: Key) => {
    const isEscape =
      key.name === 'escape' ||
      key.sequence === '\u001b[27u' ||
      key.sequence === '\u001b';
    if (!isEscape) {
      return;
    }
    cancelOngoingRequestRef.current();
  }, []);

  useKeypress(handleEscapeKeypress, { isActive: true });

  const scheduleNextQueuedSubmission = useCallback(() => {
    if (queuedSubmissionsRef.current.length === 0) {
      return;
    }

    const next = queuedSubmissionsRef.current.shift();
    if (!next) {
      return;
    }

    setTimeout(() => {
      void submitQueryRef.current?.(next.query, next.options, next.promptId);
    }, 0);
  }, []);

  // Delegate all stream event handling to the extracted hook
  const {
    processGeminiStreamEvents,
    displayUserMessage,
    prepareQueryForGemini,
    handleLoopDetectedEvent,
  } = useStreamEventHandlers({
    config,
    settings,
    addItem,
    onDebugMessage,
    onCancelSubmit,
    sanitizeContent,
    flushPendingHistoryItem,
    pendingHistoryItemRef,
    thinkingBlocksRef,
    turnCancelledRef,
    queuedSubmissionsRef,
    setPendingHistoryItem,
    setIsResponding,
    setThought,
    setLastGeminiActivityTime,
    scheduleToolCalls,
    abortActiveStream,
    handleShellCommand,
    handleSlashCommand,
    logger,
    shellModeActive,
    loopDetectedRef,
    lastProfileNameRef,
  });

  const submitQuery = useCallback(
    async (
      query: PartListUnion,
      options?: { isContinuation: boolean },
      prompt_id?: string,
    ) => {
      if (
        (streamingState === StreamingState.Responding ||
          streamingState === StreamingState.WaitingForConfirmation) &&
        options?.isContinuation !== true
      ) {
        queuedSubmissionsRef.current.push({
          query,
          options,
          promptId: prompt_id,
        });
        return;
      }

      const userMessageTimestamp = Date.now();
      abortControllerRef.current = new AbortController();
      const abortSignal = abortControllerRef.current.signal;
      turnCancelledRef.current = false;

      prompt_id ??= config.getSessionId() + '########' + getPromptCount();

      const trimmedStr = typeof query === 'string' ? query.trim() : '';

      // Block non-slash queries while MCP discovery is in progress and servers exist.
      // Slash commands are always allowed through.
      const mcpManager = config.getMcpClientManager();
      const discoveryState = mcpManager?.getDiscoveryState();
      const configuredMcpServers = mcpManager
        ? Object.keys(config.getMcpServers() ?? {}).length
        : 0;
      if (
        options?.isContinuation !== true &&
        trimmedStr &&
        !isSlashCommand(trimmedStr) &&
        configuredMcpServers > 0 &&
        discoveryState !== MCPDiscoveryState.COMPLETED
      ) {
        addItem(
          {
            type: MessageType.INFO,
            text: 'Waiting for MCP servers to initialize... Slash commands are still available.',
          },
          Date.now(),
        );
        return;
      }

      if (
        trimmedStr &&
        options?.isContinuation !== true &&
        !isSlashCommand(trimmedStr)
      ) {
        displayUserMessage(trimmedStr, userMessageTimestamp);
      }

      const { queryToSend, shouldProceed } = await prepareQueryForGemini(
        query,
        userMessageTimestamp,
        abortSignal,
        prompt_id,
      );
      if (!shouldProceed || queryToSend === null) {
        scheduleNextQueuedSubmission();
        return;
      }

      await prepareTurnForQuery(
        options?.isContinuation === true,
        config,
        startNewPrompt,
        setThought,
        thinkingBlocksRef,
      );
      setIsResponding(true);
      setInitError(null);

      try {
        const stream = geminiClient.sendMessageStream(
          queryToSend,
          abortSignal,
          prompt_id,
        );
        const status = await processGeminiStreamEvents(
          stream,
          userMessageTimestamp,
          abortSignal,
        );
        if (status === StreamProcessingStatus.UserCancelled) return;
        if (pendingHistoryItemRef.current) {
          flushPendingHistoryItem(userMessageTimestamp);
          setPendingHistoryItem(null);
        }
        if (loopDetectedRef.current) {
          loopDetectedRef.current = false;
          handleLoopDetectedEvent();
        }
      } catch (error: unknown) {
        handleSubmissionError(
          error,
          addItem,
          config,
          onAuthError,
          userMessageTimestamp,
        );
      } finally {
        setIsResponding(false);
        try {
          await recordingIntegration?.flushAtTurnBoundary();
        } catch {
          /* non-fatal */
        }
      }
    },
    [
      streamingState,
      displayUserMessage,
      prepareQueryForGemini,
      processGeminiStreamEvents,
      pendingHistoryItemRef,
      addItem,
      setPendingHistoryItem,
      setInitError,
      geminiClient,
      onAuthError,
      config,
      startNewPrompt,
      getPromptCount,
      handleLoopDetectedEvent,
      flushPendingHistoryItem,
      scheduleNextQueuedSubmission,
      recordingIntegration,
    ],
  );

  useEffect(() => {
    submitQueryRef.current = submitQuery;
  }, [submitQuery]);

  useEffect(() => {
    if (streamingState === StreamingState.Idle) {
      scheduleNextQueuedSubmission();
    }
  }, [streamingState, scheduleNextQueuedSubmission]);

  useEffect(() => {
    const isAgentBusy = () => streamingState !== StreamingState.Idle;
    const triggerAgentTurn = async (message: string) => {
      queuedSubmissionsRef.current.push({ query: [{ text: message }] });
      scheduleNextQueuedSubmission();
    };

    const unsubscribe = config.setupAsyncTaskAutoTrigger(
      isAgentBusy,
      triggerAgentTurn,
    );

    return () => {
      unsubscribe();
    };
  }, [config, streamingState, scheduleNextQueuedSubmission]);

  const { handleCompletedTools } = useToolCompletionHandler(
    isResponding,
    turnCancelledRef,
    submitQueryRef,
    geminiClient,
    markToolsAsSubmitted,
    performMemoryRefresh,
    onTodoPause,
  );

  const pendingHistoryItems = useMemo(
    () =>
      mergePendingToolGroupsForDisplay(
        pendingHistoryItem,
        pendingToolCallGroupDisplay,
      ),
    [pendingHistoryItem, pendingToolCallGroupDisplay],
  );

  useCheckpointPersistence(
    toolCalls,
    config,
    gitService,
    history,
    geminiClient,
    storage,
    onDebugMessage,
  );

  const lastOutputTime = Math.max(
    lastToolOutputTime,
    lastShellOutputTime,
    lastGeminiActivityTime,
  );

  return {
    streamingState,
    submitQuery,
    initError,
    pendingHistoryItems,
    thought,
    cancelOngoingRequest,
    activeShellPtyId,
    lastOutputTime,
  };
};
