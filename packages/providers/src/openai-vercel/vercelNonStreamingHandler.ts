/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { generateText } from 'ai';
import type { LanguageModel, LanguageModelUsage, ModelMessage, Tool } from 'ai';

import { type IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { type TextBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { sanitizeProviderText } from '../utils/textSanitizer.js';
import { wrapError } from './errors.js';

import type {
  ModelCallParams,
  ReasoningSettings,
} from './vercelStreamTypes.js';
import type { OpenAIVercelTool } from './schemaConverter.js';
import {
  buildNonStreamingToolCallBlocks,
  buildThinkingBlock,
  extractNonStreamingThinking,
} from './vercelNonStreamingResponse.js';
import { mapUsageToMetadata } from './vercelMetadataMapper.js';
import { getAiTool } from './vercelModelClient.js';

type VercelTools = Record<string, Tool<unknown, never>>;

/**
 * Invokes AI SDK generateText with the given options, wrapping errors.
 */
export async function invokeGenerateText(
  model: LanguageModel,
  systemPrompt: string,
  messages: ModelMessage[],
  aiTools: VercelTools | undefined,
  params: ModelCallParams,
  abortSignal: AbortSignal | undefined,
  formattedTools: OpenAIVercelTool[] | undefined,
  logger: DebugLogger,
  providerName: string,
): Promise<Awaited<ReturnType<typeof generateText>>> {
  const aiToolFn = getAiTool();
  const toolsForGenerate =
    (!aiToolFn && formattedTools ? formattedTools : aiTools) ?? undefined;
  const generateOptions: Record<string, unknown> = {
    model,
    system: systemPrompt,
    messages,
    tools: toolsForGenerate,
    maxOutputTokens: params.maxOutputTokens,
    temperature: params.temperature,
    topP: params.topP,
    presencePenalty: params.presencePenalty,
    frequencyPenalty: params.frequencyPenalty,
    stopSequences: params.stopSequences,
    seed: params.seed,
    maxRetries: params.maxRetries,
    abortSignal,
  };
  if (params.maxOutputTokens !== undefined) {
    generateOptions['maxTokens'] = params.maxOutputTokens;
  }
  try {
    return await generateText(
      generateOptions as Parameters<typeof generateText>[0],
    );
  } catch (error) {
    logger.error(
      () =>
        `[OpenAIVercelProvider] Non-streaming chat completion failed: ${error instanceof Error ? error.message : String(error)}`,
      { error },
    );
    throw wrapError(error, providerName);
  }
}

/**
 * Orchestrates a non-streaming response from generateText, extracting
 * thinking, text, and tool call blocks.
 */
export async function* handleNonStreamingResponse(
  result: Awaited<ReturnType<typeof generateText>>,
  rs: ReasoningSettings,
  logger: DebugLogger,
): AsyncIterableIterator<IContent> {
  const blocks: Array<
    | TextBlock
    | ReturnType<typeof buildNonStreamingToolCallBlocks>[number]
    | NonNullable<ReturnType<typeof buildThinkingBlock>>
  > = [];
  const thinkingContent = extractNonStreamingThinking(result, rs, logger);
  const thinkingBlock = buildThinkingBlock(thinkingContent, rs, logger);
  if (thinkingBlock) {
    blocks.push(thinkingBlock);
  }
  if (result.text) {
    const sanitizedText = sanitizeProviderText(result.text, logger);
    if (sanitizedText) {
      blocks.push({ type: 'text', text: sanitizedText } as TextBlock);
    }
  }
  blocks.push(...buildNonStreamingToolCallBlocks(result));
  const usageMeta = mapUsageToMetadata(
    result.usage as LanguageModelUsage | undefined,
  );
  if (blocks.length > 0 || usageMeta != null) {
    yield {
      speaker: 'ai',
      blocks,
      ...(usageMeta != null ? { metadata: { usage: usageMeta } } : {}),
    } as IContent;
  }
}
