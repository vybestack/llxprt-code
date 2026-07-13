/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Extracted stream event handler hooks from useAgentStream.
 * Contains the per-event handler useCallbacks consumed by the AgentEvent
 * dispatcher (agentEventDispatcher.dispatchAgentEvent), and displayUserMessage.
 * Multi-turn continuation is owned by the AgenticLoop in
 * @vybestack/llxprt-code-agents, not by this module.
 */

import type React from 'react';
import { useCallback, useMemo } from 'react';
import {
  type ServerErrorEvent as ErrorEvent,
  type ServerChatCompressedEvent,
  type MessageSenderType,
  type ToolCallRequestInfo,
  parseAndFormatApiError,
  type ThinkingBlock,
  type ThoughtSummary,
  type ServerContentEvent,
  logUserPrompt,
  type UserPromptEvent,
  type ContractPartListUnion,
} from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { type LoadedSettings } from '../../../config/settings.js';
import {
  type HistoryItemWithoutId,
  type HistoryItemToolGroup,
  MessageType,
  ToolCallStatus,
  type SlashCommandProcessorResult,
} from '../../types.js';
import { type UseHistoryManagerReturn } from '../useHistoryManager.js';
import {
  showCitations,
  getCurrentProfileName,
  buildApiErrorInfo,
} from './streamUtils.js';
import {
  getActiveProviderNameForApiError,
  getErrorFallbackModel,
} from '../../../utils/apiErrorFormatting.js';
import {
  resolveContentPrefixIdentity,
  createCliModelIdentityRuntime,
} from '../../utils/modelIdentity.js';

/**
 * Shared content-prefix identity resolver. Reads fresh runtime state at call
 * time (no dependencies on component state/props), so a single stable reference
 * can be reused by both ContentEventDeps and StreamEventDeps without risk of
 * staleness (issue #2263).
 */
function defaultGetContentPrefixIdentity(): string | null {
  try {
    return resolveContentPrefixIdentity(createCliModelIdentityRuntime());
  } catch {
    return null;
  }
}
import {
  processContentEvent,
  type ContentEventDeps,
} from './contentEventProcessor.js';
import {
  prepareQueryForAgent as prepareQueryImpl,
  type PrepareQueryDeps,
} from './queryPreparer.js';
import { getTokenLimitForConfiguredContext } from './contextLimit.js';
import type { StreamRuntime } from '../../cliUiRuntime.js';
interface StreamEventHandlersResult {
  handleContentEvent: (
    eventValue: ServerContentEvent['value'],
    currentAgentMessageBuffer: string,
    userMessageTimestamp: number,
  ) => string;
  handleUserCancelledEvent: (userMessageTimestamp: number) => void;
  handleErrorEvent: (
    eventValue: ErrorEvent['value'],
    userMessageTimestamp: number,
    options?: { clearQueue?: boolean },
  ) => void;
  handleCitationEvent: (text: string, userMessageTimestamp: number) => void;
  /**
   * Finished-notice handler for the public AgentEvent done{stop|refusal} path.
   * Receives the pre-computed message (or null for no notice).
   */
  handleFinishedNotice: (
    message: string | null,
    userMessageTimestamp: number,
  ) => void;
  handleChatCompressionEvent: (
    eventValue: ServerChatCompressedEvent['value'],
    userMessageTimestamp: number,
  ) => void;
  handleMaxSessionTurnsEvent: () => void;
  handleContextWindowWillOverflowEvent: (
    estimatedRequestTokenCount: number,
    remainingTokenCount: number,
  ) => void;
  handleLoopDetectedEvent: () => void;
  displayUserMessage: (
    trimmedQuery: string,
    userMessageTimestamp: number,
  ) => void;
  prepareQueryForAgent: (
    query: ContractPartListUnion,
    userMessageTimestamp: number,
    abortSignal: AbortSignal,
    promptId: string,
  ) => Promise<{
    queryToSend: ContractPartListUnion | null;
    shouldProceed: boolean;
  }>;
}

