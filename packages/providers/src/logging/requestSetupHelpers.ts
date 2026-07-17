/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { GenerateChatOptions } from '../IProvider.js';
import { ConfigBasedRedactor } from './ConfigBasedRedactor.js';
import type { ConversationDataRedactor } from './ConfigBasedRedactor.js';
import { logRequestEntry } from './conversationResponseLogger.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';

export interface RequestSetupContext {
  readonly providerName: string;
  readonly conversationId: string;
  readonly turnNumber: number;
  readonly defaultModelName: string;
  readonly generatePromptId: () => string;
  readonly injectedRedactor: ConversationDataRedactor | null;
  readonly debug: DebugLogger;
}

/**
 * Set up per-call redactor based on injected redactor or invocation/config.
 */
export function setupRedactor(
  normalizedOptions: GenerateChatOptions,
  activeConfig: Config,
  ctx: RequestSetupContext,
): ConversationDataRedactor | null {
  const invocation = normalizedOptions.invocation;
  if (ctx.injectedRedactor) {
    ctx.debug.log(() => `After redactor setup: hasRedactor=true`);
    return ctx.injectedRedactor;
  }

  let redactor: ConversationDataRedactor;
  if (invocation?.redaction) {
    redactor = new ConfigBasedRedactor({ ...invocation.redaction });
  } else {
    redactor = new ConfigBasedRedactor(activeConfig.getRedactionConfig());
  }
  ctx.debug.log(() => `After redactor setup: hasRedactor=true`);
  return redactor;
}

/**
 * Check whether conversation logging is enabled, re-throwing on failure.
 */
export function checkConversationLoggingEnabled(
  activeConfig: Config,
  debug: DebugLogger,
): boolean {
  try {
    debug.log(() => `About to call getConversationLoggingEnabled()`);
    const enabled = activeConfig.getConversationLoggingEnabled();
    debug.log(() => `getConversationLoggingEnabled() returned: ${enabled}`);
    return enabled;
  } catch (error) {
    debug.error(
      () =>
        `getConversationLoggingEnabled() threw exception: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  }
}

/**
 * Log the request if conversation logging is enabled.
 */
export async function logRequestIfEnabled(
  activeConfig: Config,
  normalizedOptions: GenerateChatOptions,
  promptId: string,
  redactor: ConversationDataRedactor | null,
  ctx: RequestSetupContext,
): Promise<void> {
  ctx.debug.log(
    () =>
      `Before logRequest: contents length = ${normalizedOptions.contents.length}`,
  );
  // logRequestEntry is already fail-open (catches its own errors and warns).
  // Any unexpected error here is also treated as non-fatal so request
  // reliability is never compromised by conversation logging.
  try {
    await logRequestEntry(
      activeConfig,
      normalizedOptions.contents,
      normalizedOptions.tools,
      promptId,
      {
        providerName: ctx.providerName,
        conversationId: ctx.conversationId,
        turnNumber: ctx.turnNumber,
        defaultModelName: ctx.defaultModelName,
        generatePromptId: ctx.generatePromptId,
        redactor,
        debug: ctx.debug,
      },
    );
  } catch (error) {
    ctx.debug.warn(
      () =>
        `logRequest failed (fail-open): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  ctx.debug.log(
    () =>
      `After logRequest: contents length = ${normalizedOptions.contents.length}`,
  );
}
