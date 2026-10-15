/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProviderRequestDiagnostics } from '@vybestack/llxprt-code-core/runtime/providerRequestDiagnostics.js';
import { ApiRequestEvent } from '@vybestack/llxprt-code-core/telemetry/types.js';
import type { GenerateChatOptions } from '../IProvider.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import {
  writeRedactedRequest,
  type ConversationLogContext,
} from './conversationLogger.js';
import { getRequestSignal } from '../utils/abortSignal.js';
import type { RequestLoggingPolicy } from './requestLoggingPolicy.js';
import type { RequestArtifactDescriptor } from '@vybestack/llxprt-code-storage/storage/ConversationFileWriter.js';

/** Log opted-in API content from a redacted, media-sanitized durable artifact. */
export async function logApiRequestTelemetry(
  activeConfig: ProviderRequestDiagnostics,
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
    if (policy.strictTelemetry) activeConfig.assertRequestArtifactExporter();
    let artifact: RequestArtifactDescriptor | undefined;
    if (activeConfig.requestBodyLoggingEnabled) {
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
    await activeConfig.recordApiRequest(event, {
      signal,
      acknowledged: policy.strictTelemetry,
    });
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

/**
 * Log the body-less `api_request` for a send that is not exporting its body,
 * carrying the size the provider reported (absent when it never reported one).
 * Synchronous: without an artifact or acknowledgement the event is a plain
 * record, so the sender can emit it the moment its request body is final.
 */
export function logSizedApiRequestTelemetry(
  activeConfig: ProviderRequestDiagnostics,
  normalizedOptions: GenerateChatOptions,
  promptId: string,
  defaultModelName: string,
  debug: DebugLogger,
  policy: RequestLoggingPolicy,
  requestChars: number | undefined,
): void {
  try {
    const modelName = normalizedOptions.resolved?.model ?? defaultModelName;
    const pending = activeConfig.recordApiRequest(
      new ApiRequestEvent(
        modelName,
        promptId,
        undefined,
        undefined,
        requestChars,
      ),
      { signal: getRequestSignal(normalizedOptions), acknowledged: false },
    );
    if (pending !== undefined) {
      throw new Error('A body-less API request event cannot be acknowledged');
    }
  } catch (error) {
    getRequestSignal(normalizedOptions)?.throwIfAborted();
    if (policy.strictPreSend) throw error;
    debug.warn(
      () => `API request telemetry failed (fail-open): ${String(error)}`,
    );
  }
}
