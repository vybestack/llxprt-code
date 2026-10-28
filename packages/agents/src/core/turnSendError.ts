/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolDeclaration } from '@vybestack/llxprt-code-core/llm-types/toolDeclaration.js';

import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { enrichSchemaDepthError } from './schemaDepthErrorEnrichment.js';
import { logApiError, type TurnTelemetryPorts } from './turnLogging.js';

export function throwTurnSendError(
  error: unknown,
  telemetry: TurnTelemetryPorts,
  promptId: string,
  durationMs: number,
  tools: ToolDeclaration[] | undefined,
  logger: DebugLogger,
): never {
  logApiError(telemetry, telemetry.model, promptId, durationMs, error);
  enrichSchemaDepthError(error, tools, logger);
  throw error;
}
