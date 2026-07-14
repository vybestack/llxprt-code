/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type, type Schema, type Part } from '@google/genai';
import { type Config } from '@vybestack/llxprt-code-core/config/config.js';
import { getCoreSystemPromptAsync } from '@vybestack/llxprt-code-core/core/prompts.js';
import { shouldIncludeSubagentDelegation } from '@vybestack/llxprt-code-core/prompt-config/subagent-delegation.js';
import { isGemini3Model } from '@vybestack/llxprt-code-core/config/models.js';
import { type NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { resolveUserMemory } from '../utils/userMemory.js';
import { convertHistoryToGeminiFormat } from './GeminiMessageConverter.js';
import {
  ensureActiveLoopHasThoughtSignatures,
  stripThoughtsFromHistory,
} from './thoughtSignatures.js';
import {
  cleanGeminiSchema,
  isMissingGeminiSchema,
} from './geminiSchemaHelpers.js';
import {
  type ReasoningConfig,
  mapReasoningEffortToThinkingLevel,
  type StripPolicy,
} from './geminiReasoningConfig.js';

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
  const geminiTools = tools.map((toolGroup) => ({
    functionDeclarations: toolGroup.functionDeclarations.map((decl) => {
      const schema: unknown = decl.parametersJsonSchema;
      if (isMissingGeminiSchema(schema)) {
        throw new Error(
          `Tool "${decl.name}" is missing parametersJsonSchema — legacy schema fallback has been removed. ` +
            `Ensure all tool declarations provide parametersJsonSchema at construction time.`,
        );
      }
      let parameters = cleanGeminiSchema(schema);
      const parametersRecord = parameters as Record<string, unknown>;
      if (!('type' in parametersRecord)) {
        parameters = { type: Type.OBJECT, ...parameters };
      }
      return {
        name: decl.name,
        description: decl.description,
        parameters,
      };
    }),
  }));
  const toolNamesForPrompt = Array.from(
    new Set(
      tools.flatMap((group) =>
        group.functionDeclarations
          .map((decl) => decl.name)
          .filter((name): name is string => Boolean(name)),
      ),
    ),
  );
  return { geminiTools, toolNamesForPrompt };
}

/** Resolve server tools from overrides or config. */
export function resolveServerTools(
  directOverrides: Record<string, unknown> | undefined,
  options: NormalizedGenerateChatOptions,
): string[] {
  let serverToolsOverride: unknown;
  if (directOverrides !== undefined && 'serverTools' in directOverrides) {
    serverToolsOverride = directOverrides.serverTools;
  } else {
    const configServerTools = options.config as
      | { serverTools?: unknown }
      | undefined;
    serverToolsOverride =
      configServerTools !== undefined &&
      'serverTools' in configServerTools &&
      configServerTools.serverTools !== undefined
        ? configServerTools.serverTools
        : undefined;
  }
  return Array.isArray(serverToolsOverride)
    ? serverToolsOverride
    : ['web_search', 'web_fetch'];
}

/** Apply thinking config to request config based on model version and reasoning settings. */
export function applyThinkingConfig(
  requestConfig: Record<string, unknown>,
  reasoningConfig: Pick<ReasoningConfig, 'enabled' | 'effort' | 'maxTokens'>,
  currentModel: string,
): void {
  if (!reasoningConfig.enabled) {
    return;
  }
  // @plan PLAN-20251202-THINKING.P03b @requirement REQ-THINK-006
  if (isGemini3Model(currentModel)) {
    const thinkingLevel = mapReasoningEffortToThinkingLevel(
      reasoningConfig.effort,
    );
    const thinkingConfig: Record<string, unknown> = { includeThoughts: true };
    if (thinkingLevel !== undefined) {
      thinkingConfig.thinkingLevel = thinkingLevel;
    }
    requestConfig.thinkingConfig = thinkingConfig;
  } else {
    requestConfig.thinkingConfig = {
      includeThoughts: true,
      thinkingBudget: reasoningConfig.maxTokens ?? -1,
    };
  }
}

