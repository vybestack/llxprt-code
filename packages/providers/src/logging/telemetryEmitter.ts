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
} from '@vybestack/llxprt-code-telemetry/telemetry/loggers.js';
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

export interface AttemptTelemetryMeta {
  attemptId: string;
  promptId?: string;
  providerName: string;
  timeToFirstTokenMs: number | null;
  lastTokenMs?: number | null;
  hasUsage: boolean;
  /** Monotonic timestamp (ms) when the attempt started */
  startMs?: number;
}

/** Emit API response telemetry for local /stats tracking and SDK export. */
export function emitMetricsTelemetry(
  config: Config | undefined,
  tokenCounts: ResponseTokenCounts,
  modelName: string,
  duration: number,
  finishReasons: string[] | undefined,
  attemptMeta?: AttemptTelemetryMeta,
): void {
  if (!config) {
    return;
  }
  const normalizedFinishReasons = Array.isArray(finishReasons)
    ? finishReasons
    : [];
  const promptId = attemptMeta?.promptId ?? '';
  const event = new ApiResponseEvent(
    modelName,
    duration,
    promptId,
    undefined,
    undefined,
    undefined,
    normalizedFinishReasons,
    attemptMeta?.attemptId,
  );
  event.input_token_count = tokenCounts.input_token_count;
  event.output_token_count = tokenCounts.output_token_count;
  event.cached_content_token_count = tokenCounts.cached_content_token_count;
  event.thoughts_token_count = tokenCounts.thoughts_token_count;
  event.tool_token_count = tokenCounts.tool_token_count;
  event.total_token_count =
    tokenCounts.input_token_count +
    tokenCounts.output_token_count +
    tokenCounts.thoughts_token_count +
    tokenCounts.tool_token_count;
  event.cache_read_input_tokens = tokenCounts.cache_read_input_tokens;
  event.cache_creation_input_tokens = tokenCounts.cache_creation_input_tokens;
  if (attemptMeta) {
    event.provider = attemptMeta.providerName;
    event.time_to_first_token_ms = attemptMeta.timeToFirstTokenMs;
    event.last_token_ms = attemptMeta.lastTokenMs ?? null;
    event.start_ms = attemptMeta.startMs;
    (
      event as ApiResponseEvent & { usage_metadata_present?: boolean }
    ).usage_metadata_present = attemptMeta.hasUsage;
  }
  event.provider_owned = true;
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
  attemptMeta?: AttemptTelemetryMeta,
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
  const attemptId = attemptMeta?.attemptId ?? `${ctx.providerName}:${promptId}`;
  const apiResponseEvent = new ApiResponseEvent(
    resolvedModelName,
    duration,
    promptId,
    undefined,
    undefined,
    undefined,
    finishReasons,
    attemptId,
  );
  apiResponseEvent.provider = ctx.providerName;
  apiResponseEvent.input_token_count = tokenCounts.input_token_count;
  apiResponseEvent.output_token_count = tokenCounts.output_token_count;
  apiResponseEvent.cached_content_token_count =
    tokenCounts.cached_content_token_count;
  apiResponseEvent.thoughts_token_count = tokenCounts.thoughts_token_count;
  apiResponseEvent.tool_token_count = tokenCounts.tool_token_count;
  apiResponseEvent.total_token_count = totalTokens;
  apiResponseEvent.cache_read_input_tokens =
    tokenCounts.cache_read_input_tokens;
  apiResponseEvent.cache_creation_input_tokens =
    tokenCounts.cache_creation_input_tokens;
  if (attemptMeta) {
    apiResponseEvent.time_to_first_token_ms = attemptMeta.timeToFirstTokenMs;
    apiResponseEvent.last_token_ms = attemptMeta.lastTokenMs ?? null;
    apiResponseEvent.start_ms = attemptMeta.startMs;
    (
      apiResponseEvent as ApiResponseEvent & {
        usage_metadata_present?: boolean;
      }
    ).usage_metadata_present = attemptMeta.hasUsage;
  }
  if (!success && error != null) {
    apiResponseEvent.error = String(error);
  }
  apiResponseEvent.provider_owned = true;
  logApiResponse(config, apiResponseEvent);
}

/** Write conversation response event to telemetry and disk. */
export async function writeConversationLog(
  config: Config,
  redactedContent: string,
  promptId: string,
  duration: number,
  success: boolean,
  error: unknown,
  ctx: ResponseTelemetryContext,
): Promise<void> {
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
  await fileWriter.writeResponse(ctx.providerName, redactedContent, {
    conversationId: ctx.conversationId,
    turnNumber: ctx.turnNumber,
    promptId,
    duration,
    success,
    error: error != null ? String(error) : undefined,
  });
}
