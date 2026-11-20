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
  type ThoughtSummary,
  type AgentRequestInput,
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
  prepareQueryForAgent as prepareQueryImpl,
  type PrepareQueryDeps,
} from './queryPreparer.js';
import { getTokenLimitForConfiguredContext } from './contextLimit.js';
import type { UiSubagentManager } from '../../cliUiRuntime.js';
interface StreamEventHandlersResult {
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
  /**
   * Discards the abandoned attempt's render state (issue #3048): nulls the
   * pending AI item without flushing, resets buffer/thinking state, and
   * retracts committed stable segments. The turn stays responding.
   */
  handleStreamAttemptDiscarded: () => void;
  handleLoopDetectedEvent: () => void;
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
}

interface StreamEventHandlerDeps {
  atCommandConfig: PrepareQueryDeps['atCommandConfig'];
  logUserPrompt: PrepareQueryDeps['logUserPrompt'];
  getModel: () => string;
  getProvider: () => string | undefined;
  readSelectedProvider: () => string | undefined;
  readCitations: () => unknown;
  readProfileName: () => string | null;
  readContextLimit: () => unknown;
  getMaxSessionTurns: () => number;
  getProviderContextLimit: Agent['getProviderContextLimit'];
  getContentPrefixIdentity: () => string | null;
  getToolHandle: Agent['tools']['get'];
  findResource: Agent['mcp']['findResource'];
  readResource: Agent['mcp']['readResource'];
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
  turnCancelledRef: React.MutableRefObject<boolean>;
  clearSubmissions: () => void;
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
  // Optional: sourced from the app runtime when available. The runtime does
  // not yet expose getSubagentManager, so this is undefined in the streaming
  // path until a runtime slice is added; @subagent mentions degrade gracefully.
  subagentManager?: UiSubagentManager;
}

export function useStreamEventHandlers(
  deps: StreamEventHandlerDeps,
): StreamEventHandlersResult {
  const handleStreamAttemptDiscarded = useStreamAttemptDiscardedHandler(deps);
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
    handleStreamAttemptDiscarded,
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

function useStreamAttemptDiscardedHandler(deps: StreamEventHandlerDeps) {
  return useCallback(() => {
    if (deps.pendingHistoryItemRef.current?.type !== 'tool_group') {
      deps.setPendingHistoryItem(null);
    }
    deps.setThought(null);
  }, [deps]);
}

function useStreamHandlers(
  deps: StreamEventHandlerDeps,
  handleStreamAttemptDiscarded: () => void,
  handleLoopDetectedEvent: () => void,
): HandlerMap {
  return {
    handleStreamAttemptDiscarded,
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
      setThought(null);
    },
    [
      addItem,
      flushPendingHistoryItem,
      pendingHistoryItemRef,
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
    getProvider,
    readSelectedProvider,
    getModel,
    flushPendingHistoryItem,
    pendingHistoryItemRef,
    clearSubmissions,
    setPendingHistoryItem,
    setThought,
  } = deps;

  return useCallback(
    (
      eventValue: ErrorEvent['value'],
      userMessageTimestamp: number,
      options?: { clearQueue?: boolean },
    ) => {
      if (options?.clearQueue ?? true) clearSubmissions();
      setThought(null);
      if (pendingHistoryItemRef.current) {
        flushPendingHistoryItem(userMessageTimestamp);
        setPendingHistoryItem(null);
      }
      const apiErrorInfo = buildApiErrorInfo(
        getProvider,
        readSelectedProvider,
        getModel,
      );
      const providerName = getActiveProviderNameForApiError(apiErrorInfo);
      const fallbackModel = getErrorFallbackModel(apiErrorInfo, providerName);
      addItem(
        {
          type: MessageType.ERROR,
          text: parseAndFormatApiError(
            eventValue.error,
            fallbackModel,
            providerName,
          ),
        },
        userMessageTimestamp,
      );
    },
    [
      addItem,
      getProvider,
      readSelectedProvider,
      getModel,
      flushPendingHistoryItem,
      pendingHistoryItemRef,
      clearSubmissions,
      setPendingHistoryItem,
      setThought,
    ],
  );
}

function useCitationEventHandler(deps: StreamEventHandlerDeps) {
  const {
    addItem,
    readCitations,
    flushPendingHistoryItem,
    pendingHistoryItemRef,
    setPendingHistoryItem,
    settings,
  } = deps;

  return useCallback(
    (text: string, userMessageTimestamp: number) => {
      if (!showCitations(settings, readCitations)) return;
      if (pendingHistoryItemRef.current) {
        flushPendingHistoryItem(userMessageTimestamp);
        setPendingHistoryItem(null);
      }
      addItem({ type: MessageType.INFO, text }, userMessageTimestamp);
    },
    [
      addItem,
      readCitations,
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
  const { addItem, getModel, pendingHistoryItemRef, setPendingHistoryItem } =
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
            `IMPORTANT: This conversation approached the input token limit for ${getModel()}. ` +
            `A compressed context will be sent for future messages (compressed from: ` +
            `${eventValue?.originalTokenCount ?? 'unknown'} to ` +
            `${eventValue?.newTokenCount ?? 'unknown'} tokens).`,
        },
        Date.now(),
      );
    },
    [addItem, getModel, pendingHistoryItemRef, setPendingHistoryItem],
  );
}

