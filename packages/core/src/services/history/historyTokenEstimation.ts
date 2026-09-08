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

import type {
  ContentBlock,
  IContent,
  MediaBlock,
  ToolCallBlock,
  ToolResponseBlock,
} from './IContent.js';
import type { DebugLogger } from '../../debug/index.js';
import type { RuntimeTokenizer as ITokenizer } from '../../runtime/contracts/RuntimeTokenizer.js';
import { parseImageDimensionsFromBase64 } from '@vybestack/llxprt-code-tools/utils/imageDimensions.js';
import { estimateImageTokens } from '@vybestack/llxprt-code-tools/utils/imageTokenEstimation.js';

/**
 * Resolve the effective model name. An active target model always wins over
 * historical origin metadata during current-request recomputation.
 */
export function resolveModelName(
  contentModel: string | undefined,
  defaultModel: string | undefined,
): string {
  if (defaultModel && defaultModel.length > 0) {
    return defaultModel;
  }
  if (contentModel && contentModel.length > 0) {
    return contentModel;
  }
  return 'gpt-4.1';
}

/** Simple token estimation for text. */
export function simpleTokenEstimateForText(text: string): number {
  if (!text) return 0;
  const wordCount = text.split(/\s+/).length;
  const characterCount = text.length;
  return Math.round(Math.max(wordCount * 1.3, characterCount / 4));
}

/** Stringify a value for token fallback, returning fallback if serialization fails. */
function safeJsonStringify(value: unknown, fallback: string): string {
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

/** Convert a content block to a string for fallback token estimation. */
export function blockToTokenFallbackString(block: ContentBlock): string {
  switch (block.type) {
    case 'text':
      return block.text;
    case 'tool_call':
      return safeJsonStringify(
        {
          name: block.name,
          parameters: block.parameters,
        },
        `tool_call: ${block.name}`,
      );
    case 'tool_response':
      return safeJsonStringify(
        {
          callId: block.callId,
          toolName: block.toolName,
          result: block.result,
          error: block.error,
        },
        `tool_response: ${block.toolName || 'unknown'}`,
      );
    case 'thinking':
      return block.thought;
    case 'code':
      return block.code;
    case 'media':
      return block.caption ?? '';
    default:
      return '';
  }
}

/**
 * Serialize only the parts of an IContent that can reach a provider.
 *
 * `metadata` is deliberately excluded: no provider converter serializes it into
 * a wire payload, so counting it inflates context estimates and makes
 * compression fire early. This matters most for the client-side chronology
 * marker (#1721), which is stamped on every history item.
 */
export function serializeWireContentForEstimate(content: IContent): string {
  return JSON.stringify({ speaker: content.speaker, blocks: content.blocks });
}

/** Abstraction over HistoryService's tokenizer lookup. */
export interface TokenizerProvider {
  getTokenizerForModel(modelName: string): ITokenizer;
  /**
   * The active provider name (e.g. 'anthropic', 'openai', 'gemini'), used to
   * pick the correct image token estimation family. Optional for callers that
   * have no provider context (defaults to the 'default' family).
   */
  readonly activeProvider?: string;
}

/**
 * Estimate the image token cost of a base64/URL media block for the given
 * provider family. This is independent of the text tokenizer and cannot throw,
 * so it is added outside the tokenizer try/catch in {@link estimateContentTokens}.
 */
function estimateMediaBlockImageTokens(
  block: MediaBlock,
  provider: string | undefined,
  model: string | undefined,
): number {
  if (!block.mimeType.toLowerCase().startsWith('image/')) return 0;
  let dimensions: MediaBlock['dimensions'];
  if (block.encoding === 'reference') {
    dimensions = block.dimensions;
  } else if (block.encoding === 'base64') {
    dimensions = parseImageDimensionsFromBase64(block.data) ?? block.dimensions;
  }
  return estimateImageTokens({ provider, dimensions, model });
}

/**
 * Estimate token count for a single content entry using the provided tokenizer.
 */
export async function estimateContentTokens(
  content: IContent,
  modelName: string,
  tokenizerProvider: TokenizerProvider,
  logger: DebugLogger,
): Promise<number> {
  const tokenizer = tokenizerProvider.getTokenizerForModel(modelName);
  let totalTokens = 0;

  for (const block of content.blocks) {
    if (block.type === 'media') {
      totalTokens += estimateMediaBlockImageTokens(
        block,
        tokenizerProvider.activeProvider,
        modelName,
      );
    }
    const blockText = blockToEstimationText(block, logger);
    if (!blockText) {
      continue;
    }
    try {
      const blockTokens = await tokenizer.countTokens(blockText);
      totalTokens += blockTokens;
    } catch (error) {
      if (tokenizer.fallbackPolicy === 'deny') {
        throw error;
      }
      logger.debug('Error counting tokens for block, using fallback:', error);
      totalTokens += simpleTokenEstimateForText(blockText);
    }
  }

  return totalTokens;
}

/** Convert a block to a text string suitable for token estimation. */
function blockToEstimationText(
  block: ContentBlock,
  logger: DebugLogger,
): string {
  switch (block.type) {
    case 'text':
      return block.text;
    case 'tool_call':
      return stringifyToolCallForTokens(block, logger);
    case 'tool_response':
      return stringifyToolResponseForTokens(block, logger);
    case 'thinking':
      return block.thought;
    case 'code':
      return block.code;
    case 'media':
      return block.caption ?? '';
    default:
      return '';
  }
}

/** Stringify a tool_call for token estimation. */
function stringifyToolCallForTokens(
  block: ToolCallBlock,
  logger: DebugLogger,
): string {
  try {
    return JSON.stringify({
      name: block.name,
      parameters: block.parameters,
    });
  } catch (error) {
    logger.debug(
      'Error stringifying tool_call parameters, using fallback:',
      error,
    );
    return `tool_call: ${block.name}`;
  }
}

/** Stringify a tool_response for token estimation. */
function stringifyToolResponseForTokens(
  block: ToolResponseBlock,
  logger: DebugLogger,
): string {
  // The top-level `error` marker and the `result` payload are independent
  // channels that both travel to the provider. A failed block carries the
  // terse marker in `error` AND the model-facing remedy in `result`, so the
  // estimate must account for both rather than treating them as alternatives
  // (issue #3063).
  const parts: string[] = [];
  if (block.error) {
    parts.push(
      typeof block.error === 'string'
        ? block.error
        : JSON.stringify(block.error),
    );
  }
  if (typeof block.result === 'string') {
    parts.push(block.result);
  } else if (block.result !== undefined) {
    try {
      parts.push(JSON.stringify(block.result));
    } catch (error) {
      logger.debug(
        'Error stringifying tool_response result, using string conversion:',
        error,
      );
      try {
        parts.push(String(block.result));
      } catch {
        parts.push(
          `[tool_response: ${block.toolName || 'unknown'} - content too large or complex to stringify]`,
        );
      }
    }
  }
  return parts.join('\n');
}

/**
 * Estimate total tokens for hypothetical contents without mutating history.
 */
export async function estimateTokensForContents(
  contents: IContent[],
  modelName: string | undefined,
  tokenizerProvider: TokenizerProvider,
  logger: DebugLogger,
): Promise<number> {
  if (contents.length === 0) {
    return 0;
  }

  let total = 0;
  for (const content of contents) {
    const effectiveModel = resolveModelName(content.metadata?.model, modelName);
    total += await estimateContentTokens(
      content,
      effectiveModel,
      tokenizerProvider,
      logger,
    );
  }

  return total;
}