interface StreamEventHandlerDeps {
  runtime: StreamRuntime;
  // @plan:ISSUE-2376 — the Agent surface supplies named-tool lookup
  // (agent.tools.get) for @file processing; threaded alongside the #2384
  // StreamRuntime rather than through getToolRegistry.
  agent: Agent;
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
      query: ContractPartListUnion;
      options?: { isContinuation: boolean };
      promptId?: string;
    }>
  >;
  setPendingHistoryItem: React.Dispatch<
    React.SetStateAction<HistoryItemWithoutId | null>
  >;
  setIsResponding: React.Dispatch<React.SetStateAction<boolean>>;
  setThought: React.Dispatch<React.SetStateAction<ThoughtSummary | null>>;
  setLastAgentActivityTime: React.Dispatch<React.SetStateAction<number>>;
  scheduleToolCalls: (
    requests: ToolCallRequestInfo[],
    signal: AbortSignal,
  ) => Promise<void>;
  abortActiveStream: (reason?: unknown) => void;
  handleShellCommand: (query: string, signal: AbortSignal) => boolean;
  handleSlashCommand: (
    cmd: ContractPartListUnion,
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
  const displayUserMessage = useDisplayUserMessage(deps);
  const prepareQueryForAgent = usePrepareQueryForAgent(deps);

  return {
    ...handlers,
    displayUserMessage,
    prepareQueryForAgent,
  };
}

function useContentEventHandler(deps: StreamEventHandlerDeps) {
  const contentEventDeps = useContentEventDeps(deps);
  return useCallback(
    (
      eventValue: ServerContentEvent['value'],
      currentAgentMessageBuffer: string,
      userMessageTimestamp: number,
    ): string =>
      processContentEvent(
        eventValue,
        currentAgentMessageBuffer,
        userMessageTimestamp,
        contentEventDeps,
      ),
    [contentEventDeps],
  );
}

function useStreamHandlers(
  deps: StreamEventHandlerDeps,
  handleContentEvent: (
    eventValue: ServerContentEvent['value'],
    currentAgentMessageBuffer: string,
    userMessageTimestamp: number,
  ) => string,
  handleLoopDetectedEvent: () => void,
): HandlerMap {
  return {
    handleContentEvent,
    handleUserCancelledEvent: useUserCancelledHandler(deps),
    handleErrorEvent: useErrorEventHandler(deps),
    handleCitationEvent: useCitationEventHandler(deps),
    handleFinishedNotice: useFinishedNoticeHandler(deps),
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
    runtime,
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
      const apiErrorInfo = buildApiErrorInfo(runtime);
      const providerName = getActiveProviderNameForApiError(apiErrorInfo);
      const fallbackModel = getErrorFallbackModel(apiErrorInfo, providerName);
      addItem(
        {
          type: MessageType.ERROR,
          text: parseAndFormatApiError(
            eventValue.error,
            undefined,
            fallbackModel,
            providerName,
          ),
        },
        userMessageTimestamp,
      );
      if (options?.clearQueue ?? true) queuedSubmissionsRef.current = [];
      setThought(null);
    },
    [
      addItem,
      runtime,
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
    runtime,
    flushPendingHistoryItem,
    pendingHistoryItemRef,
    setPendingHistoryItem,
    settings,
  } = deps;

  return useCallback(
    (text: string, userMessageTimestamp: number) => {
      if (!showCitations(settings, runtime)) return;
      if (pendingHistoryItemRef.current) {
        flushPendingHistoryItem(userMessageTimestamp);
        setPendingHistoryItem(null);
      }
      addItem({ type: MessageType.INFO, text }, userMessageTimestamp);
    },
    [
      addItem,
      runtime,
      flushPendingHistoryItem,
      pendingHistoryItemRef,
      setPendingHistoryItem,
      settings,
    ],
  );
}

/**
 * Finished-notice handler for the public AgentEvent path. The agentEventDispatcher
 * computes the message (from a FinishedValue) and passes it here; this handler
 * only renders the WARNING item. Null message → no item (parity).
 */
function useFinishedNoticeHandler(deps: StreamEventHandlerDeps) {
  const { addItem } = deps;
  return useCallback(
    (message: string | null, userMessageTimestamp: number) => {
      if (!message) return;
      addItem(
        { type: 'info', text: `WARNING:  ${message}` },
        userMessageTimestamp,
      );
    },
    [addItem],
  );
}

function useChatCompressionHandler(deps: StreamEventHandlerDeps) {
  const { addItem, runtime, pendingHistoryItemRef, setPendingHistoryItem } =
    deps;
  return useCallback(
    (
      eventValue: ServerChatCompressedEvent['value'],
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
            `IMPORTANT: This conversation approached the input token limit for ${runtime.model.getModel()}. ` +
            `A compressed context will be sent for future messages (compressed from: ` +
            `${eventValue?.originalTokenCount ?? 'unknown'} to ` +
            `${eventValue?.newTokenCount ?? 'unknown'} tokens).`,
        },
        Date.now(),
      );
    },
    [addItem, runtime, pendingHistoryItemRef, setPendingHistoryItem],
  );
}

