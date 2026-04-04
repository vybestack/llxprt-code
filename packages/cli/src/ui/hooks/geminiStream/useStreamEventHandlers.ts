/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Extracted stream event handler hooks from useGeminiStream.
 * Contains all event handler useCallbacks for stream event processing,
 * plus processGeminiStreamEvents and displayUserMessage.
 */

import type React from 'react';
import { useCallback } from 'react';
import {
  Config,
  GeminiEventType as ServerGeminiEventType,
  ServerGeminiStreamEvent as GeminiEvent,
  ServerGeminiContentEvent as ContentEvent,
  ServerGeminiErrorEvent as ErrorEvent,
  ServerGeminiChatCompressedEvent,
  ServerGeminiFinishedEvent,
  MessageSenderType,
  ToolCallRequestInfo,
  logUserPrompt,
  UserPromptEvent,
  parseAndFormatApiError,
  DEFAULT_AGENT_ID,
  createAbortError,
  nextStreamEventWithIdleTimeout,
  type ThinkingBlock,
  tokenLimit,
  uiTelemetryService,
  type ThoughtSummary,
} from '@vybestack/llxprt-code-core';
import { type PartListUnion } from '@google/genai';
import { LoadedSettings } from '../../../config/settings.js';
import {
  HistoryItem,
  HistoryItemWithoutId,
  HistoryItemToolGroup,
  HistoryItemGemini,
  HistoryItemGeminiContent,
  MessageType,
  SlashCommandProcessorResult,
  ToolCallStatus,
} from '../../types.js';
import { isAtCommand, isSlashCommand } from '../../utils/commandUtils.js';
import { UseHistoryManagerReturn } from '../useHistoryManager.js';
import {
  SYSTEM_NOTICE_EVENT,
  showCitations,
  getCurrentProfileName,
  buildFinishReasonMessage,
  buildSplitContent,
  buildFullSplitItem,
  deduplicateToolCallRequests,
  buildThinkingBlock,
  processSlashCommandResult,
} from './streamUtils.js';
import { StreamProcessingStatus } from './types.js';
import { handleAtCommand } from '../atCommandProcessor.js';

const GEMINI_STREAM_IDLE_TIMEOUT_MS = 30_000;

interface StreamEventHandlerDeps {
  config: Config;
  settings: LoadedSettings;
  addItem: UseHistoryManagerReturn['addItem'];
  onDebugMessage: (message: string) => void;
  onCancelSubmit: (shouldRestorePrompt?: boolean) => void;
  sanitizeContent: (text: string) => {
    text: string;
    blocked: boolean;
    feedback?: string;
  };
  flushPendingHistoryItem: (timestamp: number) => void;
  pendingHistoryItemRef: React.MutableRefObject<HistoryItemWithoutId | null>;
  thinkingBlocksRef: React.MutableRefObject<ThinkingBlock[]>;
  turnCancelledRef: React.MutableRefObject<boolean>;
  queuedSubmissionsRef: React.MutableRefObject<
    Array<{
      query: PartListUnion;
      options?: { isContinuation: boolean };
      promptId?: string;
    }>
  >;
  setPendingHistoryItem: React.Dispatch<
    React.SetStateAction<HistoryItemWithoutId | null>
  >;
  setIsResponding: React.Dispatch<React.SetStateAction<boolean>>;
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
}

/**
 * Applies a ThoughtSummary to the pending history item state.
 */
