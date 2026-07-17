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
 * Safely resolve whether conversation logging is enabled. Any error from
 * the config callback is treated as logging-disabled (fail-open) so the
 * tool call or original provider error is never affected.
 */
function resolveLoggingEnabledSafely(
  config: unknown,
  debug: DebugLogger,
): boolean {
  try {
    const loggingConfig = resolveLoggingConfig(config);
    return loggingConfig?.getConversationLoggingEnabled() === true;
  } catch (err) {
    // Fail-open: treat resolution errors as logging-disabled
    debug.warn(() => `getConversationLoggingEnabled threw: ${String(err)}`);
    return false;
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
  // Resolve the logging flag once, fail-open on any error
  const loggingEnabled = resolveLoggingEnabledSafely(config, logCtx.debug);

  try {
    const result = await provider.invokeServerTool(toolName, params, config);

    if (loggingEnabled) {
      try {
        await logToolCall(
          resolveLoggingConfig(config),
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
    if (loggingEnabled) {
      try {
        await logToolCall(
          resolveLoggingConfig(config),
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
