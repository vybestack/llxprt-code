/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Conversation request and tool-call logging helpers extracted from
 * LoggingProviderWrapper to keep the main wrapper file under the lint
 * line budget.
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { type IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { logConversationRequest } from '@vybestack/llxprt-code-core/telemetry/loggers.js';
import { ConversationRequestEvent } from '@vybestack/llxprt-code-core/telemetry/types.js';
import { getConversationFileWriter } from '@vybestack/llxprt-code-storage/storage/ConversationFileWriter.js';
import type { ProviderToolset } from '../IProvider.js';
import type { ConversationDataRedactor } from './ConfigBasedRedactor.js';

export interface ConversationLogContext {
  providerName: string;
  conversationId: string;
  turnNumber: number;
  generatePromptId: () => string;
  redactor: ConversationDataRedactor | null;
}

/** Log a conversation request event to telemetry and disk. */
export async function logConversationRequestEntry(
  config: Config,
  content: IContent[],
  tools: ProviderToolset | undefined,
  promptId: string | undefined,
  ctx: ConversationLogContext,
): Promise<void> {
  const redactedContent = ctx.redactor
    ? content.map((item) => ctx.redactor!.redactMessage(item, ctx.providerName))
    : content;
  const redactedTools = tools;

  const resolvedPromptId = promptId ?? ctx.generatePromptId();
  const event = new ConversationRequestEvent(
    ctx.providerName,
    ctx.conversationId,
    ctx.turnNumber,
    resolvedPromptId,
    redactedContent,
    redactedTools,
    'default',
  );

  logConversationRequest(config, event);

  const fileWriter = getConversationFileWriter(config.getConversationLogPath());
  await fileWriter.writeRequest(ctx.providerName, redactedContent, {
    conversationId: ctx.conversationId,
    turnNumber: ctx.turnNumber,
    promptId: resolvedPromptId,
    tools: redactedTools,
    toolFormat: 'default',
  });
}

/** Log a tool call event to disk with optional redaction. */
export async function logToolCallEntry(
  config: Config | undefined,
  toolName: string,
  params: unknown,
  result: unknown,
  startTime: number,
  success: boolean,
  error: unknown | undefined,
  ctx: ConversationLogContext,
): Promise<void> {
  if (!config) {
    return;
  }

  const endTime = Date.now();
  const duration = endTime - startTime;

  let gitStats = null;
  if (typeof result === 'object' && result !== null && 'metadata' in result) {
    const metadata = (result as { metadata?: { gitStats?: unknown } }).metadata;
    if (metadata?.gitStats != null) {
      gitStats = metadata.gitStats;
    }
  }

  const redactedParams = ctx.redactor
    ? ctx.redactor.redactToolCall({
        type: 'function',
        function: { name: toolName, parameters: params as object },
      }).function.parameters
    : (params as object);

  const fileWriter = getConversationFileWriter(config.getConversationLogPath());
  await fileWriter.writeToolCall(ctx.providerName, toolName, {
    conversationId: ctx.conversationId,
    turnNumber: ctx.turnNumber,
    params: redactedParams,
    result,
    duration,
    success,
    error: error != null ? String(error) : undefined,
    gitStats,
  });
}
