/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderToolset } from '../IProvider.js';
import { writeConversationLog } from './telemetryEmitter.js';
import { logConversationRequestEntry } from './conversationLogger.js';
import type { ConversationDataRedactor } from './ConfigBasedRedactor.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { RequestLoggingPolicy } from './requestLoggingPolicy.js';

export interface ConversationLogContext {
  readonly providerName: string;
  readonly conversationId: string;
  readonly turnNumber: number;
  readonly defaultModelName: string;
  readonly generatePromptId: () => string;
  readonly redactor: ConversationDataRedactor | null;
  readonly debug: DebugLogger;
  readonly conversationLogEmptyTools?: boolean;
}

/**
 * Write a conversation response log entry to telemetry and disk (fail-open).
 */
export async function writeResponseLog(
  config: Config,
  content: string,
  promptId: string,
  duration: number,
  success: boolean,
  error: unknown,
  ctx: ConversationLogContext,
  policy?: RequestLoggingPolicy,
): Promise<void | (() => void | Promise<void>)> {
  try {
    const redactedContent = ctx.redactor
      ? ctx.redactor.redactResponseContent(content, ctx.providerName)
      : content;
    const policyArguments: [] | [RequestLoggingPolicy] =
      policy === undefined ? [] : [policy];
    return await writeConversationLog(
      config,
      redactedContent,
      promptId,
      duration,
      success,
      error,
      {
        providerName: ctx.providerName,
        conversationId: ctx.conversationId,
        turnNumber: ctx.turnNumber,
        defaultModelName: ctx.defaultModelName,
      },
      ...policyArguments,
    );
  } catch (logError) {
    if (policy?.strictDurableResponse === true) throw logError;
    ctx.debug.warn(
      () => `Failed to write conversation response log: ${logError}`,
    );
    return undefined;
  }
}

/**
 * Log a conversation request entry (fail-open).
 */
export async function logRequestEntry(
  config: Config,
  content: IContent[],
  tools: ProviderToolset | undefined,
  promptId: string | undefined,
  ctx: ConversationLogContext,
): Promise<void> {
  try {
    await logConversationRequestEntry(config, content, tools, promptId, {
      providerName: ctx.providerName,
      conversationId: ctx.conversationId,
      turnNumber: ctx.turnNumber,
      generatePromptId: ctx.generatePromptId,
      redactor: ctx.redactor,
      conversationLogEmptyTools: ctx.conversationLogEmptyTools,
    });
  } catch (error) {
    ctx.debug.warn(() => `Failed to log conversation request: ${error}`);
  }
}