function useMaxSessionTurnsHandler(deps: StreamEventHandlerDeps) {
  const { addItem, getMaxSessionTurns } = deps;
  return useCallback(
    () =>
      addItem(
        {
          type: 'info',
          text: `The session has reached the maximum number of turns: ${getMaxSessionTurns()}. Please update this limit in your setting.json file.`,
        },
        Date.now(),
      ),
    [addItem, getMaxSessionTurns],
  );
}

function useContextOverflowHandler(deps: StreamEventHandlerDeps) {
  const {
    addItem,
    getModel,
    readContextLimit,
    onCancelSubmit,
    getProviderContextLimit,
  } = deps;
  return useCallback(
    (estimatedRequestTokenCount: number, remainingTokenCount: number) => {
      onCancelSubmit(true);
      const limit = getTokenLimitForConfiguredContext(
        getModel,
        readContextLimit,
        getProviderContextLimit(),
      );
      const isLessThan75Percent =
        limit > 0 && remainingTokenCount < limit * 0.75;
      let text = `Sending this message (${estimatedRequestTokenCount} tokens) might exceed the remaining context window limit (${remainingTokenCount} tokens).`;
      if (isLessThan75Percent)
        text +=
          ' Please try reducing the size of your message or use the `/compress` command to compress the chat history.';
      addItem({ type: 'info', text }, Date.now());
    },
    [
      addItem,
      getModel,
      readContextLimit,
      onCancelSubmit,
      getProviderContextLimit,
    ],
  );
}

function usePrepareQueryForAgent(deps: StreamEventHandlerDeps) {
  const prepareQueryDeps = usePrepareQueryDeps(deps);
  return useCallback(
    async (
      query: AgentRequestInput,
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

function usePrepareQueryDeps(deps: StreamEventHandlerDeps): PrepareQueryDeps {
  return useMemo(
    () => ({
      atCommandConfig: deps.atCommandConfig,
      getToolHandle: deps.getToolHandle,
      findResource: deps.findResource,
      readResource: deps.readResource,
      logUserPrompt: deps.logUserPrompt,
      addItem: deps.addItem,
      onDebugMessage: deps.onDebugMessage,
      handleShellCommand: deps.handleShellCommand,
      handleSlashCommand: deps.handleSlashCommand,
      logger: deps.logger,
      shellModeActive: deps.shellModeActive,
      scheduleToolCalls: deps.scheduleToolCalls,
      subagentManager: deps.subagentManager,
    }),
    [
      deps.atCommandConfig,
      deps.logUserPrompt,
      deps.getToolHandle,
      deps.findResource,
      deps.readResource,
      deps.addItem,
      deps.onDebugMessage,
      deps.handleShellCommand,
      deps.handleSlashCommand,
      deps.logger,
      deps.shellModeActive,
      deps.scheduleToolCalls,
      deps.subagentManager,
    ],
  );
}

function useDisplayUserMessage(deps: StreamEventHandlerDeps) {
  const { readProfileName, lastProfileNameRef } = deps;
  return useCallback(
    (_trimmedQuery: string, _userMessageTimestamp: number) => {
      // Inline profile_change notifications are now owned exclusively by the
      // ModelInfo event path (agentEventDispatcher.handleModelInfoEvent).
      // We still track lastProfileNameRef for backward-compatible diagnostics.
      const liveProfileName = getCurrentProfileName(readProfileName);
      lastProfileNameRef.current = liveProfileName ?? undefined;
    },
    [readProfileName, lastProfileNameRef],
  );
}

type HandlerMap = Pick<
  StreamEventHandlersResult,
  | 'handleStreamAttemptDiscarded'
  | 'handleUserCancelledEvent'
  | 'handleErrorEvent'
  | 'handleChatCompressionEvent'
  | 'handleFinishedNotice'
  | 'handleMaxSessionTurnsEvent'
  | 'handleContextWindowWillOverflowEvent'
  | 'handleCitationEvent'
  | 'handleLoopDetectedEvent'
>;