function useMaxSessionTurnsHandler(deps: StreamEventHandlerDeps) {
  const { addItem, runtime } = deps;
  return useCallback(
    () =>
      addItem(
        {
          type: 'info',
          text: `The session has reached the maximum number of turns: ${runtime.sessionLimits.getMaxSessionTurns()}. Please update this limit in your setting.json file.`,
        },
        Date.now(),
      ),
    [addItem, runtime],
  );
}

function useContextOverflowHandler(deps: StreamEventHandlerDeps) {
  const { addItem, runtime, onCancelSubmit } = deps;
  return useCallback(
    (estimatedRequestTokenCount: number, remainingTokenCount: number) => {
      onCancelSubmit(true);
      const limit = getTokenLimitForConfiguredContext(runtime);
      const isLessThan75Percent =
        limit > 0 && remainingTokenCount < limit * 0.75;
      let text = `Sending this message (${estimatedRequestTokenCount} tokens) might exceed the remaining context window limit (${remainingTokenCount} tokens).`;
      if (isLessThan75Percent)
        text +=
          ' Please try reducing the size of your message or use the `/compress` command to compress the chat history.';
      addItem({ type: 'info', text }, Date.now());
    },
    [addItem, runtime, onCancelSubmit],
  );
}

function usePrepareQueryForAgent(deps: StreamEventHandlerDeps) {
  const prepareQueryDeps = usePrepareQueryDeps(deps);
  return useCallback(
    async (
      query: ContractPartListUnion,
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
      addItem: deps.addItem,
      sanitizeContent: deps.sanitizeContent,
      flushPendingHistoryItem: deps.flushPendingHistoryItem,
      pendingHistoryItemRef: deps.pendingHistoryItemRef,
      thinkingBlocksRef: deps.thinkingBlocksRef,
      turnCancelledRef: deps.turnCancelledRef,
      setPendingHistoryItem: deps.setPendingHistoryItem,
      getContentPrefixIdentity: defaultGetContentPrefixIdentity,
    }),
    [
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
      runtime: deps.runtime,
      getToolHandle: (name: string) => deps.agent.tools.get(name),
      logUserPrompt: (event: UserPromptEvent) =>
        logUserPrompt(
          {
            getSessionId: () => deps.runtime.session.getSessionId(),
            getTelemetryLogPromptsEnabled: () =>
              deps.runtime.settings.getTelemetryLogPromptsEnabled(),
          },
          event,
        ),
      addItem: deps.addItem,
      onDebugMessage: deps.onDebugMessage,
      handleShellCommand: deps.handleShellCommand,
      handleSlashCommand: deps.handleSlashCommand,
      logger: deps.logger,
      shellModeActive: deps.shellModeActive,
      scheduleToolCalls: deps.scheduleToolCalls,
    }),
    [
      deps.runtime,
      deps.agent,
      deps.addItem,
      deps.onDebugMessage,
      deps.handleShellCommand,
      deps.handleSlashCommand,
      deps.logger,
      deps.shellModeActive,
      deps.scheduleToolCalls,
    ],
  );
}

function useDisplayUserMessage(deps: StreamEventHandlerDeps) {
  const { addItem, runtime, lastProfileNameRef } = deps;
  return useCallback(
    (trimmedQuery: string, userMessageTimestamp: number) => {
      addItem(
        { type: MessageType.USER, text: trimmedQuery },
        userMessageTimestamp,
      );
      // Inline profile_change notifications are now owned exclusively by the
      // ModelInfo event path (agentEventDispatcher.handleModelInfoEvent).
      // We still track lastProfileNameRef for backward-compatible diagnostics.
      const liveProfileName = getCurrentProfileName(runtime);
      lastProfileNameRef.current = liveProfileName ?? undefined;
    },
    [addItem, runtime, lastProfileNameRef],
  );
}

type HandlerMap = Pick<
  StreamEventHandlersResult,
  | 'handleContentEvent'
  | 'handleUserCancelledEvent'
  | 'handleErrorEvent'
  | 'handleChatCompressionEvent'
  | 'handleFinishedNotice'
  | 'handleMaxSessionTurnsEvent'
  | 'handleContextWindowWillOverflowEvent'
  | 'handleCitationEvent'
  | 'handleLoopDetectedEvent'
>;
