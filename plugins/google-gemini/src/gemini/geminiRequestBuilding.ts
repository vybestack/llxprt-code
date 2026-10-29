/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Schema } from './geminiWireTypes.js';
import { SchemaType } from './geminiWireTypes.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { type NormalizedGenerateChatOptions } from '@vybestack/llxprt-code-providers/BaseProvider.js';
import {
  cleanGeminiSchema,
  isMissingGeminiSchema,
} from './geminiSchemaHelpers.js';
import { type ReasoningConfig } from './geminiReasoningConfig.js';
import { applyGeminiReasoningTranslation } from './geminiReasoningTranslation.js';

export interface GeminiToolsResult {
  geminiTools:
    | Array<{
        functionDeclarations: Array<{
          name: string;
          description?: string;
          parameters: Schema;
        }>;
      }>
    | undefined;
  toolNamesForPrompt: string[] | undefined;
}

function isValidRecord(value: unknown): value is Record<string, unknown> {
  return value !== undefined && value !== null && typeof value === 'object';
}

/** Build Gemini-compatible tool declarations and extract tool names. */
export function buildGeminiTools(
  tools: NormalizedGenerateChatOptions['tools'],
): GeminiToolsResult {
  if (tools === undefined) {
    return { geminiTools: undefined, toolNamesForPrompt: undefined };
  }
  const geminiTools =
    tools.length === 0
      ? []
      : [
          {
            functionDeclarations: tools.map((decl) => {
              const schema: unknown = decl.parametersJsonSchema;
              if (isMissingGeminiSchema(schema)) {
                throw new Error(
                  `Tool "${decl.name}" is missing parametersJsonSchema — legacy schema fallback has been removed. ` +
                    `Ensure all tool declarations provide parametersJsonSchema at construction time.`,
                );
              }
              let parameters = cleanGeminiSchema(schema);
              const parametersRecord = parameters as Record<string, unknown>;
              if (
                !('type' in parametersRecord) &&
                !('anyOf' in parametersRecord)
              ) {
                parameters = { type: SchemaType.OBJECT, ...parameters };
              }
              return {
                name: decl.name,
                description: decl.description,
                parameters,
              };
            }),
          },
        ];
  const toolNamesForPrompt = Array.from(
    new Set(
      tools
        .map((decl) => decl.name)
        .filter((name): name is string => Boolean(name)),
    ),
  );
  return { geminiTools, toolNamesForPrompt };
}

/** Build request config from options, tools, and reasoning settings. */
export function buildRequestConfig(
  options: NormalizedGenerateChatOptions,
  geminiTools: GeminiToolsResult['geminiTools'],
  reasoningConfig: ReasoningConfig,
  currentModel: string,
  logger: DebugLogger,
): Record<string, unknown> {
  const directOverridesRaw = (
    options.metadata as { geminiDirectOverrides?: unknown }
  ).geminiDirectOverrides;
  const directOverrides = isValidRecord(directOverridesRaw)
    ? directOverridesRaw
    : undefined;
  const toolConfigOverride =
    directOverrides !== undefined && 'toolConfig' in directOverrides
      ? directOverrides.toolConfig
      : undefined;

  const modelParams = options.invocation.modelParams;
  const requestConfig: Record<string, unknown> = { ...modelParams };

  const rawMaxOutput = options.invocation.getEphemeral('maxOutputTokens');
  const genericMaxOutput =
    typeof rawMaxOutput === 'number' &&
    Number.isFinite(rawMaxOutput) &&
    rawMaxOutput > 0
      ? rawMaxOutput
      : undefined;
  if (
    genericMaxOutput !== undefined &&
    requestConfig['maxOutputTokens'] === undefined
  ) {
    requestConfig['maxOutputTokens'] = genericMaxOutput;
  }
  if (geminiTools !== undefined) {
    requestConfig.tools = geminiTools;
  }
  if (toolConfigOverride !== undefined) {
    requestConfig.toolConfig = toolConfigOverride;
  }
  applyGeminiReasoningTranslation({
    requestConfig,
    reasoningConfig,
    model: currentModel,
    logger,
  });
  return requestConfig;
}
