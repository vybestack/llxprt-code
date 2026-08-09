/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getCoreSystemPromptAsync,
  loadCoreMemoryContent,
} from '@vybestack/llxprt-code-core/core/prompts.js';
import process from 'node:process';
import {
  getEnabledToolNamesForPrompt,
  shouldIncludeSubagentDelegationForConfig,
} from './clientToolGovernance.js';
import { resolveProviderForSystemPrompt } from './systemPromptProvider.js';
import { reportError } from '@vybestack/llxprt-code-core/utils/errorReporting.js';
import { retryWithBackoff } from '@vybestack/llxprt-code-core/utils/retry.js';
import { getErrorMessage } from '@vybestack/llxprt-code-core/utils/errors.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type {
  ModelGenerationSettings,
  ModelOutput,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { BaseLLMClient } from './baseLlmClient.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';

/**
 * Config-scoped async snapshot for the on-disk core-memory content loaded
 * when `config.getCoreMemory()` returns `undefined` (JIT context disabled).
 *
 * The exact `loadCoreMemoryContent(process.cwd())` result — including the
 * empty string — is cached per Config so the two-file `.LLXPRT_SYSTEM` disk
 * read happens at most once per Config lifetime, not once per auxiliary LLM
 * call (issue #3176, finding D7). This mirrors the disk-load fallback in
 * `resolveEffectiveMemories` but makes it a snapshot rather than a per-call
 * re-read.
 */
const coreMemorySnapshotCache = new WeakMap<Config, Promise<string>>();

/**
 * Resolves a defined `coreMemory` value for the auxiliary prompt path.
 * Prefers `config.getCoreMemory()` (in-memory when JIT is enabled); falls
 * back to a cached disk snapshot otherwise so `getCoreSystemPromptAsync`
 * never performs a per-call `.LLXPRT_SYSTEM` load.
 */
async function resolveAuxiliaryCoreMemory(config: Config): Promise<string> {
  const explicit = config.getCoreMemory();
  if (explicit !== undefined) {
    return explicit;
  }
  let snapshot = coreMemorySnapshotCache.get(config);
  if (snapshot === undefined) {
    snapshot = loadCoreMemoryContent(process.cwd());
    coreMemorySnapshotCache.set(config, snapshot);
  }
  return snapshot;
}

async function buildLightweightSystemPrompt(
  config: Config,
  model: string,
  provider: string | undefined,
): Promise<string> {
  const userMemory = config.getUserMemory();
  const coreMemory = await resolveAuxiliaryCoreMemory(config);
  const mcpInstructions = config.getMcpInstructions();
  const enabledToolNames = getEnabledToolNamesForPrompt(config);
  const includeSubagentDelegation =
    await shouldIncludeSubagentDelegationForConfig(config, enabledToolNames);
  return getCoreSystemPromptAsync({
    userMemory,
    coreMemory,
    mcpInstructions,
    model,
    provider: provider ?? resolveProviderForSystemPrompt(config),
    includeSubagentDelegation,
    tools: enabledToolNames,
    interactionMode: config.isInteractive() ? 'interactive' : 'non-interactive',
  });
}

/**
 * Generates structured JSON using the BaseLLMClient utility path.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P15
 * @requirement:REQ-005.2
 */
export async function generateJson(
  config: Config,
  _contentGenerator: ContentGenerator,
  baseLlmClient: BaseLLMClient,
  contents: IContent[],
  schema: Record<string, unknown>,
  abortSignal: AbortSignal,
  model: string,
  generationConfig: ModelGenerationSettings = {},
  lastPromptId: string,
  provider?: string,
): Promise<Record<string, unknown>> {
  const logger = new DebugLogger('llxprt:core:clientLlmUtilities');

  try {
    const systemInstruction = await buildLightweightSystemPrompt(
      config,
      model,
      provider,
    );

    // Already neutral IContent[] — read TextBlock.text directly (no Google Part access).
    const iContents = contents;

    const prompt = iContents
      .map((ic) =>
        ic.blocks
          .filter((b) => b.type === 'text')
          .map((b) => (b as { text: string }).text)
          .filter((s) => s.length > 0)
          .join('\n'),
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

    const result = await retryWithBackoff(apiCall, { signal: abortSignal });

    if (
      typeof result === 'string' &&
      (result === 'user' || result === 'model') &&
      iContents.some((ic) =>
        ic.blocks.some(
          (b) =>
            b.type === 'text' &&
            (b as { text: string }).text.includes('next_speaker'),
        ),
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
 * Returns a neutral ModelOutput; callers that need Google shapes should convert
 * at their boundary (migration in issue #2349).
 */
export async function generateContent(
  config: Config,
  contentGenerator: ContentGenerator,
  contents: IContent[],
  generationConfig: ModelGenerationSettings,
  abortSignal: AbortSignal,
  model: string,
  lastPromptId: string,
  baseGenerateContentConfig: ModelGenerationSettings,
  provider?: string,
): Promise<ModelOutput> {
  const configToUse: ModelGenerationSettings = {
    ...baseGenerateContentConfig,
    ...generationConfig,
  };

  try {
    const systemInstruction = await buildLightweightSystemPrompt(
      config,
      model,
      provider,
    );

    const icontents = contents;

    const settings = {
      temperature: configToUse.temperature,
      topP: configToUse.topP,
      maxOutputTokens: configToUse.maxOutputTokens,
      systemInstruction:
        typeof systemInstruction === 'string' ? systemInstruction : undefined,
    };

    const request = {
      model,
      contents: icontents,
      settings,
      abortSignal,
    };

    const apiCall = () =>
      contentGenerator.generateContent(request, lastPromptId);

    return await retryWithBackoff(apiCall, { signal: abortSignal });
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
