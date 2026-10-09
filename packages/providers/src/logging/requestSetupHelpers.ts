/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { GenerateChatOptions } from '../IProvider.js';
import { ConfigBasedRedactor } from './ConfigBasedRedactor.js';
import type { ConversationDataRedactor } from './ConfigBasedRedactor.js';
import { logStreamingConversationRequestEntry } from './conversationLogger.js';
import { getRequestSignal } from '../utils/abortSignal.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { RequestLoggingPolicy } from './requestLoggingPolicy.js';
import type { RequestArtifactDescriptor } from '@vybestack/llxprt-code-storage/storage/ConversationFileWriter.js';

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
  policy: RequestLoggingPolicy,
): Promise<RequestArtifactDescriptor | undefined> {
  ctx.debug.log(
    () =>
      `Before logRequest: contents length = ${normalizedOptions.contentCount ?? 'unknown'}`,
  );
  // Eager logging stays best-effort; branded source attempts require the append result.
  let artifact: RequestArtifactDescriptor | undefined;
  try {
    artifact = await logStreamingConversationRequestEntry(
      activeConfig,
      normalizedOptions.contents,
      normalizedOptions.tools,
      promptId,
      {
        providerName: ctx.providerName,
        conversationId: ctx.conversationId,
        turnNumber: ctx.turnNumber,
        generatePromptId: ctx.generatePromptId,
        redactor,
        conversationLogEmptyTools:
          normalizedOptions.metadata?.conversationLogEmptyTools === true,
        sanitizeMedia: policy.strictPreSend,
      },
      getRequestSignal(normalizedOptions),
      policy.strictTelemetry,
    );
  } catch (error) {
    getRequestSignal(normalizedOptions)?.throwIfAborted();
    if (policy.strictPreSend) throw error;
    ctx.debug.warn(
      () =>
        `Failed to log conversation request (fail-open): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  ctx.debug.log(
    () =>
      `After logRequest: contents length = ${normalizedOptions.contentCount ?? 'unknown'}`,
  );
  return artifact;
}
