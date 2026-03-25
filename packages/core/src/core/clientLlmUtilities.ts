/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  GenerateContentConfig,
  Content,
  GenerateContentResponse,
} from '@google/genai';
import { getCoreSystemPromptAsync } from './prompts.js';
import {
  getEnabledToolNamesForPrompt,
  shouldIncludeSubagentDelegationForConfig,
} from './clientToolGovernance.js';
import { reportError } from '../utils/errorReporting.js';
import { retryWithBackoff } from '../utils/retry.js';
import { getErrorMessage } from '../utils/errors.js';
import type { ContentGenerator } from './contentGenerator.js';
import type { Config } from '../config/config.js';
import type { BaseLLMClient } from './baseLlmClient.js';
import { DebugLogger } from '../debug/index.js';

async function buildLightweightSystemPrompt(
  config: Config,
  model: string,
): Promise<string> {
  const userMemory = config.getUserMemory();
  const mcpInstructions = config.getMcpClientManager()?.getMcpInstructions();
  const enabledToolNames = getEnabledToolNamesForPrompt(config);
  const includeSubagentDelegation =
    await shouldIncludeSubagentDelegationForConfig(config, enabledToolNames);
  return getCoreSystemPromptAsync({
    userMemory,
    mcpInstructions,
    model,
    includeSubagentDelegation,
    tools: enabledToolNames,
    interactionMode: config.isInteractive() ? 'interactive' : 'non-interactive',
  });
}

/**
 * Generates structured JSON using the BaseLLMClient utility path.
 *
 * Uses getCoreSystemPromptAsync directly — the lightweight path that includes
 * userMemory and mcpInstructions but NOT environment context, core memory, or
 * JIT memory (those are only in buildSystemInstruction used by startChat).
 */
export async function generateJson(
  config: Config,
  _contentGenerator: ContentGenerator,
  baseLlmClient: BaseLLMClient,
  contents: Content[],
  schema: Record<string, unknown>,
  abortSignal: AbortSignal,
  model: string,
  generationConfig: GenerateContentConfig = {},
  lastPromptId: string,
): Promise<Record<string, unknown>> {
  const logger = new DebugLogger('llxprt:core:clientLlmUtilities');

  try {
    const systemInstruction = await buildLightweightSystemPrompt(config, model);

    const prompt = contents
      .map(
        (c) =>
          c.parts
            ?.map((p) => ('text' in p ? (p.text ?? '') : ''))
            .filter((s) => s.length > 0)
            .join('\n') ?? '',
      )
      .filter((s) => s.length > 0)
      .join('\n\n');

    const apiCall = async () =>
      baseLlmClient.generateJson({
        prompt,
        schema,
        model,
        systemInstruction,
        temperature: generationConfig.temperature ?? 0,
        promptId: lastPromptId,
      });

    const result = await retryWithBackoff(apiCall);

    if (
      typeof result === 'string' &&
      (result === 'user' || result === 'model') &&
      contents.some(
        (c) =>
          c.parts?.some(
            (p) => 'text' in p && (p.text?.includes('next_speaker') ?? false),
          ) ?? false,
      )
    ) {
      logger.warn(
        () =>
          `[generateJson] Gemini returned plain text "${result}" instead of JSON for next speaker check. Converting to valid response.`,
      );
      return {
        reasoning: 'Gemini returned plain text response',
        next_speaker: result,
      };
    }

    return result as Record<string, unknown>;
  } catch (error) {
    if (abortSignal.aborted) {
      throw error;
    }

    await reportError(
      error,
      'Error generating JSON content via API.',
      contents,
      'generateJson-api',
    );
    throw error;
  }
}

/**
 * Generates content using ContentGenerator directly.
 *
 * Uses getCoreSystemPromptAsync directly — the lightweight path that includes
 * userMemory and mcpInstructions but NOT environment context, core memory, or
 * JIT memory (those are only in buildSystemInstruction used by startChat).
 */
export async function generateContent(
  config: Config,
  contentGenerator: ContentGenerator,
  contents: Content[],
  generationConfig: GenerateContentConfig,
  abortSignal: AbortSignal,
  model: string,
  lastPromptId: string,
  baseGenerateContentConfig: GenerateContentConfig,
): Promise<GenerateContentResponse> {
  const configToUse: GenerateContentConfig = {
    ...baseGenerateContentConfig,
    ...generationConfig,
  };

  try {
    const systemInstruction = await buildLightweightSystemPrompt(config, model);

    const requestConfig = {
      abortSignal,
      ...configToUse,
      systemInstruction,
    };

    const apiCall = () =>
      contentGenerator.generateContent(
        {
          model,
          contents,
          config: requestConfig,
        },
        lastPromptId,
      );

    return await retryWithBackoff(apiCall);
  } catch (error: unknown) {
    if (abortSignal.aborted) {
      throw error;
    }

    await reportError(
      error,
      `Error generating content via API with model ${model}.`,
      {
        requestContents: contents,
        requestConfig: configToUse,
      },
      'generateContent-api',
    );
    throw new Error(
      `Failed to generate content with model ${model}: ${getErrorMessage(error)}`,
    );
  }
}

/**
 * Generates embeddings for an array of text strings.
 * Returns an empty array for empty input without making any API call.
 */
export async function generateEmbedding(
  baseLlmClient: BaseLLMClient,
  texts: string[],
  embeddingModel: string,
): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const result = await baseLlmClient.generateEmbedding({
    text: texts,
    model: embeddingModel,
  });

  return result as number[][];
}
