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
import {
  getConversationFileWriter,
  type RequestArtifactDescriptor,
} from '@vybestack/llxprt-code-storage/storage/ConversationFileWriter.js';
import type { ProviderToolset } from '../IProvider.js';
import type { ConversationDataRedactor } from './ConfigBasedRedactor.js';
import { sanitizeDiagnosticData } from '../utils/mediaDiagnostics.js';

export interface ConversationLogContext {
  providerName: string;
  conversationId: string;
  turnNumber: number;
  generatePromptId: () => string;
  redactor: ConversationDataRedactor | null;
  conversationLogEmptyTools?: boolean;
  sanitizeMedia?: boolean;
}

/** Log a conversation request event to telemetry and disk. */
function requestTools(
  tools: ProviderToolset | undefined,
  ctx: ConversationLogContext,
): ConversationRequestEvent['redacted_tools'] {
  if (ctx.conversationLogEmptyTools === true && (tools?.length ?? 0) === 0)
    return [];
  if (tools === undefined) return undefined;
  return [{ functionDeclarations: tools.map((decl) => ({ ...decl })) }];
}

export async function logConversationRequestEntry(
  config: Config,
  content: IContent[],
  tools: ProviderToolset | undefined,
  promptId: string | undefined,
  ctx: ConversationLogContext,
): Promise<void> {
  async function* rows(): AsyncGenerator<IContent> {
    yield* content;
  }
  await logStreamingConversationRequestEntry(
    config,
    rows(),
    tools,
    promptId ?? ctx.generatePromptId(),
    ctx,
  );
}

export async function writeRedactedRequest(
  config: Config,
  content: AsyncIterable<IContent>,
  tools: ProviderToolset | undefined,
  promptId: string,
  ctx: ConversationLogContext,
  signal?: AbortSignal,
): Promise<RequestArtifactDescriptor> {
  const redactedTools = requestTools(tools, ctx);
  async function* redactedRows(): AsyncGenerator<unknown> {
    for await (const row of content) {
      signal?.throwIfAborted();
      const redacted = ctx.redactor
        ? ctx.redactor.redactMessage(row, ctx.providerName)
        : row;
      yield ctx.sanitizeMedia === true
        ? sanitizeDiagnosticData(redacted)
        : redacted;
    }
  }
  return getConversationFileWriter(
    config.getConversationLogPath(),
  ).writeRequestStream(
    ctx.providerName,
    redactedRows(),
    {
      conversationId: ctx.conversationId,
      turnNumber: ctx.turnNumber,
      promptId,
      tools: redactedTools,
      toolFormat: 'default',
    },
    signal,
  );
}

export async function logStreamingConversationRequestEntry(
  config: Config,
  content: AsyncIterable<IContent>,
  tools: ProviderToolset | undefined,
  promptId: string,
  ctx: ConversationLogContext,
  signal?: AbortSignal,
  acknowledged = false,
): Promise<RequestArtifactDescriptor> {
  const artifact = await writeRedactedRequest(
    config,
    content,
    tools,
    promptId,
    ctx,
    signal,
  );
  const redactedTools = requestTools(tools, ctx);
  await logConversationRequest(
    config,
    new ConversationRequestEvent(
      ctx.providerName,
      ctx.conversationId,
      ctx.turnNumber,
      promptId,
      artifact,
      redactedTools,
      'default',
    ),
    signal,
    acknowledged,
  );
  return artifact;
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
