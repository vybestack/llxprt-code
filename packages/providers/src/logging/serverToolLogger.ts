/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IProvider } from '../IProvider.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { logToolCallEntry } from './conversationLogger.js';
import type { ConversationDataRedactor } from './ConfigBasedRedactor.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { resolveLoggingConfig } from './tokenAccumulator.js';

export interface ServerToolLogContext {
  readonly providerName: string;
  readonly conversationId: string;
  readonly turnNumber: number;
  readonly generatePromptId: () => string;
  readonly redactor: ConversationDataRedactor | null;
  readonly debug: DebugLogger;
}

/**
 * Log a tool call entry to the conversation log (fail-open).
 */
export async function logToolCall(
  config: Config | undefined,
  toolName: string,
  params: unknown,
  result: unknown,
  startTime: number,
  success: boolean,
  error: unknown | undefined,
  ctx: ServerToolLogContext,
): Promise<void> {
  try {
    await logToolCallEntry(
      config,
      toolName,
      params,
      result,
      startTime,
      success,
      error,
      {
        providerName: ctx.providerName,
        conversationId: ctx.conversationId,
        turnNumber: ctx.turnNumber,
        generatePromptId: ctx.generatePromptId,
        redactor: ctx.redactor,
      },
    );
  } catch (logError) {
    ctx.debug.warn(() => `Failed to log tool call: ${logError}`);
  }
}

/**
 * Invoke a server tool with conversation logging support.
 */
export async function invokeServerToolWithLogging(
  provider: IProvider,
  toolName: string,
  params: unknown,
  config: unknown,
  logCtx: ServerToolLogContext,
): Promise<unknown> {
  const startTime = Date.now();
  // Resolve logging config once and reuse for both the enabled-check and
  // the actual logging calls. Any resolution error is treated as
  // logging-disabled (fail-open).
  let loggingConfig: ReturnType<typeof resolveLoggingConfig> | undefined;
  let loggingEnabled = false;
  try {
    loggingConfig = resolveLoggingConfig(config);
    loggingEnabled = loggingConfig?.getConversationLoggingEnabled() === true;
  } catch (err) {
    logCtx.debug.warn(
      () => `getConversationLoggingEnabled threw: ${String(err)}`,
    );
  }

  try {
    const result = await provider.invokeServerTool(toolName, params, config);

    if (loggingEnabled && loggingConfig) {
      try {
        await logToolCall(
          loggingConfig,
          toolName,
          params,
          result,
          startTime,
          true,
          undefined,
          logCtx,
        );
      } catch (logError) {
        logCtx.debug.warn(
          () => `Failed to log successful tool call: ${logError}`,
        );
      }
    }
    return result;
  } catch (error) {
    if (loggingEnabled && loggingConfig) {
      try {
        await logToolCall(
          loggingConfig,
          toolName,
          params,
          null,
          startTime,
          false,
          error,
          logCtx,
        );
      } catch (logError) {
        logCtx.debug.warn(() => `Failed to log failed tool call: ${logError}`);
      }
    }
    throw error;
  }
}
