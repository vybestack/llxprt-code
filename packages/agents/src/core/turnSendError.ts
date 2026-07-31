/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { enrichSchemaDepthError } from './schemaDepthErrorEnrichment.js';
import { logApiError } from './turnLogging.js';

export function throwTurnSendError(
  error: unknown,
  runtimeContext: AgentRuntimeContext,
  promptId: string,
  durationMs: number,
  tools: Array<{ functionDeclarations: Array<{ name: string }> }> | undefined,
  logger: DebugLogger,
): never {
  logApiError(
    runtimeContext,
    runtimeContext.state,
    runtimeContext.state.model,
    promptId,
    durationMs,
    error,
  );
  enrichSchemaDepthError(error, tools, logger);
  throw error;
}
