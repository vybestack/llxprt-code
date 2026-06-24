/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Telemetry emission helpers extracted from LoggingProviderWrapper to keep
 * the main wrapper file under the lint line budget.
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  logTokenUsage,
  logApiResponse,
  logConversationResponse,
} from '@vybestack/llxprt-code-core/telemetry/loggers.js';
import {
  TokenUsageEvent,
  ApiResponseEvent,
  ConversationResponseEvent,
} from '@vybestack/llxprt-code-core/telemetry/types.js';
import { getConversationFileWriter } from '@vybestack/llxprt-code-storage/storage/ConversationFileWriter.js';
import type { TokenCounts } from './tokenCounts.js';

export type ResponseTokenCounts = TokenCounts & {
  cache_creation_input_tokens: number | null;
};

/** Issue #684: Emit API response telemetry for /stats model tracking. */
export function emitMetricsTelemetry(
  config: Config | undefined,
  tokenCounts: ResponseTokenCounts,
  modelName: string,
  duration: number,
  lastFinishReason: string | undefined,
): void {
  if (!config) {
    return;
  }
  const finishReasons = lastFinishReason ? [lastFinishReason] : [];
  const event = new ApiResponseEvent(
    modelName,
    duration,
    '',
    undefined,
    undefined,
    undefined,
    finishReasons,
  );
  event.input_token_count = tokenCounts.input_token_count;
  event.output_token_count = tokenCounts.output_token_count;
  event.cached_content_token_count = tokenCounts.cached_content_token_count;
  event.thoughts_token_count = tokenCounts.thoughts_token_count;
  event.tool_token_count = tokenCounts.tool_token_count;
  event.total_token_count =
    tokenCounts.input_token_count + tokenCounts.output_token_count;
  logApiResponse(config, event);
}

export interface ResponseTelemetryContext {
  providerName: string;
  conversationId: string;
  turnNumber: number;
  defaultModelName: string;
}

/** Emit token usage and API response telemetry events. */
export function emitResponseTelemetry(
  config: Config,
  tokenCounts: ResponseTokenCounts,
  modelName: string | undefined,
  promptId: string,
  duration: number,
  finishReasons: string[] | undefined,
  success: boolean,
  error: unknown,
  ctx: ResponseTelemetryContext,
): void {
  const totalTokens =
    tokenCounts.input_token_count +
    tokenCounts.output_token_count +
    tokenCounts.thoughts_token_count +
    tokenCounts.tool_token_count;

  logTokenUsage(
    config,
    new TokenUsageEvent(
      ctx.providerName,
      ctx.conversationId,
      tokenCounts.input_token_count,
      tokenCounts.output_token_count,
      tokenCounts.cached_content_token_count,
      tokenCounts.tool_token_count,
      tokenCounts.thoughts_token_count,
      totalTokens,
    ),
  );

  const resolvedModelName = modelName ?? ctx.defaultModelName;
  const apiResponseEvent = new ApiResponseEvent(
    resolvedModelName,
    duration,
    promptId,
    undefined,
    undefined,
    undefined,
    finishReasons,
  );
  apiResponseEvent.input_token_count = tokenCounts.input_token_count;
  apiResponseEvent.output_token_count = tokenCounts.output_token_count;
  apiResponseEvent.cached_content_token_count =
    tokenCounts.cached_content_token_count;
  apiResponseEvent.thoughts_token_count = tokenCounts.thoughts_token_count;
  apiResponseEvent.tool_token_count = tokenCounts.tool_token_count;
  apiResponseEvent.total_token_count = totalTokens;
  if (!success && error != null) {
    apiResponseEvent.error = String(error);
  }
  logApiResponse(config, apiResponseEvent);
}

/** Write conversation response event to telemetry and disk. */
export function writeConversationLog(
  config: Config,
  redactedContent: string,
  promptId: string,
  duration: number,
  success: boolean,
  error: unknown,
  ctx: ResponseTelemetryContext,
): void {
  const event = new ConversationResponseEvent(
    ctx.providerName,
    ctx.conversationId,
    ctx.turnNumber,
    promptId,
    redactedContent,
    duration,
    success,
    error != null ? String(error) : undefined,
  );
  logConversationResponse(config, event);

  const fileWriter = getConversationFileWriter(config.getConversationLogPath());
  fileWriter.writeResponse(ctx.providerName, redactedContent, {
    conversationId: ctx.conversationId,
    turnNumber: ctx.turnNumber,
    promptId,
    duration,
    success,
    error: error != null ? String(error) : undefined,
  });
}
