/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { isProviderApiError } from '@vybestack/llxprt-code-core/llm-types/index.js';
import { isSchemaDepthError } from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { hasCycleInSchema } from '@vybestack/llxprt-code-tools';

/**
 * Enriches schema depth errors with additional context for debugging.
 * Logs tool names and any tools whose parameter schemas contain cycles,
 * which are a known cause of "maximum schema depth exceeded" errors.
 */
export function enrichSchemaDepthError(
  error: unknown,
  tools: unknown,
  logger: DebugLogger,
): void {
  if (
    !isProviderApiError(error) ||
    error.message === '' ||
    !isSchemaDepthError(error.message)
  ) {
    return;
  }

  if (!Array.isArray(tools)) {
    return;
  }

  const toolNames: string[] = [];
  const cyclicSchemaTools: string[] = [];

  for (const toolGroup of tools) {
    collectCyclicSchemaToolNames(toolGroup, toolNames, cyclicSchemaTools);
  }

  const metadata = {
    totalTools: toolNames.length,
    toolNames,
    cyclicSchemaTools,
  };

  const extraDetails =
    cyclicSchemaTools.length > 0
      ? `\n\nTools with cyclic schemas detected: ${cyclicSchemaTools.join(', ')}\n` +
        `This is a known issue that can cause "maximum schema depth exceeded" errors.\n` +
        `Please review the schema definitions for these tools.`
      : '';

  logger.error(
    () => `[TurnProcessor] Schema depth error encountered${extraDetails}`,
    metadata,
  );
}

/**
 * Collects tool names and any with cyclic schemas from a single tool group.
 * Tool groups can be malformed at runtime, so the shape is validated before use.
 */
function collectCyclicSchemaToolNames(
  toolGroup: unknown,
  toolNames: string[],
  cyclicSchemaTools: string[],
): void {
  if (
    typeof toolGroup !== 'object' ||
    toolGroup === null ||
    !('functionDeclarations' in toolGroup) ||
    !Array.isArray(toolGroup.functionDeclarations)
  ) {
    return;
  }

  for (const funcDecl of toolGroup.functionDeclarations) {
    if (typeof funcDecl !== 'object' || funcDecl === null) {
      continue;
    }
    const name = funcDecl.name ?? 'unknown';
    toolNames.push(name);
    const schema = funcDecl.parametersJsonSchema;
    if (
      schema != null &&
      typeof schema === 'object' &&
      hasCycleInSchema(schema as Record<string, unknown>)
    ) {
      cyclicSchemaTools.push(name);
    }
  }
}
