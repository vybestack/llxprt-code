/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Schema converter for the classic OpenAI provider.
 *
 * The conversion logic lives in the shared
 * `packages/providers/src/openai-shared/schemaConverter.ts` module so that the
 * classic and Vercel providers cannot drift apart. This file is a thin
 * provider-specific wrapper that narrows the shared types to the classic
 * OpenAI SDK tool shape (description is always a string) and preserves the
 * classic debug-logging namespace.
 */

import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import {
  convertToolDeclarations,
  type OpenAIFunctionParameters,
} from '../openai-shared/schemaConverter.js';

export type {
  OpenAIFunctionParameters,
  OpenAIPropertySchema,
  convertSchemaToOpenAI,
} from '../openai-shared/schemaConverter.js';

const logger = new DebugLogger('llxprt:provider:openai:schema');

/**
 * OpenAI tool format for function calling. The classic OpenAI SDK expects a
 * non-optional string description and a parameters object.
 */
export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: OpenAIFunctionParameters;
  };
}

/**
 * Convert an array of Gemini-style tool declarations to OpenAI format.
 * Delegates to the shared converter with the classic description strategy
 * (missing descriptions become empty strings).
 */
export function convertToolsToOpenAI(
  geminiTools?: Array<{
    functionDeclarations?: Array<{
      name: string;
      description?: string;
      parametersJsonSchema?: unknown;
    }>;
  }>,
): OpenAITool[] | undefined {
  const converted = convertToolDeclarations(geminiTools, {
    descriptionStrategy: 'always-string',
  });

  if (converted === undefined) {
    return undefined;
  }

  const openAITools: OpenAITool[] = converted.map((tool) => ({
    type: 'function',
    function: {
      name: tool.function.name,
      description: tool.function.description ?? '',
      parameters: tool.function.parameters,
    },
  }));

  if (logger.enabled && openAITools.length > 0) {
    logger.debug(
      () => `Converted ${openAITools.length} tools to OpenAI format`,
      {
        toolNames: openAITools.map((t) => t.function.name),
        firstToolHasRequired: Array.isArray(
          openAITools[0].function.parameters.required,
        ),
      },
    );
  }

  return openAITools.length > 0 ? openAITools : undefined;
}
