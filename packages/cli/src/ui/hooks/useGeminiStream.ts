/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  Config,
  GeminiClient,
  GeminiEventType as ServerGeminiEventType,
  ServerGeminiStreamEvent as GeminiEvent,
  ServerGeminiContentEvent as ContentEvent,
  ServerGeminiErrorEvent as ErrorEvent,
  ServerGeminiChatCompressedEvent,
  ServerGeminiFinishedEvent,
  ServerGeminiContextWindowWillOverflowEvent,
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
  parseAndFormatApiError,
  getCodeAssistServer,
  UserTierId,
  ServerGeminiCitationEvent,
  EmojiFilter,
  type EmojiFilterMode,
  DEFAULT_AGENT_ID,
  type ThinkingBlock,
  tokenLimit,
  DebugLogger,
  uiTelemetryService,
} from '@vybestack/llxprt-code-core';
import { type Part, type PartListUnion, FinishReason } from '@google/genai';
import { LoadedSettings } from '../../config/settings.js';
import {
  StreamingState,
  HistoryItem,
  HistoryItemWithoutId,
  HistoryItemToolGroup,
  MessageType,
  SlashCommandProcessorResult,
  ToolCallStatus,
} from '../types.js';
import { isAtCommand, isSlashCommand } from '../utils/commandUtils.js';
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
import { SHELL_COMMAND_NAME, SHELL_NAME } from '../constants.js';
import { useSessionStats } from '../contexts/SessionContext.js';
import { useKeypress, type Key } from './useKeypress.js';

const SYSTEM_NOTICE_EVENT = 'system_notice' as const;

export function mergePartListUnions(list: PartListUnion[]): PartListUnion {
  const resultParts: Part[] = [];
  for (const item of list) {
    if (Array.isArray(item)) {
      // Each element in the array can be a string or Part
      for (const part of item) {
        if (typeof part === 'string') {
          resultParts.push({ text: part });
        } else {
          resultParts.push(part);
        }
      }
    } else if (typeof item === 'string') {
      resultParts.push({ text: item });
    } else {
      resultParts.push(item);
    }
  }
  return resultParts;
}

export function mergePendingToolGroupsForDisplay(
  pendingHistoryItem: HistoryItemWithoutId | null | undefined,
  pendingToolCallGroupDisplay: HistoryItemWithoutId | null | undefined,
): HistoryItemWithoutId[] {
  if (
    pendingHistoryItem?.type === 'tool_group' &&
    pendingToolCallGroupDisplay?.type === 'tool_group'
  ) {
    const schedulerToolCallIds = new Set(
      pendingToolCallGroupDisplay.tools.map((tool) => tool.callId),
    );

    const overlappingCallIds = new Set(
      pendingHistoryItem.tools
        .filter((tool) => schedulerToolCallIds.has(tool.callId))
        .map((tool) => tool.callId),
    );

    if (overlappingCallIds.size === 0) {
      return [pendingHistoryItem, pendingToolCallGroupDisplay];
    }

    const filteredPendingTools = pendingHistoryItem.tools.filter(
      (tool) =>
        !overlappingCallIds.has(tool.callId) ||
        tool.name !== SHELL_COMMAND_NAME,
    );

    const overlappingShellTools = pendingHistoryItem.tools.filter(
      (tool) =>
        overlappingCallIds.has(tool.callId) &&
        (tool.name === SHELL_COMMAND_NAME || tool.name === SHELL_NAME),
    );
    const overlappingShellCallIds = new Set(
      overlappingShellTools.map((tool) => tool.callId),
    );
    const filteredSchedulerTools = pendingToolCallGroupDisplay.tools.filter(
      (tool) => !overlappingShellCallIds.has(tool.callId),
    );

    const mergedItems: HistoryItemWithoutId[] = [];

    if (filteredPendingTools.length > 0 || overlappingShellTools.length > 0) {
      mergedItems.push({
        ...pendingHistoryItem,
        tools: [...filteredPendingTools, ...overlappingShellTools],
      });
    }

    if (filteredSchedulerTools.length > 0) {
      mergedItems.push({
        ...pendingToolCallGroupDisplay,
        tools: filteredSchedulerTools,
      });
    }

    return mergedItems;
  }

  return [pendingHistoryItem, pendingToolCallGroupDisplay].filter(
    (i): i is HistoryItemWithoutId => i !== undefined && i !== null,
  );
}

