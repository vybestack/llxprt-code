/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolDeclaration } from '@vybestack/llxprt-code-core/llm-types/toolDeclaration.js';

import { isProviderApiError } from '@vybestack/llxprt-code-core/llm-types/index.js';
import { isSchemaDepthError } from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { hasCycleInSchema } from '@vybestack/llxprt-code-tools/tools/tools.js';

/**
 * Enriches schema depth errors with additional context for debugging.
 * Logs tool names and any tools whose parameter schemas contain cycles,
 * which are a known cause of "maximum schema depth exceeded" errors.
 */
export function enrichSchemaDepthError(
  error: unknown,
  tools: ToolDeclaration[] | undefined,
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

  for (const declaration of tools) {
    collectCyclicSchemaToolNames(declaration, toolNames, cyclicSchemaTools);
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
 * Collects a declaration's name and identifies cyclic parameter schemas.
 */
function collectCyclicSchemaToolNames(
  funcDecl: ToolDeclaration,
  toolNames: string[],
  cyclicSchemaTools: string[],
): void {
  const name = funcDecl.name;
  toolNames.push(name);
  const schema = funcDecl.parametersJsonSchema;
  if (typeof schema === 'object' && hasCycleInSchema(schema)) {
    cyclicSchemaTools.push(name);
  }
}
