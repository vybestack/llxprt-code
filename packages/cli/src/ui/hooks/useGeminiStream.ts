/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useInput } from 'ink';
import {
  Config,
  GeminiClient,
  GeminiEventType as ServerGeminiEventType,
  ServerGeminiStreamEvent as GeminiEvent,
  ServerGeminiContentEvent as ContentEvent,
  ServerGeminiErrorEvent as ErrorEvent,
  ServerGeminiChatCompressedEvent,
  getErrorMessage,
  isNodeError,
  MessageSenderType,
  ToolCallRequestInfo,
  logUserPrompt,
  GitService,
  EditorType,
  ThoughtSummary,
  UnauthorizedError,
  UserPromptEvent,
  DEFAULT_GEMINI_FLASH_MODEL,
} from '@google/gemini-cli-core';
import { type Part, type PartListUnion } from '@google/genai';
import {
  StreamingState,
  HistoryItem,
  HistoryItemWithoutId,
  HistoryItemToolGroup,
  HistoryItemGemini,
  HistoryItemGeminiContent,
  MessageType,
  SlashCommandProcessorResult,
  ToolCallStatus,
} from '../types.js';
import { isAtCommand } from '../utils/commandUtils.js';
import { parseAndFormatApiError } from '../utils/errorParsing.js';
import { useShellCommandProcessor } from './shellCommandProcessor.js';
import { handleAtCommand } from './atCommandProcessor.js';
import { findLastSafeSplitPoint } from '../utils/markdownUtilities.js';
import { useStateAndRef } from './useStateAndRef.js';
import { UseHistoryManagerReturn } from './useHistoryManager.js';
import { useLogger } from './useLogger.js';
import { promises as fs } from 'fs';
import path from 'path';
import {
  useReactToolScheduler,
  mapToDisplay as mapTrackedToolCallsToDisplay,
  TrackedToolCall,
  TrackedCompletedToolCall,
  TrackedCancelledToolCall,
} from './useReactToolScheduler.js';
import { getProviderManager } from '../../providers/providerManagerInstance.js';

export function mergePartListUnions(list: PartListUnion[]): PartListUnion {
  const resultParts: PartListUnion = [];
  for (const item of list) {
    if (Array.isArray(item)) {
      resultParts.push(...item);
    } else {
      resultParts.push(item);
    }
  }
  return resultParts;
}

enum StreamProcessingStatus {
  Completed,
  UserCancelled,
  Error,
}

/**
 * Get the display model name
 */
function getDisplayModelName(config: Config): string {
  return config.getModel();
}

/**
 * Manages the Gemini stream, including user input, command processing,
 * API interaction, and tool call lifecycle.
 */