function applyThoughtToState(
  thoughtSummary: ThoughtSummary,
  sanitizeContent: (text: string) => {
    text: string;
    blocked: boolean;
    feedback?: string;
  },
  config: Config,
  thinkingBlocksRef: React.MutableRefObject<ThinkingBlock[]>,
  setLastGeminiActivityTime: (t: number) => void,
  setThought: (t: ThoughtSummary | null) => void,
  setPendingHistoryItem: (
    updater: (item: HistoryItemWithoutId | null) => HistoryItemWithoutId | null,
  ) => void,
): void {
  setLastGeminiActivityTime(Date.now());
  setThought(thoughtSummary);
  let thoughtText = [thoughtSummary.subject, thoughtSummary.description]
    .filter(Boolean)
    .join(': ');
  const sanitized = sanitizeContent(thoughtText);
  thoughtText = sanitized.blocked ? '' : sanitized.text;
  const thinkingBlock = buildThinkingBlock(
    thoughtText,
    thinkingBlocksRef.current,
  );
  if (thinkingBlock) {
    thinkingBlocksRef.current.push(thinkingBlock);
    const liveProfileName = getCurrentProfileName(config);
    setPendingHistoryItem((item) => {
      const ep = (
        item as HistoryItemGemini | HistoryItemGeminiContent | undefined
      )?.profileName;
      const pn = liveProfileName ?? ep;
      return {
        type: (item?.type as 'gemini' | 'gemini_content') || 'gemini',
        text: item?.text || '',
        ...(pn != null ? { profileName: pn } : {}),
        thinkingBlocks: [...thinkingBlocksRef.current],
      };
    });
  }
}

