/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Schema converter for the OpenAI Vercel provider.
 *
 * The conversion logic lives in the shared
 * `packages/providers/src/openai-shared/schemaConverter.ts` module so that the
 * classic and Vercel providers cannot drift apart. This file is a thin
 * provider-specific wrapper that narrows the shared types to the Vercel AI SDK
 * tool shape (description and parameters are optional) and preserves the
 * Vercel debug-logging namespace.
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

const logger = new DebugLogger('llxprt:provider:openai-vercel:schema');

/**
 * OpenAI tool format for function calling (Vercel AI SDK compatible). The
 * Vercel AI SDK treats description and parameters as optional.
 */
export interface OpenAIVercelTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: OpenAIFunctionParameters;
  };
}

/**
 * Convert an array of Gemini-style tool declarations to OpenAI Vercel format.
 * Delegates to the shared converter with the preserve description strategy
 * (missing descriptions stay undefined).
 */
export function convertToolsToOpenAIVercel(
  toolDeclarations?: Array<{
    functionDeclarations?: Array<{
      name: string;
      description?: string;
      parametersJsonSchema?: unknown;
    }>;
  }>,
): OpenAIVercelTool[] | undefined {
  const converted = convertToolDeclarations(toolDeclarations, {
    descriptionStrategy: 'preserve',
  });

  if (converted === undefined) {
    return undefined;
  }

  const openAITools: OpenAIVercelTool[] = converted.map((tool) => ({
    type: 'function',
    function: {
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    },
  }));

  if (logger.enabled && openAITools.length > 0) {
    logger.debug(
      () => `Converted ${openAITools.length} tools to OpenAI Vercel format`,
      {
        toolNames: openAITools.map((t) => t.function.name),
        firstToolHasRequired:
          openAITools[0]?.function.parameters?.required !== undefined,
      },
    );
  }

  return openAITools.length > 0 ? openAITools : undefined;
}
