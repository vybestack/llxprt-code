/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable eslint-comments/disable-enable-pair -- Phase 5: legacy UI boundary retained while larger decomposition continues. */

/**
 * Extracted stream event handler hooks from useGeminiStream.
 * Contains all event handler useCallbacks for stream event processing,
 * plus processGeminiStreamEvents and displayUserMessage.
 */

import type React from 'react';
import { useCallback, useMemo } from 'react';
import {
  type Config,
  type ServerGeminiStreamEvent as GeminiEvent,
  type ServerGeminiErrorEvent as ErrorEvent,
  type ServerGeminiChatCompressedEvent,
  type ServerGeminiFinishedEvent,
  type MessageSenderType,
  type ToolCallRequestInfo,
  parseAndFormatApiError,
  nextStreamEventWithIdleTimeout,
  StreamIdleTimeoutError,
  resolveStreamIdleTimeoutMs,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  type ThinkingBlock,
  tokenLimit,
  type ThoughtSummary,
  type ServerGeminiContentEvent,
} from '@vybestack/llxprt-code-core';
import { type PartListUnion } from '@google/genai';
import { type LoadedSettings } from '../../../config/settings.js';
import {
  type HistoryItem,
  type HistoryItemWithoutId,
  type HistoryItemToolGroup,
  MessageType,
  ToolCallStatus,
  type SlashCommandProcessorResult,
} from '../../types.js';
import { type UseHistoryManagerReturn } from '../useHistoryManager.js';
import {
  SYSTEM_NOTICE_EVENT,
  showCitations,
  getCurrentProfileName,
  buildFinishReasonMessage,
} from './streamUtils.js';
import { StreamProcessingStatus } from './types.js';
import {
  processContentEvent,
  type ContentEventDeps,
} from './contentEventProcessor.js';
import {
  dispatchStreamEvent,
  scheduleDedupedToolCalls,
} from './streamEventDispatcher.js';
import {
  prepareQueryForGemini as prepareQueryImpl,
  type PrepareQueryDeps,
} from './queryPreparer.js';
interface StreamEventHandlersResult {
  handleContentEvent: (
    eventValue: ServerGeminiContentEvent['value'],
    currentGeminiMessageBuffer: string,
    userMessageTimestamp: number,
  ) => string;
  handleUserCancelledEvent: (userMessageTimestamp: number) => void;
  handleErrorEvent: (
    eventValue: ErrorEvent['value'],
    userMessageTimestamp: number,
    options?: { clearQueue?: boolean },
  ) => void;
  handleCitationEvent: (text: string, userMessageTimestamp: number) => void;
  handleFinishedEvent: (
    event: ServerGeminiFinishedEvent,
    userMessageTimestamp: number,
  ) => void;
  handleChatCompressionEvent: (
    eventValue: ServerGeminiChatCompressedEvent['value'],
    userMessageTimestamp: number,
  ) => void;
  handleMaxSessionTurnsEvent: () => void;
  handleContextWindowWillOverflowEvent: (
    estimatedRequestTokenCount: number,
    remainingTokenCount: number,
  ) => void;
  handleLoopDetectedEvent: () => void;
  processGeminiStreamEvents: (
    stream: AsyncIterable<GeminiEvent>,
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
}

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

export function useStreamEventHandlers(
  deps: StreamEventHandlerDeps,
): StreamEventHandlersResult {
  const handleContentEvent = useContentEventHandler(deps);
  const handleLoopDetectedEvent = useCallback(
    () =>
      deps.addItem(
        {
          type: 'info',
          text: 'A potential loop was detected. This can happen due to repetitive tool calls or other model behavior. The request has been halted.',
        },
        Date.now(),
      ),
    [deps],
  );
  const handlers = useStreamHandlers(
    deps,
    handleContentEvent,
    handleLoopDetectedEvent,
  );
  const processGeminiStreamEvents = useProcessStream(deps, handlers);
  const displayUserMessage = useDisplayUserMessage(deps);
  const prepareQueryForGemini = usePrepareQueryForGemini(deps);

  return {
    ...handlers,
    processGeminiStreamEvents,
    displayUserMessage,
    prepareQueryForGemini,
  };
}

function useContentEventHandler(deps: StreamEventHandlerDeps) {
  const contentEventDeps = useContentEventDeps(deps);
  return useCallback(
    (
      eventValue: ServerGeminiContentEvent['value'],
      currentGeminiMessageBuffer: string,
      userMessageTimestamp: number,
    ): string =>
      processContentEvent(
        eventValue,
        currentGeminiMessageBuffer,
        userMessageTimestamp,
        contentEventDeps,
      ),
    [contentEventDeps],
  );
}

function useStreamHandlers(
  deps: StreamEventHandlerDeps,
  handleContentEvent: (
    eventValue: ServerGeminiContentEvent['value'],
    currentGeminiMessageBuffer: string,
    userMessageTimestamp: number,
  ) => string,
  handleLoopDetectedEvent: () => void,
): HandlerMap {
  return {
    handleContentEvent,
    handleUserCancelledEvent: useUserCancelledHandler(deps),
    handleErrorEvent: useErrorEventHandler(deps),
    handleCitationEvent: useCitationEventHandler(deps),
    handleFinishedEvent: useFinishedEventHandler(deps),
    handleChatCompressionEvent: useChatCompressionHandler(deps),
    handleMaxSessionTurnsEvent: useMaxSessionTurnsHandler(deps),
    handleContextWindowWillOverflowEvent: useContextOverflowHandler(deps),
    handleLoopDetectedEvent,
  };
}

function useUserCancelledHandler(deps: StreamEventHandlerDeps) {
  const {
    addItem,
    flushPendingHistoryItem,
    pendingHistoryItemRef,
    queuedSubmissionsRef,
    setIsResponding,
    setPendingHistoryItem,
    setThought,
    turnCancelledRef,
  } = deps;

  return useCallback(
    (userMessageTimestamp: number) => {
      if (turnCancelledRef.current) return;
      if (pendingHistoryItemRef.current) {
        if (pendingHistoryItemRef.current.type === 'tool_group') {
          const pendingItem: HistoryItemToolGroup = {
            ...pendingHistoryItemRef.current,
            tools: pendingHistoryItemRef.current.tools.map((tool) =>
              tool.status === ToolCallStatus.Pending ||
              tool.status === ToolCallStatus.Confirming ||
              tool.status === ToolCallStatus.Executing
                ? { ...tool, status: ToolCallStatus.Canceled }
                : tool,
            ),
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
      flushPendingHistoryItem,
      pendingHistoryItemRef,
      queuedSubmissionsRef,
      setIsResponding,
      setPendingHistoryItem,
      setThought,
      turnCancelledRef,
    ],
  );
}

function useErrorEventHandler(deps: StreamEventHandlerDeps) {
  const {
    addItem,
    config,
    flushPendingHistoryItem,
    pendingHistoryItemRef,
    queuedSubmissionsRef,
    setPendingHistoryItem,
    setThought,
  } = deps;

  return useCallback(
    (
      eventValue: ErrorEvent['value'],
      userMessageTimestamp: number,
      options?: { clearQueue?: boolean },
    ) => {
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
      if (options?.clearQueue ?? true) queuedSubmissionsRef.current = [];
      setThought(null);
    },
    [
      addItem,
      config,
      flushPendingHistoryItem,
      pendingHistoryItemRef,
      queuedSubmissionsRef,
      setPendingHistoryItem,
      setThought,
    ],
  );
}

function useCitationEventHandler(deps: StreamEventHandlerDeps) {
  const {
    addItem,
    config,
    flushPendingHistoryItem,
    pendingHistoryItemRef,
    setPendingHistoryItem,
    settings,
  } = deps;

  return useCallback(
    (text: string, userMessageTimestamp: number) => {
      if (!showCitations(settings, config)) return;
      if (pendingHistoryItemRef.current) {
        flushPendingHistoryItem(userMessageTimestamp);
        setPendingHistoryItem(null);
      }
      addItem({ type: MessageType.INFO, text }, userMessageTimestamp);
    },
    [
      addItem,
      config,
      flushPendingHistoryItem,
      pendingHistoryItemRef,
      setPendingHistoryItem,
      settings,
    ],
  );
}

function useFinishedEventHandler(deps: StreamEventHandlerDeps) {
  const { addItem } = deps;
  return useCallback(
    (event: ServerGeminiFinishedEvent, userMessageTimestamp: number) => {
      const message = buildFinishReasonMessage(event.value.reason);
      if (message)
        addItem(
          { type: 'info', text: `WARNING:  ${message}` },
          userMessageTimestamp,
        );
    },
    [addItem],
  );
}

function useChatCompressionHandler(deps: StreamEventHandlerDeps) {
  const { addItem, config, pendingHistoryItemRef, setPendingHistoryItem } =
    deps;
  return useCallback(
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
}

function useMaxSessionTurnsHandler(deps: StreamEventHandlerDeps) {
  const { addItem, config } = deps;
  return useCallback(
    () =>
      addItem(
        {
          type: 'info',
          text: `The session has reached the maximum number of turns: ${config.getMaxSessionTurns()}. Please update this limit in your setting.json file.`,
        },
        Date.now(),
      ),
    [addItem, config],
  );
}

function useContextOverflowHandler(deps: StreamEventHandlerDeps) {
  const { addItem, config, onCancelSubmit } = deps;
  return useCallback(
    (estimatedRequestTokenCount: number, remainingTokenCount: number) => {
      onCancelSubmit(true);
      const limit = tokenLimit(config.getModel());
      const isLessThan75Percent =
        limit > 0 && remainingTokenCount < limit * 0.75;
      let text = `Sending this message (${estimatedRequestTokenCount} tokens) might exceed the remaining context window limit (${remainingTokenCount} tokens).`;
      if (isLessThan75Percent)
        text +=
          ' Please try reducing the size of your message or use the `/compress` command to compress the chat history.';
      addItem({ type: 'info', text }, Date.now());
    },
    [addItem, config, onCancelSubmit],
  );
}

function usePrepareQueryForGemini(deps: StreamEventHandlerDeps) {
  const prepareQueryDeps = usePrepareQueryDeps(deps);
  return useCallback(
    async (
      query: PartListUnion,
      userMessageTimestamp: number,
      abortSignal: AbortSignal,
      prompt_id: string,
    ) =>
      prepareQueryImpl(
        query,
        userMessageTimestamp,
        abortSignal,
        prompt_id,
        prepareQueryDeps,
      ),
    [prepareQueryDeps],
  );
}

function useContentEventDeps(deps: StreamEventHandlerDeps): ContentEventDeps {
  return useMemo(
    () => ({
      config: deps.config,
      addItem: deps.addItem,
      sanitizeContent: deps.sanitizeContent,
      flushPendingHistoryItem: deps.flushPendingHistoryItem,
      pendingHistoryItemRef: deps.pendingHistoryItemRef,
      thinkingBlocksRef: deps.thinkingBlocksRef,
      turnCancelledRef: deps.turnCancelledRef,
      setPendingHistoryItem: deps.setPendingHistoryItem,
    }),
    [
      deps.config,
      deps.addItem,
      deps.sanitizeContent,
      deps.flushPendingHistoryItem,
      deps.pendingHistoryItemRef,
      deps.thinkingBlocksRef,
      deps.turnCancelledRef,
      deps.setPendingHistoryItem,
    ],
  );
}

function usePrepareQueryDeps(deps: StreamEventHandlerDeps): PrepareQueryDeps {
  return useMemo(
    () => ({
      config: deps.config,
      addItem: deps.addItem,
      onDebugMessage: deps.onDebugMessage,
      handleShellCommand: deps.handleShellCommand,
      handleSlashCommand: deps.handleSlashCommand,
      logger: deps.logger,
      shellModeActive: deps.shellModeActive,
      scheduleToolCalls: deps.scheduleToolCalls,
      turnCancelledRef: deps.turnCancelledRef,
    }),
    [
      deps.config,
      deps.addItem,
      deps.onDebugMessage,
      deps.handleShellCommand,
      deps.handleSlashCommand,
      deps.logger,
      deps.shellModeActive,
      deps.scheduleToolCalls,
      deps.turnCancelledRef,
    ],
  );
}

function useDisplayUserMessage(deps: StreamEventHandlerDeps) {
  const { addItem, config, lastProfileNameRef, settings } = deps;
  return useCallback(
    (trimmedQuery: string, userMessageTimestamp: number) => {
      addItem(
        { type: MessageType.USER, text: trimmedQuery },
        userMessageTimestamp,
      );
      const showProfileChangeInChat =
        settings.merged.showProfileChangeInChat ?? true;
      const liveProfileName = getCurrentProfileName(config);
      if (
        showProfileChangeInChat &&
        liveProfileName !== null &&
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
      settings.merged.showProfileChangeInChat,
      lastProfileNameRef,
    ],
  );
}

type HandlerMap = Pick<
  StreamEventHandlersResult,
  | 'handleContentEvent'
  | 'handleUserCancelledEvent'
  | 'handleErrorEvent'
  | 'handleChatCompressionEvent'
  | 'handleFinishedEvent'
  | 'handleMaxSessionTurnsEvent'
  | 'handleContextWindowWillOverflowEvent'
  | 'handleCitationEvent'
  | 'handleLoopDetectedEvent'
>;

function useProcessStream(deps: StreamEventHandlerDeps, handlers: HandlerMap) {
  return useCallback(
    async (
      stream: AsyncIterable<GeminiEvent>,
      userMessageTimestamp: number,
      signal: AbortSignal,
    ): Promise<StreamProcessingStatus> => {
      const toolCallRequests: ToolCallRequestInfo[] = [];
      let processingResult = StreamProcessingStatus.Completed;

      const pendingHistoryAtTimeout = () => {
        if (deps.pendingHistoryItemRef.current) {
          deps.addItem(
            deps.pendingHistoryItemRef.current,
            userMessageTimestamp,
          );
          deps.setPendingHistoryItem(null);
        }
      };
      const effectiveTimeoutMs = resolveStreamIdleTimeoutMs(deps.config);
      let iterator: AsyncIterator<GeminiEvent> | undefined;

      try {
        iterator = stream[Symbol.asyncIterator]();
        const streamResult = await consumeStreamEvents(
          iterator,
          effectiveTimeoutMs,
          signal,
          pendingHistoryAtTimeout,
          deps,
          handlers,
          '',
          toolCallRequests,
          userMessageTimestamp,
        );
        processingResult = streamResult.processingResult;

        await scheduleDedupedToolCalls(
          toolCallRequests,
          processingResult,
          signal,
          deps.turnCancelledRef,
          deps.loopDetectedRef,
          deps.pendingHistoryItemRef,
          deps.addItem,
          userMessageTimestamp,
          deps.setPendingHistoryItem,
          deps.scheduleToolCalls,
        );
        return processingResult;
      } finally {
        iterator?.return?.().catch(() => {});
        if (deps.pendingHistoryItemRef.current && signal.aborted)
          deps.setPendingHistoryItem(null);
      }
    },
    [deps, handlers],
  );
}

async function consumeStreamEvents(
  iterator: AsyncIterator<GeminiEvent>,
  effectiveTimeoutMs: number,
  signal: AbortSignal,
  pendingHistoryAtTimeout: () => void,
  deps: StreamEventHandlerDeps,
  handlers: HandlerMap,
  geminiMessageBuffer: string,
  toolCallRequests: ToolCallRequestInfo[],
  userMessageTimestamp: number,
): Promise<{
  geminiMessageBuffer: string;
  processingResult: StreamProcessingStatus;
}> {
  let processingResult = StreamProcessingStatus.Completed;
  // eslint-disable-next-line sonarjs/too-many-break-or-continue-in-loop -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
  for (;;) {
    const nextEvent = await getNextStreamEvent(
      iterator,
      effectiveTimeoutMs,
      signal,
      pendingHistoryAtTimeout,
      deps.setThought,
      deps.abortActiveStream,
    );
    if (nextEvent.done === true) break;
    const event = nextEvent.value;
    if ((event as { type?: unknown }).type === SYSTEM_NOTICE_EVENT) continue;

    const result = dispatchStreamEvent(
      event,
      {
        config: deps.config,
        addItem: deps.addItem,
        sanitizeContent: deps.sanitizeContent,
        pendingHistoryItemRef: deps.pendingHistoryItemRef,
        thinkingBlocksRef: deps.thinkingBlocksRef,
        turnCancelledRef: deps.turnCancelledRef,
        loopDetectedRef: deps.loopDetectedRef,
        setPendingHistoryItem: deps.setPendingHistoryItem,
        setLastGeminiActivityTime: deps.setLastGeminiActivityTime,
        setThought: deps.setThought,
        ...handlers,
        scheduleToolCalls: deps.scheduleToolCalls,
      },
      geminiMessageBuffer,
      toolCallRequests,
      userMessageTimestamp,
    );
    geminiMessageBuffer = result.geminiMessageBuffer;
    if (result.processingResult !== undefined)
      processingResult = result.processingResult;
  }
  return { geminiMessageBuffer, processingResult };
}

async function getNextStreamEvent(
  iterator: AsyncIterator<GeminiEvent>,
  effectiveTimeoutMs: number,
  signal: AbortSignal,
  pendingHistoryAtTimeout: () => void,
  setThought: React.Dispatch<React.SetStateAction<ThoughtSummary | null>>,
  abortActiveStream: (reason?: unknown) => void,
): Promise<IteratorResult<GeminiEvent>> {
  if (effectiveTimeoutMs > 0) {
    return nextStreamEventWithIdleTimeout({
      iterator,
      timeoutMs: effectiveTimeoutMs,
      signal,
      onTimeout: () => {
        if (signal.aborted) return;
        pendingHistoryAtTimeout();
        setThought(null);
        abortActiveStream(
          new StreamIdleTimeoutError(
            'Stream idle timeout: no response received within the allowed time.',
          ),
        );
      },
      createTimeoutError: () =>
        new StreamIdleTimeoutError(
          'Stream idle timeout: no response received within the allowed time.',
        ),
    });
  }
  return iterator.next();
}

export const __testing = {
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
};
