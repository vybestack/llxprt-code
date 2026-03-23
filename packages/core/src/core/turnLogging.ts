/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure logging and configuration utilities for turn execution.
 * Extracted from geminiChat.ts Phase 05.
 */

import type {
  Content,
  GenerateContentConfig,
  GenerateContentResponseUsageMetadata,
} from '@google/genai';
import type { AgentRuntimeContext } from '../runtime/AgentRuntimeContext.js';
import type { AgentRuntimeState } from '../runtime/AgentRuntimeState.js';

/**
 * Extract request text from contents for logging
 */
export function getRequestTextFromContents(contents: Content[]): string {
  return JSON.stringify(contents);
}

/**
 * Extract direct Gemini SDK overrides from generation config
 */
export function extractDirectGeminiOverrides(config?: GenerateContentConfig):
  | {
      serverTools?: unknown;
      toolConfig?: GenerateContentConfig['toolConfig'];
    }
  | undefined {
  if (!config || typeof config !== 'object') {
    return undefined;
  }
  const overrides: {
    serverTools?: unknown;
    toolConfig?: GenerateContentConfig['toolConfig'];
  } = {};
  const rawConfig = config as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(rawConfig, 'serverTools')) {
    overrides.serverTools = rawConfig.serverTools;
  }
  if (config.toolConfig) {
    overrides.toolConfig = config.toolConfig;
  }

  if (
    typeof overrides.serverTools === 'undefined' &&
    typeof overrides.toolConfig === 'undefined'
  ) {
    return undefined;
  }
  return overrides;
}

/**
 * Log API request to telemetry
 */
export function logApiRequest(
  runtimeContext: AgentRuntimeContext,
  runtimeState: AgentRuntimeState,
  contents: Content[],
  model: string,
  promptId: string,
): void {
  const requestText = getRequestTextFromContents(contents);
  runtimeContext.telemetry.logApiRequest({
    model,
    promptId,
    requestText,
    sessionId: runtimeState.sessionId,
    runtimeId: runtimeState.runtimeId,
    provider: runtimeState.provider,
    timestamp: Date.now(),
  });
}

/**
 * Log API response to telemetry
 */
export function logApiResponse(
  runtimeContext: AgentRuntimeContext,
  runtimeState: AgentRuntimeState,
  model: string,
  promptId: string,
  durationMs: number,
  usageMetadata?: GenerateContentResponseUsageMetadata,
  responseText?: string,
): void {
  runtimeContext.telemetry.logApiResponse({
    model,
    promptId,
    durationMs,
    sessionId: runtimeState.sessionId,
    runtimeId: runtimeState.runtimeId,
    provider: runtimeState.provider,
    usageMetadata,
    responseText,
  });
}

/**
 * Log API error to telemetry
 */
export function logApiError(
  runtimeContext: AgentRuntimeContext,
  runtimeState: AgentRuntimeState,
  model: string,
  promptId: string,
  durationMs: number,
  error: unknown,
): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorType = error instanceof Error ? error.name : 'unknown';

  runtimeContext.telemetry.logApiError({
    model,
    promptId,
    durationMs,
    error: errorMessage,
    errorType,
    sessionId: runtimeState.sessionId,
    runtimeId: runtimeState.runtimeId,
    provider: runtimeState.provider,
  });
}