/** Build request config from options, tools, and reasoning settings. */
export function buildRequestConfig(
  options: NormalizedGenerateChatOptions,
  geminiTools: GeminiToolsResult['geminiTools'],
  reasoningConfig: ReasoningConfig,
  currentModel: string,
): Record<string, unknown> {
  const directOverridesRaw = (
    options.metadata as { geminiDirectOverrides?: unknown }
  ).geminiDirectOverrides;
  const directOverrides = isValidRecord(directOverridesRaw)
    ? directOverridesRaw
    : undefined;
  const serverTools = resolveServerTools(directOverrides, options);
  const toolConfigOverride =
    directOverrides !== undefined && 'toolConfig' in directOverrides
      ? directOverrides.toolConfig
      : undefined;

  const modelParams = options.invocation.modelParams;
  const requestConfig: Record<string, unknown> = { ...modelParams };

  const rawMaxOutput = options.settings.get('maxOutputTokens');
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
  requestConfig.serverTools = serverTools;
  if (geminiTools !== undefined) {
    requestConfig.tools = geminiTools;
  }
  if (toolConfigOverride !== undefined) {
    requestConfig.toolConfig = toolConfigOverride;
  }
  applyThinkingConfig(requestConfig, reasoningConfig, currentModel);
  return requestConfig;
}

/** Strip thoughts and apply thought signatures. */
export function prepareContentsWithSignatures(
  contents: Array<{ role: string; parts: Part[] }>,
  stripFromContext: StripPolicy,
): Array<{ role: string; parts: Part[] }> {
  const stripped = stripThoughtsFromHistory(contents, stripFromContext).map(
    (entry) => ({
      role: entry.role,
      parts: entry.parts ?? [],
    }),
  );
  return ensureActiveLoopHasThoughtSignatures(stripped).map((entry) => ({
    role: entry.role,
    parts: entry.parts ?? [],
  }));
}

/** Convert IContent history to Gemini format. */
export function convertToGeminiContents(
  content: NormalizedGenerateChatOptions['contents'],
  currentModel: string,
  configForMessages: unknown,
): Array<{ role: string; parts: Part[] }> {
  return convertHistoryToGeminiFormat(
    content,
    currentModel,
    configForMessages,
  ).map((entry) => ({
    role: entry.role,
    parts: entry.parts,
  }));
}

/**
 * Resolve the subagent config object used for system instruction building.
 */
function resolveSubagentConfig(
  options: NormalizedGenerateChatOptions,
  globalConfig: Config | undefined,
): Config | undefined {
  return options.config ?? options.runtime?.config ?? globalConfig;
}

/**
 * Build the system instruction prompt for a generation request.
 *
 * Accepts the provider's global config explicitly (since it is protected).
 */
export async function buildSystemInstruction(
  options: NormalizedGenerateChatOptions,
  globalConfig: Config | undefined,
  toolNamesForPrompt: string[] | undefined,
  currentModel: string,
): Promise<string> {
  const userMemory = await resolveUserMemory(
    options.userMemory,
    () => options.invocation.userMemory,
  );
  const subagentConfig = resolveSubagentConfig(options, globalConfig);
  const mcpInstructions =
    typeof subagentConfig?.getMcpClientManager === 'function'
      ? subagentConfig.getMcpClientManager()?.getMcpInstructions()
      : undefined;
  const includeSubagentDelegation = await shouldIncludeSubagentDelegation(
    toolNamesForPrompt ?? [],
    () =>
      typeof subagentConfig?.getSubagentManager === 'function'
        ? subagentConfig.getSubagentManager()
        : undefined,
  );
  return getCoreSystemPromptAsync({
    userMemory,
    mcpInstructions,
    model: currentModel,
    tools: toolNamesForPrompt,
    includeSubagentDelegation,
    interactionMode:
      typeof subagentConfig?.isInteractive === 'function' &&
      subagentConfig.isInteractive() === true
        ? 'interactive'
        : 'non-interactive',
  });
}
