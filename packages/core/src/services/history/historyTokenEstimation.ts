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
  ToolCallBlock,
  ToolResponseBlock,
} from './IContent.js';
import type { DebugLogger } from '../../debug/index.js';
import type { RuntimeTokenizer as ITokenizer } from '../../runtime/contracts/RuntimeTokenizer.js';
import { estimateTokens as estimateTextTokens } from '../../utils/toolOutputLimiter.js';

/**
 * Resolve the effective model name, preferring the content's model then the
 * provided default. Empty strings fall back (intentional falsy coalescing).
 */
export function resolveModelName(
  contentModel: string | undefined,
  defaultModel: string | undefined,
): string {
  if (contentModel && contentModel.length > 0) {
    return contentModel;
  }
  if (defaultModel && defaultModel.length > 0) {
    return defaultModel;
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

/** Abstraction over HistoryService's tokenizer lookup. */
export interface TokenizerProvider {
  getTokenizerForModel(modelName: string): ITokenizer;
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
    const blockText = blockToEstimationText(block, logger);
    if (!blockText) {
      continue;
    }
    try {
      const blockTokens = await tokenizer.countTokens(blockText);
      totalTokens += blockTokens;
    } catch (error) {
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
  if (typeof block.result === 'string') {
    return block.result;
  }
  if (block.error) {
    return typeof block.error === 'string'
      ? block.error
      : JSON.stringify(block.error);
  }
  try {
    return JSON.stringify(block.result ?? '');
  } catch (error) {
    logger.debug(
      'Error stringifying tool_response result, using string conversion:',
      error,
    );
    try {
      return String(block.result);
    } catch {
      return `[tool_response: ${block.toolName || 'unknown'} - content too large or complex to stringify]`;
    }
  }
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
    try {
      total += await estimateContentTokens(
        content,
        effectiveModel,
        tokenizerProvider,
        logger,
      );
    } catch (error) {
      logger.debug(
        'Error estimating tokens for content, using fallback:',
        error,
      );
      total += fallbackEstimateForContent(content);
    }
  }

  return total;
}

/** Fallback token estimate when structured estimation fails. */
function fallbackEstimateForContent(content: IContent): number {
  let serialized = '';
  try {
    serialized = JSON.stringify(content);
  } catch {
    // fall through to block-level fallback
  }

  if (serialized) {
    return estimateTextTokens(serialized);
  }

  const blockStrings = content.blocks
    .map(blockToTokenFallbackString)
    .join('\n');
  return blockStrings ? estimateTextTokens(blockStrings) : 0;
}