export function useStreamEventHandlers(deps: StreamEventHandlerDeps) {
  const {
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
  } = deps;

  const handleContentEvent = useCallback(
    (
      eventValue: ContentEvent['value'],
      currentGeminiMessageBuffer: string,
      userMessageTimestamp: number,
    ): string => {
      if (turnCancelledRef.current) {
        return '';
      }

      const liveProfileName = getCurrentProfileName(config);
      const combined = currentGeminiMessageBuffer + eventValue;
      const {
        text: sanitizedCombined,
        feedback,
        blocked,
      } = sanitizeContent(combined);

      if (blocked) {
        addItem(
          {
            type: MessageType.ERROR,
            text: '[Error: Response blocked due to emoji detection]',
          },
          userMessageTimestamp,
        );
        if (feedback)
          addItem(
            { type: MessageType.INFO, text: feedback },
            userMessageTimestamp,
          );
        return currentGeminiMessageBuffer;
      }
      if (feedback)
        addItem(
          { type: MessageType.INFO, text: feedback },
          userMessageTimestamp,
        );

      if (
        pendingHistoryItemRef.current?.type !== 'gemini' &&
        pendingHistoryItemRef.current?.type !== 'gemini_content'
      ) {
        if (pendingHistoryItemRef.current)
          flushPendingHistoryItem(userMessageTimestamp);
        setPendingHistoryItem({
          type: 'gemini',
          text: '',
          ...(liveProfileName != null ? { profileName: liveProfileName } : {}),
          ...(thinkingBlocksRef.current.length > 0
            ? { thinkingBlocks: [...thinkingBlocksRef.current] }
            : {}),
        });
      }

      const pendingType =
        pendingHistoryItemRef.current?.type === 'gemini_content'
          ? 'gemini_content'
          : 'gemini';
      const existingProfileName = (
        pendingHistoryItemRef.current as
          | HistoryItemGemini
          | HistoryItemGeminiContent
          | undefined
      )?.profileName;
      const { splitPoint, beforeText, afterItem } = buildSplitContent(
        sanitizedCombined,
        liveProfileName,
        existingProfileName ?? null,
        thinkingBlocksRef.current,
        pendingType,
      );

      if (splitPoint === sanitizedCombined.length) {
        setPendingHistoryItem((item) =>
          buildFullSplitItem(
            item,
            sanitizedCombined,
            liveProfileName,
            thinkingBlocksRef.current,
          ),
        );
        return sanitizedCombined;
      }

      if (beforeText) {
        addItem(
          {
            type: pendingType,
            text: beforeText,
            ...(liveProfileName != null
              ? { profileName: liveProfileName }
              : {}),
            ...(thinkingBlocksRef.current.length > 0
              ? { thinkingBlocks: [...thinkingBlocksRef.current] }
              : {}),
          },
          userMessageTimestamp,
        );
        thinkingBlocksRef.current = [];
      }

      setPendingHistoryItem(afterItem);
      return afterItem.text;
    },
    [
      addItem,
      config,
      pendingHistoryItemRef,
      sanitizeContent,
      setPendingHistoryItem,
      flushPendingHistoryItem,
      thinkingBlocksRef,
      turnCancelledRef,
    ],
  );

  const handleUserCancelledEvent = useCallback(
    (userMessageTimestamp: number) => {
      if (turnCancelledRef.current) {
        return;
      }
      if (pendingHistoryItemRef.current) {
        if (pendingHistoryItemRef.current.type === 'tool_group') {
          const updatedTools = pendingHistoryItemRef.current.tools.map(
            (tool) =>
              tool.status === ToolCallStatus.Pending ||
              tool.status === ToolCallStatus.Confirming ||
              tool.status === ToolCallStatus.Executing
                ? { ...tool, status: ToolCallStatus.Canceled }
                : tool,
          );
          const pendingItem: HistoryItemToolGroup = {
            ...pendingHistoryItemRef.current,
            tools: updatedTools,
          };
          addItem(pendingItem, userMessageTimestamp);
        } else {
          flushPendingHistoryItem(userMessageTimestamp);
        }
        setPendingHistoryItem(null);
      }
      addItem(
        { type: MessageType.INFO, text: 'User cancelled the request.' },
        userMessageTimestamp,
      );
      setIsResponding(false);
      queuedSubmissionsRef.current = [];
      setThought(null);
    },
    [
      addItem,
      pendingHistoryItemRef,
      setPendingHistoryItem,
      setThought,
      flushPendingHistoryItem,
      queuedSubmissionsRef,
      setIsResponding,
      turnCancelledRef,
    ],
  );

  const handleErrorEvent = useCallback(
    (eventValue: ErrorEvent['value'], userMessageTimestamp: number) => {
      if (pendingHistoryItemRef.current) {
        flushPendingHistoryItem(userMessageTimestamp);
        setPendingHistoryItem(null);
      }
      addItem(
        {
          type: MessageType.ERROR,
          text: parseAndFormatApiError(
            eventValue.error,
            undefined,
            config.getModel(),
          ),
        },
        userMessageTimestamp,
      );
      setThought(null);
    },
    [
      addItem,
      pendingHistoryItemRef,
      setPendingHistoryItem,
      config,
      setThought,
      flushPendingHistoryItem,
    ],
  );

  const handleCitationEvent = useCallback(
    (text: string, userMessageTimestamp: number) => {
      if (!showCitations(settings, config)) {
        return;
      }

      if (pendingHistoryItemRef.current) {
        flushPendingHistoryItem(userMessageTimestamp);
        setPendingHistoryItem(null);
      }
      addItem({ type: MessageType.INFO, text }, userMessageTimestamp);
    },
    [
      addItem,
      pendingHistoryItemRef,
      setPendingHistoryItem,
      settings,
      config,
      flushPendingHistoryItem,
    ],
  );

  const handleFinishedEvent = useCallback(
    (event: ServerGeminiFinishedEvent, userMessageTimestamp: number) => {
      const message = buildFinishReasonMessage(event.value.reason);
      if (message) {
        addItem(
          { type: 'info', text: `WARNING:  ${message}` },
          userMessageTimestamp,
        );
      }
    },
    [addItem],
  );

  const handleChatCompressionEvent = useCallback(
    (
      eventValue: ServerGeminiChatCompressedEvent['value'],
      userMessageTimestamp: number,
    ) => {
      if (pendingHistoryItemRef.current) {
        addItem(pendingHistoryItemRef.current, userMessageTimestamp);
        setPendingHistoryItem(null);
      }
      return addItem(
        {
          type: 'info',
          text:
            `IMPORTANT: This conversation approached the input token limit for ${config.getModel()}. ` +
            `A compressed context will be sent for future messages (compressed from: ` +
            `${eventValue?.originalTokenCount ?? 'unknown'} to ` +
            `${eventValue?.newTokenCount ?? 'unknown'} tokens).`,
        },
        Date.now(),
      );
    },
    [addItem, config, pendingHistoryItemRef, setPendingHistoryItem],
  );

  const handleMaxSessionTurnsEvent = useCallback(
    () =>
      addItem(
        {
          type: 'info',
          text:
            `The session has reached the maximum number of turns: ${config.getMaxSessionTurns()}. ` +
            `Please update this limit in your setting.json file.`,
        },
        Date.now(),
      ),
    [addItem, config],
  );

  const handleContextWindowWillOverflowEvent = useCallback(
    (estimatedRequestTokenCount: number, remainingTokenCount: number) => {
      onCancelSubmit(true);

      const limit = tokenLimit(config.getModel());

      const isLessThan75Percent =
        limit > 0 && remainingTokenCount < limit * 0.75;

      let text = `Sending this message (${estimatedRequestTokenCount} tokens) might exceed the remaining context window limit (${remainingTokenCount} tokens).`;

      if (isLessThan75Percent) {
        text +=
          ' Please try reducing the size of your message or use the `/compress` command to compress the chat history.';
      }

      addItem(
        {
          type: 'info',
          text,
        },
        Date.now(),
      );
    },
    [addItem, onCancelSubmit, config],
  );

  const handleLoopDetectedEvent = useCallback(() => {
    addItem(
      {
        type: 'info',
        text: `A potential loop was detected. This can happen due to repetitive tool calls or other model behavior. The request has been halted.`,
      },
      Date.now(),
    );
  }, [addItem]);

  const processGeminiStreamEvents = useCallback(
    async (
      stream: AsyncIterable<GeminiEvent>,
      userMessageTimestamp: number,
      signal: AbortSignal,
    ): Promise<StreamProcessingStatus> => {
      let geminiMessageBuffer = '';
      const toolCallRequests: ToolCallRequestInfo[] = [];
      let processingResult = StreamProcessingStatus.Completed;
      const pendingHistoryAtTimeout = () => {
        if (pendingHistoryItemRef.current) {
          addItem(pendingHistoryItemRef.current, userMessageTimestamp);
          setPendingHistoryItem(null);
        }
      };
      const iterator = stream[Symbol.asyncIterator]();
      try {
        while (true) {
          const nextEvent = await nextStreamEventWithIdleTimeout({
            iterator,
            timeoutMs: GEMINI_STREAM_IDLE_TIMEOUT_MS,
            signal,
            onTimeout: () => {
              if (signal.aborted) {
                return;
              }

              pendingHistoryAtTimeout();
              setThought(null);
              abortActiveStream(createAbortError());
            },
            createTimeoutError: () => createAbortError(),
          });
          if (nextEvent.done) {
            break;
          }

          const event = nextEvent.value;
          if ((event as { type?: unknown }).type === SYSTEM_NOTICE_EVENT) {
            continue;
          }

          switch (event.type) {
            case ServerGeminiEventType.Thought:
              applyThoughtToState(
                event.value,
                sanitizeContent,
                config,
                thinkingBlocksRef,
                setLastGeminiActivityTime,
                setThought,
                setPendingHistoryItem,
              );
              break;
            case ServerGeminiEventType.Content:
              setLastGeminiActivityTime(Date.now());
              geminiMessageBuffer = handleContentEvent(
                event.value,
                geminiMessageBuffer,
                userMessageTimestamp,
              );
              break;
            case ServerGeminiEventType.ToolCallRequest:
              toolCallRequests.push({
                ...event.value,
                agentId: event.value.agentId ?? DEFAULT_AGENT_ID,
              });
              break;
            case ServerGeminiEventType.UserCancelled:
              toolCallRequests.length = 0;
              handleUserCancelledEvent(userMessageTimestamp);
              processingResult = StreamProcessingStatus.UserCancelled;
              break;
            case ServerGeminiEventType.Error:
              toolCallRequests.length = 0;
              handleErrorEvent(event.value, userMessageTimestamp);
              processingResult = StreamProcessingStatus.Error;
              break;
            case ServerGeminiEventType.ChatCompressed:
              handleChatCompressionEvent(event.value, userMessageTimestamp);
              break;
            case ServerGeminiEventType.ToolCallConfirmation:
            case ServerGeminiEventType.ToolCallResponse:
              break;
            case ServerGeminiEventType.MaxSessionTurns:
              handleMaxSessionTurnsEvent();
              break;
            case ServerGeminiEventType.ContextWindowWillOverflow:
              handleContextWindowWillOverflowEvent(
                event.value.estimatedRequestTokenCount,
                event.value.remainingTokenCount,
              );
              break;
            case ServerGeminiEventType.Finished:
              handleFinishedEvent(event, userMessageTimestamp);
              break;
            case ServerGeminiEventType.LoopDetected:
              loopDetectedRef.current = true;
              toolCallRequests.length = 0;
              break;
            case ServerGeminiEventType.UsageMetadata:
              if (event.value.promptTokenCount !== undefined)
                uiTelemetryService.setLastPromptTokenCount(
                  event.value.promptTokenCount,
                );
              break;
            case ServerGeminiEventType.Citation:
              handleCitationEvent(event.value, userMessageTimestamp);
              break;
            case ServerGeminiEventType.Retry:
            case ServerGeminiEventType.InvalidStream:
              break;
            case ServerGeminiEventType.AgentExecutionStopped:
              addItem(
                {
                  type: MessageType.INFO,
                  text: `Execution stopped by hook: ${event.systemMessage?.trim() || event.reason}`,
                },
                userMessageTimestamp,
              );
              if (event.contextCleared) {
                addItem(
                  {
                    type: MessageType.INFO,
                    text: 'Conversation context has been cleared.',
                  },
                  userMessageTimestamp,
                );
              }
              break;
            case ServerGeminiEventType.AgentExecutionBlocked:
              addItem(
                {
                  type: MessageType.INFO,
                  text: `Execution blocked by hook: ${event.systemMessage?.trim() || event.reason}`,
                },
                userMessageTimestamp,
              );
              if (event.contextCleared) {
                addItem(
                  {
                    type: MessageType.INFO,
                    text: 'Conversation context has been cleared.',
                  },
                  userMessageTimestamp,
                );
              }
              break;
            default:
              break;
          }
        }

        if (
          processingResult === StreamProcessingStatus.Completed &&
          !signal.aborted &&
          !turnCancelledRef.current &&
          !loopDetectedRef.current &&
          toolCallRequests.length > 0
        ) {
          const deduped = deduplicateToolCallRequests(toolCallRequests);
          if (deduped.length > 0) {
            if (pendingHistoryItemRef.current) {
              addItem(pendingHistoryItemRef.current, userMessageTimestamp);
              setPendingHistoryItem(null);
            }
            await scheduleToolCalls(deduped, signal);
          }
        }

        return processingResult;
      } finally {
        // Don't await the return() call to avoid hanging on stuck generators.
        // The generator will eventually be garbage collected.
        iterator.return?.().catch(() => {
          // cleanup errors are non-fatal
        });
        if (pendingHistoryItemRef.current && signal.aborted) {
          setPendingHistoryItem(null);
        }
      }
    },
    [
      config,
      handleContentEvent,
      handleUserCancelledEvent,
      handleErrorEvent,
      scheduleToolCalls,
      abortActiveStream,
      handleChatCompressionEvent,
      handleFinishedEvent,
      handleMaxSessionTurnsEvent,
      handleContextWindowWillOverflowEvent,
      handleCitationEvent,
      sanitizeContent,
      addItem,
      pendingHistoryItemRef,
      setPendingHistoryItem,
      loopDetectedRef,
      turnCancelledRef,
      setLastGeminiActivityTime,
      setThought,
      thinkingBlocksRef,
    ],
  );

  const displayUserMessage = useCallback(
    (trimmedQuery: string, userMessageTimestamp: number) => {
      addItem(
        { type: MessageType.USER, text: trimmedQuery },
        userMessageTimestamp,
      );
      const showProfileChangeInChat =
        settings?.merged?.showProfileChangeInChat ?? true;
      const liveProfileName = getCurrentProfileName(config);
      if (
        showProfileChangeInChat &&
        liveProfileName &&
        lastProfileNameRef.current !== undefined &&
        liveProfileName !== lastProfileNameRef.current
      ) {
        addItem(
          { type: 'profile_change', profileName: liveProfileName } as Omit<
            HistoryItem,
            'id'
          >,
          userMessageTimestamp,
        );
      }
      lastProfileNameRef.current = liveProfileName ?? undefined;
    },
    [
      addItem,
      config,
      settings?.merged?.showProfileChangeInChat,
      lastProfileNameRef,
    ],
  );

  const prepareQueryForGemini = useCallback(
    async (
      query: PartListUnion,
      userMessageTimestamp: number,
      abortSignal: AbortSignal,
      prompt_id: string,
    ): Promise<{
      queryToSend: PartListUnion | null;
      shouldProceed: boolean;
    }> => {
      if (turnCancelledRef.current) {
        return { queryToSend: null, shouldProceed: false };
      }
      if (typeof query === 'string' && query.trim().length === 0) {
        return { queryToSend: null, shouldProceed: false };
      }

      let localQueryToSendToGemini: PartListUnion | null = null;

      if (typeof query === 'string') {
        const trimmedQuery = query.trim();
        logUserPrompt(
          config,
          new UserPromptEvent(trimmedQuery.length, prompt_id, trimmedQuery),
        );
        await logger?.logMessage(MessageSenderType.USER, trimmedQuery);

        if (!shellModeActive) {
          const slashCommandResult = isSlashCommand(trimmedQuery)
            ? await handleSlashCommand(trimmedQuery)
            : false;
          if (slashCommandResult) {
            return processSlashCommandResult(
              slashCommandResult,
              scheduleToolCalls,
              prompt_id,
              abortSignal,
            );
          }
        }

        if (shellModeActive && handleShellCommand(trimmedQuery, abortSignal)) {
          return { queryToSend: null, shouldProceed: false };
        }

        if (isAtCommand(trimmedQuery)) {
          const atCommandResult = await handleAtCommand({
            query: trimmedQuery,
            config,
            addItem,
            onDebugMessage,
            messageId: userMessageTimestamp,
            signal: abortSignal,
          });
          if (atCommandResult.error) {
            onDebugMessage(atCommandResult.error);
            return { queryToSend: null, shouldProceed: false };
          }
          localQueryToSendToGemini = atCommandResult.processedQuery;
        } else {
          localQueryToSendToGemini = trimmedQuery;
        }
      } else {
        localQueryToSendToGemini = query;
      }

      if (localQueryToSendToGemini === null) {
        onDebugMessage(
          'Query processing resulted in null, not sending to Gemini.',
        );
        return { queryToSend: null, shouldProceed: false };
      }
      return { queryToSend: localQueryToSendToGemini, shouldProceed: true };
    },
    [
      config,
      addItem,
      onDebugMessage,
      handleShellCommand,
      handleSlashCommand,
      logger,
      shellModeActive,
      scheduleToolCalls,
      turnCancelledRef,
    ],
  );

  return {
    handleContentEvent,
    handleUserCancelledEvent,
    handleErrorEvent,
    handleCitationEvent,
    handleFinishedEvent,
    handleChatCompressionEvent,
    handleMaxSessionTurnsEvent,
    handleContextWindowWillOverflowEvent,
    handleLoopDetectedEvent,
    processGeminiStreamEvents,
    displayUserMessage,
    prepareQueryForGemini,
  };
}

export const __testing = {
  GEMINI_STREAM_IDLE_TIMEOUT_MS,
};
