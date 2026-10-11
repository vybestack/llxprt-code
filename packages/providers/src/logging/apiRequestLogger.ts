/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProviderRequestDiagnostics } from '@vybestack/llxprt-code-core/runtime/providerRequestDiagnostics.js';
import { ApiRequestEvent } from '@vybestack/llxprt-code-core/telemetry/types.js';
import type { GenerateChatOptions } from '../IProvider.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { sanitizeDiagnosticData } from '../utils/mediaDiagnostics.js';

/**
 * Log API request telemetry event. The entire telemetry block is wrapped
 * fail-open so JSON.stringify, model resolution, or logApiRequest failures
 * never prevent provider invocation.
 */
export function logApiRequestTelemetry(
  activeConfig: ProviderRequestDiagnostics,
  normalizedOptions: GenerateChatOptions,
  promptId: string,
  defaultModelName: string,
  debug: DebugLogger,
): void {
  debug.log(() => `Before API request telemetry section`);
  try {
    const requestText = JSON.stringify(
      sanitizeDiagnosticData(normalizedOptions.contents),
    );
    debug.log(
      () => `After JSON.stringify: requestText length=${requestText.length}`,
    );
    const modelName = normalizedOptions.resolved?.model ?? defaultModelName;
    debug.log(
      () => `Logging API request: model=${modelName}, promptId=${promptId}`,
    );
    activeConfig.recordApiRequest(
      new ApiRequestEvent(modelName, promptId, requestText),
    );
    debug.log(
      () =>
        `After API request logged: contents length=${normalizedOptions.contents.length}`,
    );
  } catch (error) {
    debug.warn(
      () => `API request telemetry failed (fail-open): ${String(error)}`,
    );
  }
}
