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
  type Config,
  type ToolCallRequestInfo,
  logUserPrompt,
  UserPromptEvent,
  MessageSenderType,
} from '@vybestack/llxprt-code-core';
import { type PartListUnion } from '@google/genai';
import { type SlashCommandProcessorResult } from '../../types.js';
import { isAtCommand, isSlashCommand } from '../../utils/commandUtils.js';
import { type UseHistoryManagerReturn } from '../useHistoryManager.js';
import { processSlashCommandResult } from './streamUtils.js';
import { handleAtCommand } from '../atCommandProcessor.js';

export interface PrepareQueryDeps {
  config: Config;
  addItem: UseHistoryManagerReturn['addItem'];
  onDebugMessage: (message: string) => void;
  handleShellCommand: (query: string, signal: AbortSignal) => boolean;
  handleSlashCommand: (
    cmd: PartListUnion,
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
  turnCancelledRef: React.MutableRefObject<boolean>;
}

export async function prepareQueryForGemini(
  query: PartListUnion,
  userMessageTimestamp: number,
  abortSignal: AbortSignal,
  promptId: string,
  deps: PrepareQueryDeps,
): Promise<{ queryToSend: PartListUnion | null; shouldProceed: boolean }> {
  const { turnCancelledRef, onDebugMessage } = deps;
  if (turnCancelledRef.current) {
    return { queryToSend: null, shouldProceed: false };
  }
  if (typeof query === 'string' && query.trim().length === 0) {
    return { queryToSend: null, shouldProceed: false };
  }

  let localQueryToSendToGemini: PartListUnion | null = null;

  if (typeof query === 'string') {
    localQueryToSendToGemini = await processStringQuery(
      query.trim(),
      userMessageTimestamp,
      abortSignal,
      promptId,
      deps,
    );
  } else {
    localQueryToSendToGemini = query;
  }

  if (localQueryToSendToGemini === null) {
    onDebugMessage('Query processing resulted in null, not sending to Gemini.');
    return { queryToSend: null, shouldProceed: false };
  }
  return { queryToSend: localQueryToSendToGemini, shouldProceed: true };
}

async function processStringQuery(
  trimmedQuery: string,
  userMessageTimestamp: number,
  abortSignal: AbortSignal,
  promptId: string,
  deps: PrepareQueryDeps,
): Promise<PartListUnion | null> {
  const {
    config,
    logger,
    shellModeActive,
    handleSlashCommand,
    handleShellCommand,
    addItem,
    onDebugMessage,
  } = deps;

  logUserPrompt(
    config,
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
      config,
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