enum StreamProcessingStatus {
  Completed,
  UserCancelled,
  Error,
}

interface QueuedSubmission {
  query: PartListUnion;
  options?: { isContinuation: boolean };
  promptId?: string;
}

function showCitations(settings: LoadedSettings, config: Config): boolean {
  // Try settings service first (consistent with core/turn.ts)
  try {
    const settingsService = config.getSettingsService();
    if (settingsService) {
      const enabled = settingsService.get('ui.showCitations');
      if (enabled !== undefined) {
        return enabled as boolean;
      }
    }
  } catch {
    // Fall through to other methods
  }

  // Fallback: check loaded settings for backwards compatibility
  const enabled = (settings?.merged as { ui?: { showCitations?: boolean } })?.ui
    ?.showCitations;
  if (enabled !== undefined) {
    return enabled;
  }

  // Final fallback: check user tier
  const server = getCodeAssistServer(config);
  return (server && server.userTier !== UserTierId.FREE) ?? false;
}

const geminiStreamLogger = new DebugLogger('llxprt:ui:gemini-stream');

/**
 * Manages the Gemini stream, including user input, command processing,
 * API interaction, and tool call lifecycle.
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
  activeProfileName: string | null = null,
) => {
  const [initError, setInitError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const turnCancelledRef = useRef(false);
  const [isResponding, setIsResponding] = useState<boolean>(false);
  const lastProfileNameRef = useRef<string | undefined>(undefined);
  // Issue #1113: Track tool completions that happened while isResponding was true
  // This handles the race condition where fast tools complete before the stream ends
  // We store the actual completed tools because useReactToolScheduler clears toolCalls
  // after onAllToolCallsComplete fires
  const pendingToolCompletionsRef = useRef<TrackedToolCall[]>([]);
  const [thought, setThought] = useState<ThoughtSummary | null>(null);
  const [pendingHistoryItem, pendingHistoryItemRef, setPendingHistoryItem] =
    useStateAndRef<HistoryItemWithoutId | null>(null);
  const processedMemoryToolsRef = useRef<Set<string>>(new Set());
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

  // @plan:PLAN-20251202-THINKING-UI.P08
  // @requirement:REQ-THINK-UI-001
  const thinkingBlocksRef = useRef<ThinkingBlock[]>([]);

  // Initialize emoji filter
  const emojiFilter = useMemo(() => {
    const emojiFilterMode =
      typeof config.getEphemeralSetting === 'function'
        ? (config.getEphemeralSetting('emojifilter') as EmojiFilterMode) ||
          'auto'
        : 'auto';

    return emojiFilterMode !== 'allowed'
      ? new EmojiFilter({ mode: emojiFilterMode })
      : undefined;
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

        // @plan:PLAN-20251202-THINKING-UI.P08
        // @requirement:REQ-THINK-UI-003
        // Always include thinkingBlocks for storage (display is controlled separately)
        const itemWithThinking = {
          ...pending,
          text: sanitized,
          ...(thinkingBlocksRef.current.length > 0
            ? { thinkingBlocks: [...thinkingBlocksRef.current] }
            : {}),
        };

        addItem(itemWithThinking, timestamp);

        // Clear thinking blocks after committing to history to prevent
        // accumulation across multiple tool calls in the same turn (fixes #922)
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
  const gitService = useMemo(() => {
    if (!config.getProjectRoot()) {
      return;
    }
    return new GitService(config.getProjectRoot(), storage);
  }, [config, storage]);

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

        // Record tool calls with full metadata before sending responses.
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
          console.error(
            `Error recording completed tool call information: ${error}`,
          );
        }

        // Handle tool response submission immediately when tools complete
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
  );

  const pendingToolCallGroupDisplay = useMemo(
    () =>
      toolCalls.length ? mapTrackedToolCallsToDisplay(toolCalls) : undefined,
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
            !(tc as TrackedCompletedToolCall | TrackedCancelledToolCall)
              .responseSubmittedToGemini),
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
      // Synchronously clear the tool queue and mark active tools as cancelled in the UI.
      // This prevents race conditions where late-arriving cancellation events might be missed.
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

        onDebugMessage(`User query: '${trimmedQuery}'`);
        await logger?.logMessage(MessageSenderType.USER, trimmedQuery);

        if (!shellModeActive) {
          // Handle UI-only commands first
          const slashCommandResult = isSlashCommand(trimmedQuery)
            ? await handleSlashCommand(trimmedQuery)
            : false;

          if (slashCommandResult) {
            switch (slashCommandResult.type) {
              case 'schedule_tool': {
                const { toolName, toolArgs } = slashCommandResult;
                const toolCallRequest: ToolCallRequestInfo = {
                  callId: `${toolName}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                  name: toolName,
                  args: toolArgs,
                  isClientInitiated: true,
                  prompt_id,
                  agentId: DEFAULT_AGENT_ID,
                };
                scheduleToolCalls([toolCallRequest], abortSignal);
                return { queryToSend: null, shouldProceed: false };
              }
              case 'submit_prompt': {
                localQueryToSendToGemini = slashCommandResult.content;

                return {
                  queryToSend: localQueryToSendToGemini,
                  shouldProceed: true,
                };
              }
              case 'handled': {
                return { queryToSend: null, shouldProceed: false };
              }
              default: {
                const unreachable: never = slashCommandResult;
                throw new Error(
                  `Unhandled slash command result type: ${unreachable}`,
                );
              }
            }
          }
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

          // User message already displayed in submitQuery before this function was called

          if (!atCommandResult.shouldProceed) {
            return { queryToSend: null, shouldProceed: false };
          }
          localQueryToSendToGemini = atCommandResult.processedQuery;
        } else {
          // Normal query for Gemini
          // User message already displayed in submitQuery before this function was called
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

        if (feedback) {
          addItem(
            { type: MessageType.INFO, text: feedback },
            userMessageTimestamp,
          );
        }

        return currentGeminiMessageBuffer;
      }

      if (feedback) {
        addItem(
          { type: MessageType.INFO, text: feedback },
          userMessageTimestamp,
        );
      }

      if (
        pendingHistoryItemRef.current?.type !== 'gemini' &&
        pendingHistoryItemRef.current?.type !== 'gemini_content'
      ) {
        if (pendingHistoryItemRef.current) {
          flushPendingHistoryItem(userMessageTimestamp);
        }
        // @plan:PLAN-20251202-THINKING-UI.P08
        // Include thinkingBlocks in pending item so they display during streaming
        setPendingHistoryItem({
          type: 'gemini',
          text: '',
          ...(thinkingBlocksRef.current.length > 0
            ? { thinkingBlocks: [...thinkingBlocksRef.current] }
            : {}),
        });
      }

      const splitPoint = findLastSafeSplitPoint(sanitizedCombined);
      if (splitPoint === sanitizedCombined.length) {
        // @plan:PLAN-20251202-THINKING-UI.P08
        // Preserve thinkingBlocks during streaming updates
        setPendingHistoryItem((item) => ({
          type: item?.type as 'gemini' | 'gemini_content',
          text: sanitizedCombined,
          ...(thinkingBlocksRef.current.length > 0
            ? { thinkingBlocks: [...thinkingBlocksRef.current] }
            : {}),
        }));
        return sanitizedCombined;
      }

      const beforeText = sanitizedCombined.substring(0, splitPoint);
      const afterText = sanitizedCombined.substring(splitPoint);

      const pendingType =
        pendingHistoryItemRef.current?.type === 'gemini_content'
          ? 'gemini_content'
          : 'gemini';

      if (beforeText) {
        // @plan:PLAN-20251202-THINKING-UI.P08
        // @requirement:REQ-THINK-UI-003
        // Always include thinkingBlocks for storage (display is controlled separately)
        addItem(
          {
            type: pendingType,
            text: beforeText,
            ...(thinkingBlocksRef.current.length > 0
              ? { thinkingBlocks: [...thinkingBlocksRef.current] }
              : {}),
          },
          userMessageTimestamp,
        );

        // Clear thinking blocks after committing to prevent duplication
        // on subsequent gemini_content items (#1272)
        thinkingBlocksRef.current = [];
      }

      setPendingHistoryItem({
        type: 'gemini_content',
        text: afterText,
      });
      return afterText;
    },
    [
      addItem,
      pendingHistoryItemRef,
      sanitizeContent,
      setPendingHistoryItem,
      flushPendingHistoryItem,
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
      setThought(null); // Reset thought when user cancels
    },
    [
      addItem,
      pendingHistoryItemRef,
      setPendingHistoryItem,
      setThought,
      flushPendingHistoryItem,
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
            DEFAULT_GEMINI_FLASH_MODEL,
          ),
        },
        userMessageTimestamp,
      );
      setThought(null); // Reset thought when there's an error
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
      const finishReason = event.value.reason;

      const finishReasonMessages: Record<FinishReason, string | undefined> = {
        [FinishReason.FINISH_REASON_UNSPECIFIED]: undefined,
        [FinishReason.STOP]: undefined,
        [FinishReason.MAX_TOKENS]: 'Response truncated due to token limits.',
        [FinishReason.SAFETY]: 'Response stopped due to safety reasons.',
        [FinishReason.RECITATION]: 'Response stopped due to recitation policy.',
        [FinishReason.LANGUAGE]:
          'Response stopped due to unsupported language.',
        [FinishReason.BLOCKLIST]: 'Response stopped due to forbidden terms.',
        [FinishReason.PROHIBITED_CONTENT]:
          'Response stopped due to prohibited content.',
        [FinishReason.SPII]:
          'Response stopped due to sensitive personally identifiable information.',
        [FinishReason.OTHER]: 'Response stopped for other reasons.',
        [FinishReason.MALFORMED_FUNCTION_CALL]:
          'Response stopped due to malformed function call.',
        [FinishReason.IMAGE_SAFETY]:
          'Response stopped due to image safety violations.',
        [FinishReason.UNEXPECTED_TOOL_CALL]:
          'Response stopped due to unexpected tool call.',
        [FinishReason.IMAGE_PROHIBITED_CONTENT]:
          'Response stopped due to prohibited content.',
        [FinishReason.NO_IMAGE]: 'Response stopped due to no image.',
      };

      const message = finishReasonMessages[finishReason];
      if (message) {
        addItem(
          {
            type: 'info',
            text: `⚠️  ${message}`,
          },
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
      for await (const event of stream) {
        if ((event as { type?: unknown }).type === SYSTEM_NOTICE_EVENT) {
          // SystemNotice events are internal model reminders, not for user display
          // They are consumed here but not added to visible history
          continue;
        }
        switch (event.type) {
          case ServerGeminiEventType.Thought:
            // @plan:PLAN-20251202-THINKING-UI.P08
            // @requirement:REQ-THINK-UI-001
            setThought(event.value);

            // Accumulate as ThinkingBlock for history
            {
              let thoughtText = [event.value.subject, event.value.description]
                .filter(Boolean)
                .join(': ');
              const sanitized = sanitizeContent(thoughtText);
              thoughtText = sanitized.blocked ? '' : sanitized.text;

              // Only add if this exact thought hasn't been added yet (fixes #922 duplicate thoughts)
              const alreadyHasThought = thinkingBlocksRef.current.some(
                (tb) => tb.thought === thoughtText,
              );

              if (thoughtText && !alreadyHasThought) {
                const thinkingBlock: ThinkingBlock = {
                  type: 'thinking',
                  thought: thoughtText,
                  sourceField: 'thought',
                };
                thinkingBlocksRef.current.push(thinkingBlock);

                // Update pending history item with thinking blocks so they
                // are visible in pendingHistoryItems during streaming
                setPendingHistoryItem((item) => ({
                  type: (item?.type as 'gemini' | 'gemini_content') || 'gemini',
                  text: item?.text || '',
                  thinkingBlocks: [...thinkingBlocksRef.current],
                }));
              }
            }
            break;
          case ServerGeminiEventType.Content:
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
            handleUserCancelledEvent(userMessageTimestamp);
            break;
          case ServerGeminiEventType.Error:
            handleErrorEvent(event.value, userMessageTimestamp);
            break;
          case ServerGeminiEventType.ChatCompressed:
            handleChatCompressionEvent(event.value, userMessageTimestamp);
            break;
          case ServerGeminiEventType.ToolCallConfirmation:
          case ServerGeminiEventType.ToolCallResponse:
            // do nothing
            break;
          case ServerGeminiEventType.MaxSessionTurns:
            handleMaxSessionTurnsEvent();
            break;
          case ServerGeminiEventType.ContextWindowWillOverflow:
            handleContextWindowWillOverflowEvent(
              (event as ServerGeminiContextWindowWillOverflowEvent).value
                .estimatedRequestTokenCount,
              (event as ServerGeminiContextWindowWillOverflowEvent).value
                .remainingTokenCount,
            );
            break;
          case ServerGeminiEventType.Finished:
            handleFinishedEvent(
              event as ServerGeminiFinishedEvent,
              userMessageTimestamp,
            );
            break;
          case ServerGeminiEventType.LoopDetected:
            // handle later because we want to move pending history to history
            // before we add loop detected message to history
            loopDetectedRef.current = true;
            break;
          case ServerGeminiEventType.UsageMetadata:
            if (event.value.promptTokenCount !== undefined) {
              uiTelemetryService.setLastPromptTokenCount(
                event.value.promptTokenCount,
              );
            }
            break;
          case ServerGeminiEventType.Citation:
            handleCitationEvent(
              (event as ServerGeminiCitationEvent).value,
              userMessageTimestamp,
            );
            break;
          case ServerGeminiEventType.Retry:
          case ServerGeminiEventType.InvalidStream:
            // Will add the missing logic later
            break;
          default:
            break;
        }
      }
      if (toolCallRequests.length > 0) {
        // Issue #1040: Deduplicate tool call requests by callId to prevent
        // the same command from being executed twice. This can happen when
        // the provider stream emits the same tool call multiple times.
        const seenCallIds = new Set<string>();
        const dedupedToolCallRequests = toolCallRequests.filter((request) => {
          if (seenCallIds.has(request.callId)) {
            return false;
          }
          seenCallIds.add(request.callId);
          return true;
        });

        if (dedupedToolCallRequests.length > 0) {
          scheduleToolCalls(dedupedToolCallRequests, signal);
        }
      }
      return StreamProcessingStatus.Completed;
    },
    [
      handleContentEvent,
      handleUserCancelledEvent,
      handleErrorEvent,
      scheduleToolCalls,
      handleChatCompressionEvent,
      handleFinishedEvent,
      handleMaxSessionTurnsEvent,
      handleContextWindowWillOverflowEvent,
      handleCitationEvent,
      sanitizeContent,
      setPendingHistoryItem,
    ],
  );

  const submitQuery = useCallback(
    async (
      query: PartListUnion,
      options?: { isContinuation: boolean },
      prompt_id?: string,
    ) => {
      if (
        (streamingState === StreamingState.Responding ||
          streamingState === StreamingState.WaitingForConfirmation) &&
        !options?.isContinuation
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

      if (!prompt_id) {
        prompt_id = config.getSessionId() + '########' + getPromptCount();
      }

      // Display user message IMMEDIATELY for string queries (not continuations)
      // This ensures the user sees their input right away, before any async processing
      if (
        typeof query === 'string' &&
        query.trim().length > 0 &&
        !options?.isContinuation
      ) {
        const trimmedQuery = query.trim();
        addItem(
          { type: MessageType.USER, text: trimmedQuery },
          userMessageTimestamp,
        );

        // Profile change detection
        // Read the showProfileChangeInChat setting
        const showProfileChangeInChat =
          settings?.merged?.showProfileChangeInChat ?? true;

        if (
          showProfileChangeInChat &&
          activeProfileName &&
          lastProfileNameRef.current !== undefined &&
          activeProfileName !== lastProfileNameRef.current
        ) {
          // Profile changed since last turn
          addItem(
            {
              type: 'profile_change',
              profileName: activeProfileName,
            } as Omit<HistoryItem, 'id'>,
            userMessageTimestamp,
          );
        }

        // Always update lastProfileNameRef on new turns
        lastProfileNameRef.current = activeProfileName ?? undefined;
      }

      const { queryToSend, shouldProceed } = await prepareQueryForGemini(
        query,
        userMessageTimestamp,
        abortSignal,
        prompt_id!,
      );

      if (!shouldProceed || queryToSend === null) {
        scheduleNextQueuedSubmission();
        return;
      }

      if (!options?.isContinuation) {
        startNewPrompt();
        setThought(null); // Reset thought when starting a new prompt
        // @plan:PLAN-20251202-THINKING-UI.P08
        thinkingBlocksRef.current = [];
      }

      setIsResponding(true);
      setInitError(null);

      try {
        const stream = geminiClient.sendMessageStream(
          queryToSend,
          abortSignal,
          prompt_id!,
        );
        const processingStatus = await processGeminiStreamEvents(
          stream,
          userMessageTimestamp,
          abortSignal,
        );

        if (processingStatus === StreamProcessingStatus.UserCancelled) {
          return;
        }

        if (pendingHistoryItemRef.current) {
          flushPendingHistoryItem(userMessageTimestamp);
          setPendingHistoryItem(null);
        }
        if (loopDetectedRef.current) {
          loopDetectedRef.current = false;
          handleLoopDetectedEvent();
        }
      } catch (error: unknown) {
        if (error instanceof UnauthorizedError) {
          onAuthError();
        } else if (!isNodeError(error) || error.name !== 'AbortError') {
          addItem(
            {
              type: MessageType.ERROR,
              text: parseAndFormatApiError(
                getErrorMessage(error) || 'Unknown error',
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
      activeProfileName,
      settings?.merged?.showProfileChangeInChat,
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

  // Wire up async task auto-trigger
  // @plan PLAN-20260130-ASYNCTASK.P22
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

  // Issue #1113: When isResponding becomes false, process any tool completions
  // that we stored while the stream was active. We store the actual tools because
  // useReactToolScheduler clears toolCalls after onAllToolCallsComplete fires.
  useEffect(() => {
    geminiStreamLogger.debug(
      `pendingToolCompletions effect: isResponding=${isResponding}, pendingCount=${pendingToolCompletionsRef.current.length}`,
    );
    if (!isResponding && pendingToolCompletionsRef.current.length > 0) {
      const pendingTools = [...pendingToolCompletionsRef.current];
      pendingToolCompletionsRef.current = [];
      geminiStreamLogger.debug(
        `pendingToolCompletions effect: processing ${pendingTools.length} queued tools`,
      );
      // Now that isResponding is false, we can safely process the completions
      // Pass skipRespondingCheck=true because we already verified isResponding is false
      void handleCompletedToolsRef.current?.(pendingTools, true);
    }
  }, [isResponding]);

  // Ref to hold the latest handleCompletedTools for the effect above
  const handleCompletedToolsRef = useRef<
    | ((
        tools: TrackedToolCall[],
        skipRespondingCheck?: boolean,
      ) => Promise<void>)
    | null
  >(null);

  const handleCompletedTools = useCallback(
    async (
      completedToolCallsFromScheduler: TrackedToolCall[],
      skipRespondingCheck = false,
    ) => {
      // Issue #1113: If tools complete while stream is active, store them for
      // processing after the stream ends. This handles the race condition where
      // fast tools (like list_directory) complete before isResponding becomes false.
      // We must store the actual tools because useReactToolScheduler clears
      // toolCalls array after onAllToolCallsComplete fires.
      // skipRespondingCheck is true when called from the useEffect that processes
      // queued tools - in that case we've already verified isResponding is false.
      if (!skipRespondingCheck && isResponding) {
        geminiStreamLogger.debug(
          `handleCompletedTools: stream active, queuing ${completedToolCallsFromScheduler.length} tool(s) for deferred processing`,
        );
        pendingToolCompletionsRef.current.push(
          ...completedToolCallsFromScheduler,
        );
        return;
      }
      geminiStreamLogger.debug(
        `handleCompletedTools: processing ${completedToolCallsFromScheduler.length} tool(s)`,
      );

      // Issue #968: Don't process tool completions or start continuations
      // if the turn has been cancelled. Mark the tools as submitted to
      // prevent them from being reprocessed, but don't send to Gemini.
      if (turnCancelledRef.current) {
        const completedToolsWithResponses =
          completedToolCallsFromScheduler.filter(
            (tc): tc is TrackedCompletedToolCall | TrackedCancelledToolCall =>
              (tc.status === 'success' ||
                tc.status === 'error' ||
                tc.status === 'cancelled') &&
              (tc as TrackedCompletedToolCall | TrackedCancelledToolCall)
                .response?.responseParts !== undefined,
          );
        const callIds = completedToolsWithResponses.map(
          (tc) => tc.request.callId,
        );
        if (callIds.length > 0) {
          if (geminiClient) {
            // Similar to the allToolsCancelled branch, we need to properly separate
            // functionCall and functionResponse parts. Unlike the original broken code
            // that filtered out functionCall parts entirely, we need to preserve both.
            const allParts = completedToolsWithResponses.flatMap(
              (toolCall) => toolCall.response.responseParts,
            );

            // Separate parts by type to maintain proper tool usage pattern
            const functionCalls: Part[] = [];
            const functionResponses: Part[] = [];
            const otherParts: Part[] = [];

            for (const part of allParts) {
              if (part && typeof part === 'object' && 'functionCall' in part) {
                functionCalls.push(part);
                continue;
              }
              if (
                part &&
                typeof part === 'object' &&
                'functionResponse' in part
              ) {
                functionResponses.push(part);
                continue;
              }
              otherParts.push(part);
            }

            // Add function calls as 'model' role (tool_use blocks)
            if (functionCalls.length > 0) {
              geminiClient.addHistory({
                role: 'model',
                parts: functionCalls,
              });
            }

            // Add function responses and other parts as 'user' role (tool_result blocks)
            if (functionResponses.length > 0 || otherParts.length > 0) {
              geminiClient.addHistory({
                role: 'user',
                parts: [...functionResponses, ...otherParts],
              });
            }
          }
          markToolsAsSubmitted(callIds);
        }
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

      const [primaryTools, externalTools] =
        completedAndReadyToSubmitTools.reduce<
          [
            Array<TrackedCompletedToolCall | TrackedCancelledToolCall>,
            Array<TrackedCompletedToolCall | TrackedCancelledToolCall>,
          ]
        >(
          (acc, toolCall) => {
            const agentId = toolCall.request.agentId ?? DEFAULT_AGENT_ID;
            if (agentId === DEFAULT_AGENT_ID) {
              acc[0].push(toolCall);
            } else {
              acc[1].push(toolCall);
            }
            return acc;
          },
          [[], []],
        );

      if (externalTools.length > 0) {
        markToolsAsSubmitted(
          externalTools.map((toolCall) => toolCall.request.callId),
        );
      }

      if (primaryTools.length === 0) {
        return;
      }

      const todoPauseTriggered = primaryTools.some(
        (tc) => tc.request.name === 'todo_pause' && tc.status === 'success',
      );

      if (todoPauseTriggered) {
        onTodoPause?.();
      }

      // Finalize any client-initiated tools as soon as they are done.
      const clientTools = primaryTools.filter(
        (t) => t.request.isClientInitiated,
      );
      if (clientTools.length > 0) {
        markToolsAsSubmitted(clientTools.map((t) => t.request.callId));
      }

      // Identify new, successful save_memory calls that we haven't processed yet.
      const newSuccessfulMemorySaves = primaryTools.filter(
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

      const geminiTools = primaryTools.filter(
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
          const combinedParts = geminiTools.flatMap(
            (toolCall) => toolCall.response.responseParts,
          );

          // IMPORTANT: responseParts for terminal tool calls include BOTH the
          // original functionCall and the functionResponse. HistoryService is
          // intentionally "atomic" for tool calls, but providers require tool
          // calls to originate from the assistant and tool results from the
          // tool role. Add the pieces to history with correct roles.
          const functionCalls: Part[] = [];
          const functionResponses: Part[] = [];
          const otherParts: Part[] = [];

          for (const part of combinedParts) {
            if (part && typeof part === 'object' && 'functionCall' in part) {
              functionCalls.push(part);
              continue;
            }
            if (
              part &&
              typeof part === 'object' &&
              'functionResponse' in part
            ) {
              functionResponses.push(part);
              continue;
            }
            otherParts.push(part);
          }

          if (functionCalls.length > 0) {
            geminiClient.addHistory({
              role: 'model',
              parts: functionCalls,
            });
          }

          if (functionResponses.length > 0 || otherParts.length > 0) {
            geminiClient.addHistory({
              role: 'user',
              parts: [...functionResponses, ...otherParts],
            });
          }
        }

        const callIdsToMarkAsSubmitted = geminiTools.map(
          (toolCall) => toolCall.request.callId,
        );
        markToolsAsSubmitted(callIdsToMarkAsSubmitted);
        return;
      }

      // Only send functionResponse parts - functionCall parts are already in
      // history from the original assistant turn. Sending them again would
      // create duplicate tool_use blocks without matching tool_result.
      const responsesToSend: Part[] = geminiTools.flatMap((toolCall) =>
        toolCall.response.responseParts.filter(
          (part) =>
            !(part && typeof part === 'object' && 'functionCall' in part),
        ),
      );
      const callIdsToMarkAsSubmitted = geminiTools.map(
        (toolCall) => toolCall.request.callId,
      );

      const prompt_ids = geminiTools.map(
        (toolCall) => toolCall.request.prompt_id,
      );

      markToolsAsSubmitted(callIdsToMarkAsSubmitted);

      submitQuery(
        responsesToSend,
        {
          isContinuation: true,
        },
        prompt_ids[0],
      );
    },
    [
      isResponding,
      submitQuery,
      markToolsAsSubmitted,
      geminiClient,
      performMemoryRefresh,
      onTodoPause,
    ],
  );

  // Issue #1113: Keep the ref updated with the latest handleCompletedTools
  useEffect(() => {
    handleCompletedToolsRef.current = handleCompletedTools;
  }, [handleCompletedTools]);

  const pendingHistoryItems = useMemo(
    () =>
      mergePendingToolGroupsForDisplay(
        pendingHistoryItem,
        pendingToolCallGroupDisplay,
      ),
    [pendingHistoryItem, pendingToolCallGroupDisplay],
  );

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
        const checkpointDir = storage.getProjectTempCheckpointsDir();

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
            if (!gitService) {
              onDebugMessage(
                `Checkpointing is enabled but Git service is not available. Failed to create snapshot for ${filePath}. Ensure Git is installed and working properly.`,
              );
              continue;
            }

            let commitHash: string | undefined;
            try {
              commitHash = await gitService.createFileSnapshot(
                `Snapshot for ${toolCall.request.name}`,
              );
            } catch (error) {
              onDebugMessage(
                `Failed to create new snapshot: ${getErrorMessage(error)}. Attempting to use current commit.`,
              );
            }

            if (!commitHash) {
              commitHash = await gitService.getCurrentCommitHash();
            }

            if (!commitHash) {
              onDebugMessage(
                `Failed to create snapshot for ${filePath}. Checkpointing may not be working properly. Ensure Git is installed and the project directory is accessible.`,
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
              `Failed to create checkpoint for ${filePath}: ${getErrorMessage(
                error,
              )}. This may indicate a problem with Git or file system permissions.`,
            );
          }
        }
      }
    };
    saveRestorableToolCalls();
  }, [
    toolCalls,
    config,
    onDebugMessage,
    gitService,
    history,
    geminiClient,
    storage,
  ]);

  const lastOutputTime = Math.max(
    lastToolOutputTime ?? 0,
    lastShellOutputTime ?? 0,
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
