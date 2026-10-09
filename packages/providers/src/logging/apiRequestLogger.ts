/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { logApiRequest } from '@vybestack/llxprt-code-core/telemetry/loggers.js';
import { ApiRequestEvent } from '@vybestack/llxprt-code-core/telemetry/types.js';
import type { GenerateChatOptions } from '../IProvider.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import {
  writeRedactedRequest,
  type ConversationLogContext,
} from './conversationLogger.js';
import { getRequestSignal } from '../utils/abortSignal.js';
import {
  isTelemetrySdkInitialized,
  assertRequestArtifactExporter,
} from '@vybestack/llxprt-code-telemetry/telemetry/sdk.js';
import type { RequestLoggingPolicy } from './requestLoggingPolicy.js';
import type { RequestArtifactDescriptor } from '@vybestack/llxprt-code-storage/storage/ConversationFileWriter.js';

/** Log opted-in API content from a redacted, media-sanitized durable artifact. */
export async function logApiRequestTelemetry(
  activeConfig: Config,
  normalizedOptions: GenerateChatOptions,
  promptId: string,
  defaultModelName: string,
  debug: DebugLogger,
  ctx: ConversationLogContext,
  policy: RequestLoggingPolicy,
  requestArtifact?: RequestArtifactDescriptor,
): Promise<void> {
  debug.log(() => `Before API request telemetry section`);
  try {
    const signal = getRequestSignal(normalizedOptions);
    if (policy.strictTelemetry) assertRequestArtifactExporter();
    let artifact: RequestArtifactDescriptor | undefined;
    if (
      isTelemetrySdkInitialized() &&
      activeConfig.getTelemetryLogApiBodiesEnabled() &&
      activeConfig.getTelemetryLogPromptsEnabled()
    ) {
      artifact = policy.strictPreSend ? requestArtifact : undefined;
      artifact ??= await writeRedactedRequest(
        activeConfig,
        normalizedOptions.contents,
        normalizedOptions.tools,
        promptId,
        { ...ctx, sanitizeMedia: true },
        signal,
      );
    }
    const modelName = normalizedOptions.resolved?.model ?? defaultModelName;
    const event = new ApiRequestEvent(modelName, promptId, undefined, artifact);
    if (policy.strictTelemetry)
      await logApiRequest(activeConfig, event, signal, true);
    else await logApiRequest(activeConfig, event, signal);
    debug.log(
      () =>
        `After API request logged: contents length=${normalizedOptions.contentCount ?? 'unknown'}`,
    );
  } catch (error) {
    getRequestSignal(normalizedOptions)?.throwIfAborted();
    if (policy.strictPreSend) throw error;
    debug.warn(
      () => `API request telemetry failed (fail-open): ${String(error)}`,
    );
  }
}