export const useGeminiStream = (
  geminiClient: GeminiClient,
  history: HistoryItem[],
  addItem: UseHistoryManagerReturn['addItem'],
  setShowHelp: React.Dispatch<React.SetStateAction<boolean>>,
  config: Config,
  onDebugMessage: (message: string) => void,
  handleSlashCommand: (
    cmd: PartListUnion,
  ) => Promise<SlashCommandProcessorResult | false>,
  shellModeActive: boolean,
  getPreferredEditor: () => EditorType | undefined,
  onAuthError: () => void,
  performMemoryRefresh: () => Promise<void>,
) => {
  const [initError, setInitError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const turnCancelledRef = useRef(false);
  const [isResponding, setIsResponding] = useState<boolean>(false);
  const [thought, setThought] = useState<ThoughtSummary | null>(null);
  const [pendingHistoryItemRef, setPendingHistoryItem] =
    useStateAndRef<HistoryItemWithoutId | null>(null);
  const processedMemoryToolsRef = useRef<Set<string>>(new Set());
  const logger = useLogger();

  // NEW: Track announced tool calls and cancellation state
  const announcedToolCallsRef = useRef<
    Map<string, { name: string; announced: number }>
  >(new Map());
  const cancelledTurnRef = useRef(false);
  const gracePeriodTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const cancelledToolIdsRef = useRef<Set<string>>(new Set());
  const gitService = useMemo(() => {
    if (!config.getProjectRoot()) {
      return;
    }
    return new GitService(config.getProjectRoot());
  }, [config]);

  const [toolCalls, scheduleToolCalls, markToolsAsSubmitted] =
    useReactToolScheduler(
      async (completedToolCallsFromScheduler) => {
        // This onComplete is called when ALL scheduled tools for a given batch are done.
        if (completedToolCallsFromScheduler.length > 0) {
          // Add the final state of these tools to the history for display.
          addItem(
            mapTrackedToolCallsToDisplay(
              completedToolCallsFromScheduler as TrackedToolCall[],
            ),
            Date.now(),
          );

          // Handle tool response submission immediately when tools complete
          await handleCompletedTools(
            completedToolCallsFromScheduler as TrackedToolCall[],
          );
        }
      },
      config,
      setPendingHistoryItem,
      getPreferredEditor,
    );

  const pendingToolCallGroupDisplay = useMemo(
    () =>
      toolCalls.length ? mapTrackedToolCallsToDisplay(toolCalls) : undefined,
    [toolCalls],
  );

  const onExec = useCallback(async (done: Promise<void>) => {
    setIsResponding(true);
    await done;
    setIsResponding(false);
  }, []);
  const { handleShellCommand } = useShellCommandProcessor(
    addItem,
    setPendingHistoryItem,
    onExec,
    onDebugMessage,
    config,
    geminiClient,
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
            !(tc as TrackedCompletedToolCall | TrackedCancelledToolCall)
              .responseSubmittedToGemini),
      )
    ) {
      return StreamingState.Responding;
    }
    return StreamingState.Idle;
  }, [isResponding, toolCalls]);

  useInput((_input, key) => {
    if (streamingState === StreamingState.Responding && key.escape) {
      if (turnCancelledRef.current) {
        return;
      }

      onDebugMessage('[ESC] Cancellation initiated');
      onDebugMessage(
        `[ESC] Current tool calls: ${toolCalls
          .map((tc) => `${tc.request.name}(${tc.request.callId}):${tc.status}`)
          .join(', ')}`,
      );
      onDebugMessage(
        `[ESC] Announced tools: ${Array.from(
          announcedToolCallsRef.current.entries(),
        )
          .map(([id, info]) => `${info.name}(${id})`)
          .join(', ')}`,
      );

      turnCancelledRef.current = true;
      cancelledTurnRef.current = true;

      // Abort in-flight Gemini request to stop further stream processing
      abortControllerRef.current?.abort();

      // Handle any pending history items
      if (pendingHistoryItemRef.current) {
        addItem(pendingHistoryItemRef.current, Date.now());
      }

      // NEW: Handle pending tool calls for OpenAI and other providers
      const providerManager = getProviderManager();
      if (providerManager.hasActiveProvider()) {
        // Get all tool calls that have been submitted to the model
        const submittedIds = new Set(
          toolCalls
            .filter(
              (tc) =>
                (tc.status === 'success' ||
                  tc.status === 'error' ||
                  tc.status === 'cancelled') &&
                (tc as TrackedCompletedToolCall | TrackedCancelledToolCall)
                  .responseSubmittedToGemini,
            )
            .map((tc) => tc.request.callId),
        );

        const pendingCancellations: Part[] = [];

        // First, add cancellations for all announced tools that haven't been submitted
        announcedToolCallsRef.current.forEach((toolInfo, callId) => {
          if (
            !submittedIds.has(callId) &&
            !cancelledToolIdsRef.current.has(callId)
          ) {
            pendingCancellations.push({
              functionResponse: {
                id: callId,
                name: toolInfo.name,
                response: {
                  error: 'Operation cancelled by user',
                  llmContent:
                    'The operation was cancelled by the user pressing ESC.',
                },
              },
            });
            cancelledToolIdsRef.current.add(callId);
          }
        });

        // Also check for any tools in toolCalls that are in progress
        toolCalls.forEach((tc) => {
          if (
            !submittedIds.has(tc.request.callId) &&
            announcedToolCallsRef.current.has(tc.request.callId) &&
            tc.status !== 'cancelled' &&
            !cancelledToolIdsRef.current.has(tc.request.callId)
          ) {
            // Mark this tool as needing cancellation
            const toolInfo = announcedToolCallsRef.current.get(
              tc.request.callId,
            );
            if (
              toolInfo &&
              !pendingCancellations.some(
                (p) => p.functionResponse?.id === tc.request.callId,
              )
            ) {
              pendingCancellations.push({
                functionResponse: {
                  id: tc.request.callId,
                  name: toolInfo.name,
                  response: {
                    error: 'Operation cancelled by user',
                    llmContent:
                      'The operation was cancelled by the user pressing ESC.',
                  },
                },
              });
              cancelledToolIdsRef.current.add(tc.request.callId);
            }
          }
        });

        if (pendingCancellations.length > 0) {
          onDebugMessage(
            `[ESC] Sending ${pendingCancellations.length} cancellation responses for pending tool calls`,
          );
          // Send cancellation responses immediately
          submitQuery(pendingCancellations, {
            isContinuation: true,
            isCancellation: true,
          });
        }
      }

      // Clear announced tools tracking
      announcedToolCallsRef.current.clear();

      addItem(
        {
          type: MessageType.INFO,
          text: 'Request cancelled. Please wait a moment before sending a new message...',
        },
        Date.now(),
      );

      setPendingHistoryItem(null);
      setIsResponding(false);

      // NEW: Set grace period
      if (gracePeriodTimeoutRef.current) {
        clearTimeout(gracePeriodTimeoutRef.current);
      }
      gracePeriodTimeoutRef.current = setTimeout(() => {
        cancelledTurnRef.current = false;
        gracePeriodTimeoutRef.current = null;
        cancelledToolIdsRef.current.clear();
        onDebugMessage('[ESC] Grace period ended, new messages allowed');
      }, 500); // Half second grace period
    }
  });

  const prepareQueryForGemini = useCallback(
    async (
      query: PartListUnion,
      userMessageTimestamp: number,
      abortSignal: AbortSignal,
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
          new UserPromptEvent(trimmedQuery.length, trimmedQuery),
        );
        onDebugMessage(`User query: '${trimmedQuery}'`);
        await logger?.logMessage(MessageSenderType.USER, trimmedQuery);

        // Handle UI-only commands first
        const slashCommandResult = await handleSlashCommand(trimmedQuery);

        if (slashCommandResult) {
          if (slashCommandResult.type === 'schedule_tool') {
            const { toolName, toolArgs } = slashCommandResult;
            const toolCallRequest: ToolCallRequestInfo = {
              callId: `${toolName}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
              name: toolName,
              args: toolArgs,
              isClientInitiated: true,
            };
            scheduleToolCalls([toolCallRequest], abortSignal);
          }

          return { queryToSend: null, shouldProceed: false };
        }

        if (shellModeActive && handleShellCommand(trimmedQuery, abortSignal)) {
          return { queryToSend: null, shouldProceed: false };
        }

        // Handle @-commands (which might involve tool calls)
        if (isAtCommand(trimmedQuery)) {
          const atCommandResult = await handleAtCommand({
            query: trimmedQuery,
            config,
            addItem,
            onDebugMessage,
            messageId: userMessageTimestamp,
            signal: abortSignal,
          });
          if (!atCommandResult.shouldProceed) {
            return { queryToSend: null, shouldProceed: false };
          }
          localQueryToSendToGemini = atCommandResult.processedQuery;
        } else {
          // Normal query for Gemini
          addItem(
            { type: MessageType.USER, text: trimmedQuery },
            userMessageTimestamp,
          );
          localQueryToSendToGemini = trimmedQuery;
        }
      } else {
        // It's a function response (PartListUnion that isn't a string)
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
    ],
  );

  // --- Stream Event Handlers ---

  const handleContentEvent = useCallback(
    (
      eventValue: ContentEvent['value'],
      currentGeminiMessageBuffer: string,
      userMessageTimestamp: number,
    ): string => {
      if (turnCancelledRef.current) {
        // Prevents additional output after a user initiated cancel.
        return '';
      }
      let newGeminiMessageBuffer = currentGeminiMessageBuffer + eventValue;
      if (
        pendingHistoryItemRef.current?.type !== 'gemini' &&
        pendingHistoryItemRef.current?.type !== 'gemini_content'
      ) {
        if (pendingHistoryItemRef.current) {
          addItem(pendingHistoryItemRef.current, userMessageTimestamp);
        }
        setPendingHistoryItem({
          type: 'gemini',
          text: '',
          model: getDisplayModelName(config),
        });
        newGeminiMessageBuffer = eventValue;
      }
      // Split large messages for better rendering performance. Ideally,
      // we should maximize the amount of output sent to <Static />.
      const splitPoint = findLastSafeSplitPoint(newGeminiMessageBuffer);
      if (splitPoint === newGeminiMessageBuffer.length) {
        // Update the existing message with accumulated content
        setPendingHistoryItem((item) => ({
          type: item?.type as 'gemini' | 'gemini_content',
          text: newGeminiMessageBuffer,
          model:
            (item as Partial<HistoryItemGemini>)?.model ||
            getDisplayModelName(config),
        }));
      } else {
        // This indicates that we need to split up this Gemini Message.
        // Splitting a message is primarily a performance consideration. There is a
        // <Static> component at the root of App.tsx which takes care of rendering
        // content statically or dynamically. Everything but the last message is
        // treated as static in order to prevent re-rendering an entire message history
        // multiple times per-second (as streaming occurs). Prior to this change you'd
        // see heavy flickering of the terminal. This ensures that larger messages get
        // broken up so that there are more "statically" rendered.
        const beforeText = newGeminiMessageBuffer.substring(0, splitPoint);
        const afterText = newGeminiMessageBuffer.substring(splitPoint);
        const itemType = pendingHistoryItemRef.current?.type as
          | 'gemini'
          | 'gemini_content';
        const historyItem: HistoryItemGemini | HistoryItemGeminiContent = {
          type: itemType || 'gemini',
          text: beforeText,
          model:
            (pendingHistoryItemRef.current as Partial<HistoryItemGemini>)
              ?.model || getDisplayModelName(config),
        };
        addItem(historyItem, userMessageTimestamp);
        setPendingHistoryItem({
          type: 'gemini_content',
          text: afterText,
          model: getDisplayModelName(config),
        });
        newGeminiMessageBuffer = afterText;
      }
      return newGeminiMessageBuffer;
    },
    [addItem, pendingHistoryItemRef, setPendingHistoryItem, config],
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
          addItem(pendingHistoryItemRef.current, userMessageTimestamp);
        }
        setPendingHistoryItem(null);
      }
      addItem(
        { type: MessageType.INFO, text: 'User cancelled the request.' },
        userMessageTimestamp,
      );
      setIsResponding(false);
    },
    [addItem, pendingHistoryItemRef, setPendingHistoryItem],
  );

  const handleErrorEvent = useCallback(
    (eventValue: ErrorEvent['value'], userMessageTimestamp: number) => {
      if (pendingHistoryItemRef.current) {
        addItem(pendingHistoryItemRef.current, userMessageTimestamp);
        setPendingHistoryItem(null);
      }
      addItem(
        {
          type: MessageType.ERROR,
          text: parseAndFormatApiError(
            eventValue.error,
            config.getContentGeneratorConfig().authType,
            undefined,
            config.getModel(),
            DEFAULT_GEMINI_FLASH_MODEL,
          ),
        },
        userMessageTimestamp,
      );
    },
    [addItem, pendingHistoryItemRef, setPendingHistoryItem, config],
  );

  const handleChatCompressionEvent = useCallback(
    (eventValue: ServerGeminiChatCompressedEvent['value']) =>
      addItem(
        {
          type: 'info',
          text:
            `IMPORTANT: This conversation approached the input token limit for ${config.getModel()}. ` +
            `A compressed context will be sent for future messages (compressed from: ` +
            `${eventValue?.originalTokenCount ?? 'unknown'} to ` +
            `${eventValue?.newTokenCount ?? 'unknown'} tokens).`,
        },
        Date.now(),
      ),
    [addItem, config],
  );

  const processGeminiStreamEvents = useCallback(
    async (
      stream: AsyncIterable<GeminiEvent>,
      userMessageTimestamp: number,
      signal: AbortSignal,
    ): Promise<StreamProcessingStatus> => {
      let geminiMessageBuffer = '';
      const toolCallRequests: ToolCallRequestInfo[] = [];
      for await (const event of stream) {
        switch (event.type) {
          case ServerGeminiEventType.Thought:
            setThought(event.value);
            break;
          case ServerGeminiEventType.Content:
            geminiMessageBuffer = handleContentEvent(
              event.value,
              geminiMessageBuffer,
              userMessageTimestamp,
            );
            break;
          case ServerGeminiEventType.ToolCallRequest:
            toolCallRequests.push(event.value);
            // NEW: Track that this tool was announced
            announcedToolCallsRef.current.set(event.value.callId, {
              name: event.value.name,
              announced: Date.now(),
            });
            break;
          case ServerGeminiEventType.UserCancelled:
            handleUserCancelledEvent(userMessageTimestamp);
            break;
          case ServerGeminiEventType.Error:
            handleErrorEvent(event.value, userMessageTimestamp);
            break;
          case ServerGeminiEventType.ChatCompressed:
            handleChatCompressionEvent(event.value);
            break;
          case ServerGeminiEventType.UsageMetadata:
            console.log(
              '[useGeminiStream] 📊 USAGE EVENT RECEIVED:',
              JSON.stringify(event.value, null, 2),
            );
            // Token counting is handled by uiTelemetryService in main branch
            break;
          case ServerGeminiEventType.ToolCallConfirmation:
          case ServerGeminiEventType.ToolCallResponse:
            // do nothing
            break;
          default: {
            // enforces exhaustive switch-case
            const unreachable: never = event;
            return unreachable;
          }
        }
      }
      if (turnCancelledRef.current) {
        // Stop processing further events once the user has cancelled.
        return StreamProcessingStatus.UserCancelled;
      }

      if (toolCallRequests.length > 0) {
        scheduleToolCalls(toolCallRequests, signal);
      }
      return StreamProcessingStatus.Completed;
    },
    [
      handleContentEvent,
      handleUserCancelledEvent,
      handleErrorEvent,
      scheduleToolCalls,
      handleChatCompressionEvent,
    ],
  );

  const submitQuery = useCallback(
    async (
      query: PartListUnion,
      options?: {
        isContinuation?: boolean;
        isCancellation?: boolean;
      },
    ) => {
      // Check if we're in the grace period after cancellation
      if (cancelledTurnRef.current && !options?.isCancellation) {
        addItem(
          {
            type: MessageType.INFO,
            text: 'Please wait a moment for the cancellation to complete...',
          },
          Date.now(),
        );
        return;
      }

      if (
        (streamingState === StreamingState.Responding ||
          streamingState === StreamingState.WaitingForConfirmation) &&
        !options?.isContinuation
      )
        return;

      const userMessageTimestamp = Date.now();
      setShowHelp(false);

      abortControllerRef.current = new AbortController();
      const abortSignal = abortControllerRef.current.signal;
      turnCancelledRef.current = false;

      // Clear any previous cancellation tracking
      if (!options?.isCancellation) {
        cancelledToolIdsRef.current.clear();
      }

      const { queryToSend, shouldProceed } = await prepareQueryForGemini(
        query,
        userMessageTimestamp,
        abortSignal,
      );

      if (!shouldProceed || queryToSend === null) {
        return;
      }

      setIsResponding(true);
      setInitError(null);

      try {
        const stream = geminiClient.sendMessageStream(queryToSend, abortSignal);

        const processingStatus = await processGeminiStreamEvents(
          stream,
          userMessageTimestamp,
          abortSignal,
        );

        if (processingStatus === StreamProcessingStatus.UserCancelled) {
          return;
        }

        if (pendingHistoryItemRef.current) {
          addItem(pendingHistoryItemRef.current, userMessageTimestamp);
          setPendingHistoryItem(null);
        }
      } catch (err: unknown) {
        if (err instanceof UnauthorizedError) {
          onAuthError();
        } else if (!isNodeError(err) || err.name !== 'AbortError') {
          addItem(
            {
              type: MessageType.ERROR,
              text: parseAndFormatApiError(
                getErrorMessage(err) || 'Unknown error',
                config.getContentGeneratorConfig().authType,
                undefined,
                config.getModel(),
                DEFAULT_GEMINI_FLASH_MODEL,
              ),
            },
            userMessageTimestamp,
          );
        }
      } finally {
        setIsResponding(false);
      }
    },
    [
      streamingState,
      setShowHelp,
      prepareQueryForGemini,
      processGeminiStreamEvents,
      pendingHistoryItemRef,
      addItem,
      setPendingHistoryItem,
      setInitError,
      geminiClient,
      onAuthError,
      config,
    ],
  );

  const handleCompletedTools = useCallback(
    async (completedToolCallsFromScheduler: TrackedToolCall[]) => {
      if (isResponding) {
        return;
      }

      const completedAndReadyToSubmitTools =
        completedToolCallsFromScheduler.filter(
          (
            tc: TrackedToolCall,
          ): tc is TrackedCompletedToolCall | TrackedCancelledToolCall => {
            const isTerminalState =
              tc.status === 'success' ||
              tc.status === 'error' ||
              tc.status === 'cancelled';

            if (isTerminalState) {
              const completedOrCancelledCall = tc as
                | TrackedCompletedToolCall
                | TrackedCancelledToolCall;
              return (
                completedOrCancelledCall.response?.responseParts !== undefined
              );
            }
            return false;
          },
        );

      // Finalize any client-initiated tools as soon as they are done.
      const clientTools = completedAndReadyToSubmitTools.filter(
        (t) => t.request.isClientInitiated,
      );
      if (clientTools.length > 0) {
        markToolsAsSubmitted(clientTools.map((t) => t.request.callId));
      }

      // Identify new, successful save_memory calls that we haven't processed yet.
      const newSuccessfulMemorySaves = completedAndReadyToSubmitTools.filter(
        (t) =>
          t.request.name === 'save_memory' &&
          t.status === 'success' &&
          !processedMemoryToolsRef.current.has(t.request.callId),
      );

      if (newSuccessfulMemorySaves.length > 0) {
        // Perform the refresh only if there are new ones.
        void performMemoryRefresh();
        // Mark them as processed so we don't do this again on the next render.
        newSuccessfulMemorySaves.forEach((t) =>
          processedMemoryToolsRef.current.add(t.request.callId),
        );
      }

      const geminiTools = completedAndReadyToSubmitTools.filter(
        (t) => !t.request.isClientInitiated,
      );

      if (geminiTools.length === 0) {
        return;
      }

      // If all the tools were cancelled, don't submit a response to Gemini.
      const allToolsCancelled = geminiTools.every(
        (tc) => tc.status === 'cancelled',
      );

      if (allToolsCancelled) {
        if (geminiClient) {
          // We need to manually add the function responses to the history
          // so the model knows the tools were cancelled.
          const responsesToAdd = geminiTools.flatMap(
            (toolCall) => toolCall.response.responseParts,
          );
          const combinedParts: Part[] = [];
          for (const response of responsesToAdd) {
            if (Array.isArray(response)) {
              combinedParts.push(...response);
            } else if (typeof response === 'string') {
              combinedParts.push({ text: response });
            } else {
              combinedParts.push(response);
            }
          }
          geminiClient.addHistory({
            role: 'user',
            parts: combinedParts,
          });
        }

        const callIdsToMarkAsSubmitted = geminiTools.map(
          (toolCall) => toolCall.request.callId,
        );
        markToolsAsSubmitted(callIdsToMarkAsSubmitted);
        return;
      }

      const responsesToSend: PartListUnion[] = geminiTools.map((toolCall) => {
        // Ensure the response is properly formatted with the callId
        const response: PartListUnion = toolCall.response.responseParts;

        // Enhanced debug logging
        onDebugMessage(
          `[RESPONSE_DEBUG] Processing ${toolCall.request.name} (${toolCall.request.callId})`,
        );
        onDebugMessage(
          `[RESPONSE_DEBUG] responseParts type: ${typeof response}, isArray: ${Array.isArray(response)}`,
        );
        if (response) {
          onDebugMessage(
            `[RESPONSE_DEBUG] responseParts content: ${JSON.stringify(response).substring(0, 300)}`,
          );
        }

        // Debug logging for multiple tool responses
        if (geminiTools.length > 1) {
          onDebugMessage(
            `Processing tool response for ${toolCall.request.name} (${toolCall.request.callId}), type: ${typeof response}, isArray: ${Array.isArray(response)}`,
          );
          if (response && typeof response === 'object') {
            onDebugMessage(
              `Response structure: ${JSON.stringify(response).substring(0, 200)}`,
            );
          }
        }

        // Additional debug for tool call ID tracking
        onDebugMessage(
          `[TOOL_ID_DEBUG] Processing ${toolCall.request.name} with callId: ${toolCall.request.callId}`,
        );

        // If it's already a functionResponse, ensure it has the correct id
        if (Array.isArray(response)) {
          return response.map((part) => {
            if (
              part &&
              typeof part === 'object' &&
              'functionResponse' in part
            ) {
              // Ensure the functionResponse has the correct id
              const finalId =
                part.functionResponse?.id || toolCall.request.callId;
              onDebugMessage(
                `[TOOL_ID_DEBUG] Array part - Setting ID for ${part.functionResponse?.name}: ${finalId}`,
              );
              return {
                functionResponse: {
                  ...part.functionResponse,
                  id: finalId,
                },
              } as Part;
            }
            return part;
          });
        } else if (
          response &&
          typeof response === 'object' &&
          'functionResponse' in response
        ) {
          // Single functionResponse object (Part with functionResponse property)
          const responsePart = response as Part;
          const finalId =
            responsePart.functionResponse?.id || toolCall.request.callId;
          onDebugMessage(
            `[TOOL_ID_DEBUG] Single part - Setting ID for ${responsePart.functionResponse?.name}: ${finalId}`,
          );
          return {
            functionResponse: {
              ...responsePart.functionResponse,
              id: finalId,
            },
          } as Part;
        } else if (typeof response === 'string') {
          // If it's a string, wrap it in a functionResponse
          onDebugMessage(
            `[TOOL_ID_DEBUG] String response - Creating functionResponse for ${toolCall.request.name} with ID: ${toolCall.request.callId}`,
          );
          return {
            functionResponse: {
              id: toolCall.request.callId,
              name: toolCall.request.name,
              response: { output: response } as Record<string, unknown>,
            },
          } as Part;
        }

        // Return as-is if it's not a functionResponse (shouldn't happen with proper tool execution)
        onDebugMessage(
          `WARNING: Tool response for ${toolCall.request.name} is not in expected format: ${JSON.stringify(response).substring(0, 100)}`,
        );

        // Emergency fallback: if response has any structure, try to ensure it has an ID
        if (response && typeof response === 'object') {
          onDebugMessage(
            `[EMERGENCY] Attempting to fix response structure for ${toolCall.request.name}`,
          );
          // Check if it's a Part array that we missed
          if (Array.isArray(response)) {
            return response.map((part) => {
              if (
                part &&
                typeof part === 'object' &&
                'functionResponse' in part &&
                !part.functionResponse?.id
              ) {
                onDebugMessage(
                  `[EMERGENCY] Found functionResponse without ID in array, adding: ${toolCall.request.callId}`,
                );
                return {
                  functionResponse: {
                    ...part.functionResponse,
                    id: toolCall.request.callId,
                    name: part.functionResponse.name || toolCall.request.name,
                  },
                } as Part;
              }
              return part;
            });
          }
          // Check if it's a bare functionResponse without wrapper
          if ('response' in response && !('functionResponse' in response)) {
            onDebugMessage(
              `[EMERGENCY] Found bare response object, wrapping with functionResponse`,
            );
            return {
              functionResponse: {
                id: toolCall.request.callId,
                name: toolCall.request.name,
                response:
                  (response as { response: Record<string, unknown> })
                    .response || (response as Record<string, unknown>),
              },
            } as Part;
          }
        }

        return response;
      });
      const callIdsToMarkAsSubmitted = geminiTools.map(
        (toolCall) => toolCall.request.callId,
      );

      markToolsAsSubmitted(callIdsToMarkAsSubmitted);

      // Clear announced tools tracking after successful submission
      callIdsToMarkAsSubmitted.forEach((id) => {
        announcedToolCallsRef.current.delete(id);
      });

      // Clear cancellation state if all tools are complete
      if (announcedToolCallsRef.current.size === 0) {
        cancelledTurnRef.current = false;
        cancelledToolIdsRef.current.clear();
        if (gracePeriodTimeoutRef.current) {
          clearTimeout(gracePeriodTimeoutRef.current);
          gracePeriodTimeoutRef.current = null;
        }
      }

      const mergedResponses = mergePartListUnions(responsesToSend);
      if (geminiTools.length > 1) {
        onDebugMessage(
          `Submitting merged tool responses: ${JSON.stringify(mergedResponses).substring(0, 300)}`,
        );
      }

      // Debug: Verify all function responses have IDs
      onDebugMessage(`[TOOL_ID_DEBUG] Final merged responses before submit:`);
      if (Array.isArray(mergedResponses)) {
        (mergedResponses as Part[]).forEach((part: Part, idx: number) => {
          if (
            part &&
            typeof part === 'object' &&
            'functionResponse' in part &&
            part.functionResponse
          ) {
            onDebugMessage(
              `[TOOL_ID_DEBUG] Part ${idx}: ${part.functionResponse.name} has ID: ${part.functionResponse.id}`,
            );

            // Final safety check: ensure ID exists
            if (!part.functionResponse.id) {
              onDebugMessage(
                `[CRITICAL] Missing ID for ${part.functionResponse.name}, this will cause an error!`,
              );
              // Try to find the corresponding tool call to get the ID
              const matchingTool = geminiTools.find(
                (t) => t.request.name === part.functionResponse?.name,
              );
              if (matchingTool) {
                onDebugMessage(
                  `[CRITICAL] Found matching tool, adding ID: ${matchingTool.request.callId}`,
                );
                part.functionResponse.id = matchingTool.request.callId;
              }
            }
          }
        });
      } else {
        onDebugMessage(
          `[TOOL_ID_DEBUG] mergedResponses is not an array: ${typeof mergedResponses}`,
        );
      }

      submitQuery(mergedResponses, {
        isContinuation: true,
      });
    },
    [
      isResponding,
      submitQuery,
      markToolsAsSubmitted,
      geminiClient,
      performMemoryRefresh,
      onDebugMessage,
    ],
  );

  const pendingHistoryItems = [
    pendingHistoryItemRef.current,
    pendingToolCallGroupDisplay,
  ].filter((i) => i !== undefined && i !== null);

  useEffect(() => {
    const saveRestorableToolCalls = async () => {
      if (!config.getCheckpointingEnabled()) {
        return;
      }
      const restorableToolCalls = toolCalls.filter(
        (toolCall) =>
          (toolCall.request.name === 'replace' ||
            toolCall.request.name === 'write_file') &&
          toolCall.status === 'awaiting_approval',
      );

      if (restorableToolCalls.length > 0) {
        const checkpointDir = config.getProjectTempDir()
          ? path.join(config.getProjectTempDir(), 'checkpoints')
          : undefined;

        if (!checkpointDir) {
          return;
        }

        try {
          await fs.mkdir(checkpointDir, { recursive: true });
        } catch (error) {
          if (!isNodeError(error) || error.code !== 'EEXIST') {
            onDebugMessage(
              `Failed to create checkpoint directory: ${getErrorMessage(error)}`,
            );
            return;
          }
        }

        for (const toolCall of restorableToolCalls) {
          const filePath = toolCall.request.args['file_path'] as string;
          if (!filePath) {
            onDebugMessage(
              `Skipping restorable tool call due to missing file_path: ${toolCall.request.name}`,
            );
            continue;
          }

          try {
            let commitHash = await gitService?.createFileSnapshot(
              `Snapshot for ${toolCall.request.name}`,
            );

            if (!commitHash) {
              commitHash = await gitService?.getCurrentCommitHash();
            }

            if (!commitHash) {
              onDebugMessage(
                `Failed to create snapshot for ${filePath}. Skipping restorable tool call.`,
              );
              continue;
            }

            const timestamp = new Date()
              .toISOString()
              .replace(/:/g, '-')
              .replace(/\./g, '_');
            const toolName = toolCall.request.name;
            const fileName = path.basename(filePath);
            const toolCallWithSnapshotFileName = `${timestamp}-${fileName}-${toolName}.json`;
            const clientHistory = await geminiClient?.getHistory();
            const toolCallWithSnapshotFilePath = path.join(
              checkpointDir,
              toolCallWithSnapshotFileName,
            );

            await fs.writeFile(
              toolCallWithSnapshotFilePath,
              JSON.stringify(
                {
                  history,
                  clientHistory,
                  toolCall: {
                    name: toolCall.request.name,
                    args: toolCall.request.args,
                  },
                  commitHash,
                  filePath,
                },
                null,
                2,
              ),
            );
          } catch (error) {
            onDebugMessage(
              `Failed to write restorable tool call file: ${getErrorMessage(
                error,
              )}`,
            );
          }
        }
      }
    };
    saveRestorableToolCalls();
  }, [toolCalls, config, onDebugMessage, gitService, history, geminiClient]);

  return {
    streamingState,
    submitQuery,
    initError,
    pendingHistoryItems,
    thought,
    isInGracePeriod: cancelledTurnRef.current,
  };
};
