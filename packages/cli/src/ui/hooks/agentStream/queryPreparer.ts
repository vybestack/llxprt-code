/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Extracted query preparation logic from useStreamEventHandlers.
 * Handles slash commands, shell commands, @ commands, and logging.
 * Keeps useStreamEventHandlers under 80 lines.
 * None of these functions call React hooks.
 */

import {
  type ToolCallRequestInfo,
  MessageSenderType,
  type AgentRequestInput,
} from '@vybestack/llxprt-code-core';
import { UserPromptEvent } from '@vybestack/llxprt-code-telemetry';
import { type SlashCommandProcessorResult } from '../../types.js';
import { isAtCommand, isSlashCommand } from '../../utils/commandUtils.js';
import { type UseHistoryManagerReturn } from '../useHistoryManager.js';
import { processSlashCommandResult } from './streamUtils.js';
import {
  buildAtCommandRuntimeFromStream,
  handleAtCommand,
} from '../atCommandProcessor.js';
import type { StreamRuntime } from '../../cliUiRuntime.js';
import type { AgentToolHandle } from '@vybestack/llxprt-code-agents';

export interface PrepareQueryDeps {
  runtime: StreamRuntime;
  // @plan:ISSUE-2376 — resolves read_many_files/glob via the public Agent
  // surface for @file processing, replacing direct
  // getToolRegistry().getTool access.
  getToolHandle: (name: string) => AgentToolHandle | undefined;
  /**
   * Logs a user-prompt telemetry event. Provided by the caller (which has
   * access to the full telemetry-config boundary) so this module depends only
   * on the nested StreamRuntime rather than a flat aggregate.
   */
  logUserPrompt: (event: UserPromptEvent) => void;
  addItem: UseHistoryManagerReturn['addItem'];
  onDebugMessage: (message: string) => void;
  handleShellCommand: (query: string, signal: AbortSignal) => boolean;
  handleSlashCommand: (
    cmd: AgentRequestInput,
  ) => Promise<SlashCommandProcessorResult | false>;
  logger:
    | { logMessage: (sender: MessageSenderType, text: string) => Promise<void> }
    | null
    | undefined;
  shellModeActive: boolean;
  scheduleToolCalls: (
    requests: ToolCallRequestInfo[],
    signal: AbortSignal,
  ) => Promise<void>;
}

export async function prepareQueryForAgent(
  query: AgentRequestInput,
  userMessageTimestamp: number,
  abortSignal: AbortSignal,
  promptId: string,
  deps: PrepareQueryDeps,
): Promise<{
  queryToSend: AgentRequestInput | null;
  shouldProceed: boolean;
}> {
  const { onDebugMessage } = deps;
  // Gate on THIS turn's own abort signal, not the shared turnCancelledRef: a
  // turn's own signal is the precise indicator of whether that specific turn
  // was cancelled (including abort paths that don't flip turnCancelledRef), so
  // it is more exact than the shared flag. See issue #2136.
  if (abortSignal.aborted) {
    return { queryToSend: null, shouldProceed: false };
  }
  if (typeof query === 'string' && query.trim().length === 0) {
    return { queryToSend: null, shouldProceed: false };
  }

  let localQueryToSendToAgent: AgentRequestInput | null = null;

  if (typeof query === 'string') {
    localQueryToSendToAgent = await processStringQuery(
      query.trim(),
      userMessageTimestamp,
      abortSignal,
      promptId,
      deps,
    );
  } else {
    localQueryToSendToAgent = query;
  }

  if (localQueryToSendToAgent === null) {
    onDebugMessage(
      'Query processing resulted in null, not sending to the model.',
    );
    return { queryToSend: null, shouldProceed: false };
  }
  return { queryToSend: localQueryToSendToAgent, shouldProceed: true };
}

async function processStringQuery(
  trimmedQuery: string,
  userMessageTimestamp: number,
  abortSignal: AbortSignal,
  promptId: string,
  deps: PrepareQueryDeps,
): Promise<AgentRequestInput | null> {
  const {
    runtime,
    logUserPrompt,
    logger,
    shellModeActive,
    handleSlashCommand,
    handleShellCommand,
    addItem,
    onDebugMessage,
  } = deps;

  logUserPrompt(
    new UserPromptEvent(trimmedQuery.length, promptId, trimmedQuery),
  );
  await logger?.logMessage(MessageSenderType.USER, trimmedQuery);

  if (shellModeActive !== true) {
    const slashCommandResult = isSlashCommand(trimmedQuery)
      ? await handleSlashCommand(trimmedQuery)
      : false;
    if (slashCommandResult !== false) {
      const result = await processSlashCommandResult(
        slashCommandResult,
        deps.scheduleToolCalls,
        promptId,
        abortSignal,
      );
      return result.shouldProceed ? result.queryToSend : null;
    }
  }

  if (
    shellModeActive === true &&
    handleShellCommand(trimmedQuery, abortSignal)
  ) {
    return null;
  }

  if (isAtCommand(trimmedQuery)) {
    const atCommandResult = await handleAtCommand({
      query: trimmedQuery,
      config: buildAtCommandRuntimeFromStream(runtime),
      getToolHandle: deps.getToolHandle,
      addItem,
      onDebugMessage,
      messageId: userMessageTimestamp,
      signal: abortSignal,
    });
    if (atCommandResult.error) {
      onDebugMessage(atCommandResult.error);
      return null;
    }
    return atCommandResult.processedQuery;
  }
  return trimmedQuery;
}
