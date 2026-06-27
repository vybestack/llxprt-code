/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Token estimator for load-balancer request accounting (issue #2207).
 * Uses the active subprofile's tokenizer via the RuntimeTokenizerFactory
 * when available, falling back to generic text/character estimates.
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  estimateTokensForContents,
  type TokenizerProvider,
} from '@vybestack/llxprt-code-core/services/history/historyTokenEstimation.js';
import type { RuntimeTokenizer as ITokenizer } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizer.js';
import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import { estimateTokens as estimateTextTokens } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';

const logger = new DebugLogger('llxprt:providers:load-balancer:estimator');
/**
 * Last-resort character estimate for non-text blocks when tokenizer, generic,
 * and JSON fallbacks all fail. At three characters per token this keeps media
 * fallback cost near a conservative 100-token floor.
 */
const NON_TEXT_BLOCK_CHAR_ESTIMATE = 300;
/** Rough conservative fallback for English-ish text when tokenizers are unavailable. */
const CHARS_PER_TOKEN_FALLBACK = 3;
/** Base64 media is billed as media input, not raw encoded text, so downscale. */
const BASE64_MEDIA_CHAR_DIVISOR = 4;
const MEDIA_DATA_CHAR_CAP = 10_000;
const CIRCULAR_REFERENCE_CHAR_ESTIMATE = 64;
const MAX_UNSERIALIZABLE_ESTIMATE_DEPTH = 8;

export interface EstimationResult {
  tokens: number;
  source: string;
}

export interface LoadBalancerEstimatorDeps {
  tokenizerFactory?: RuntimeTokenizerFactory | undefined;
}

class GenericTokenizerProvider implements TokenizerProvider {
  getTokenizerForModel(_modelName: string): ITokenizer {
    return {
      countTokens: (text: unknown) =>
        Promise.resolve(estimateTextTokens(String(text ?? ''))),
    };
  }
}

const genericTokenizerProvider = new GenericTokenizerProvider();

function createTokenizerAdapter(
  runtimeTokenizer: ITokenizer,
): TokenizerProvider {
  return {
    getTokenizerForModel: () => runtimeTokenizer,
  };
}

export async function estimateRequestTokens(
  contents: IContent[],
  providerName: string,
  modelName: string,
  deps: LoadBalancerEstimatorDeps,
): Promise<EstimationResult> {
  if (contents.length === 0) {
    return { tokens: 0, source: 'empty contents' };
  }

  let tokenizerFailureModel: string | null = null;
  let tokenizer: ITokenizer | undefined;
  try {
    tokenizer = deps.tokenizerFactory?.getTokenizer(providerName, modelName);
  } catch (error) {
    tokenizerFailureModel = modelName;
    logger.debug(
      () =>
        `Tokenizer retrieval failed, using generic fallback: ${String(error)}`,
    );
  }

  if (tokenizer) {
    try {
      return await estimateWithTokenizer(contents, modelName, tokenizer);
    } catch (error) {
      tokenizerFailureModel = modelName;
      logger.debug(
        () =>
          `Tokenizer estimation failed, using generic fallback: ${String(error)}`,
      );
    }
  }

  const result = await estimateWithGeneric(contents);
  return tokenizerFailureModel === null
    ? result
    : {
        ...result,
        source: `${result.source} (tokenizer failed: ${tokenizerFailureModel})`,
      };
}

async function estimateWithTokenizer(
  contents: IContent[],
  modelName: string,
  tokenizer: ITokenizer,
): Promise<EstimationResult> {
  const tokenizerProvider = createTokenizerAdapter(tokenizer);
  const tokens = await estimateTokensForContents(
    contents,
    modelName,
    tokenizerProvider,
    logger,
  );
  return {
    tokens: applyNonEmptyTokenFloor(contents, tokens),
    source: `${modelName} (tokenizer)`,
  };
}

function applyNonEmptyTokenFloor(contents: IContent[], tokens: number): number {
  if (contents.length === 0) {
    return 0;
  }
  return Number.isFinite(tokens) && tokens > 0 ? tokens : 1;
}

function estimateSerializedBlockCharacters(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    return serialized.length > 0
      ? serialized.length
      : NON_TEXT_BLOCK_CHAR_ESTIMATE;
  } catch {
    return Math.max(
      estimateUnserializableCharacters(value),
      NON_TEXT_BLOCK_CHAR_ESTIMATE,
    );
  }
}

function estimateUnserializableCharacters(
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
): number {
  if (value === null || value === undefined) {
    return 4;
  }
  if (typeof value === 'string') {
    return value.length;
  }
  if (typeof value === 'bigint') {
    return value.toString().length;
  }
  if (typeof value !== 'object') {
    return String(value).length;
  }
  if (seen.has(value)) {
    return CIRCULAR_REFERENCE_CHAR_ESTIMATE;
  }
  if (depth >= MAX_UNSERIALIZABLE_ESTIMATE_DEPTH) {
    return NON_TEXT_BLOCK_CHAR_ESTIMATE;
  }

  seen.add(value);
  if (Array.isArray(value)) {
    return value.reduce(
      (total, entry) =>
        total + estimateUnserializableCharacters(entry, seen, depth + 1),
      2,
    );
  }

  let total = 2;
  for (const key of Reflect.ownKeys(value)) {
    total += String(key).length;
    total += estimateUnserializableCharacters(
      (value as Record<PropertyKey, unknown>)[key],
      seen,
      depth + 1,
    );
  }
  return total;
}

function stringLength(value: unknown): number {
  return typeof value === 'string' ? value.length : 0;
}

function estimateMediaCharacters(
  block: Extract<IContent['blocks'][number], { type: 'media' }>,
): number {
  const captionLength = stringLength(block.caption);
  const rawDataLength = stringLength(block.data);
  const dataLength =
    block.encoding === 'base64'
      ? Math.min(
          Math.ceil(rawDataLength / BASE64_MEDIA_CHAR_DIVISOR),
          MEDIA_DATA_CHAR_CAP,
        )
      : Math.min(rawDataLength, MEDIA_DATA_CHAR_CAP);
  return captionLength + Math.max(dataLength, 1);
}

function sanitizeMediaForJsonFallback(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate['type'] !== 'media' ||
    candidate['encoding'] !== 'base64' ||
    typeof candidate['data'] !== 'string'
  ) {
    return value;
  }
  return {
    ...candidate,
    data: `[base64 media: ${Math.ceil(candidate['data'].length / BASE64_MEDIA_CHAR_DIVISOR)} chars equiv]`,
  };
}

function estimateBlockCharacters(block: IContent['blocks'][number]): number {
  switch (block.type) {
    case 'text':
      return stringLength(block.text);
    case 'thinking':
      return stringLength(block.thought);
    case 'code':
      return stringLength(block.code);
    case 'tool_call':
      return estimateSerializedBlockCharacters({
        id: block.id,
        name: block.name,
        parameters: block.parameters,
        description: block.description,
      });
    case 'tool_response':
      return estimateSerializedBlockCharacters({
        callId: block.callId,
        toolName: block.toolName,
        result: block.result,
        error: block.error,
      });
    case 'media':
      return estimateMediaCharacters(block);
    default: {
      const exhaustive: never = block;
      return estimateUnsupportedBlockCharacters(
        exhaustive as IContent['blocks'][number],
      );
    }
  }
}

function estimateUnsupportedBlockCharacters(
  block: IContent['blocks'][number],
): number {
  logger.warn(
    () =>
      `Unexpected block type encountered in token estimation: ${String(block.type)}`,
  );
  return NON_TEXT_BLOCK_CHAR_ESTIMATE;
}

function estimateFallbackBlockCharacters(
  block: IContent['blocks'][number],
): number {
  try {
    return Math.max(estimateBlockCharacters(block), 1);
  } catch {
    return NON_TEXT_BLOCK_CHAR_ESTIMATE;
  }
}

function estimateRawContentTokens(contents: IContent[]): number {
  const characterCount = contents.reduce(
    (total, content) =>
      total +
      content.blocks.reduce(
        (sum, block) => sum + estimateFallbackBlockCharacters(block),
        0,
      ),
    0,
  );
  const tokenEstimate = Math.ceil(characterCount / CHARS_PER_TOKEN_FALLBACK);
  return Number.isFinite(tokenEstimate) ? Math.max(1, tokenEstimate) : 1;
}

async function estimateWithGeneric(
  contents: IContent[],
): Promise<EstimationResult> {
  try {
    const tokens = await estimateTokensForContents(
      contents,
      undefined,
      genericTokenizerProvider,
      logger,
    );
    return {
      tokens: applyNonEmptyTokenFloor(contents, tokens),
      source: 'generic (tiktoken/char fallback)',
    };
  } catch (error) {
    logger.debug(
      () =>
        `Generic token estimation failed, using JSON fallback: ${String(error)}`,
    );
    try {
      const serializedContents = JSON.stringify(
        contents,
        (_key, value: unknown) => sanitizeMediaForJsonFallback(value),
      );
      return {
        tokens: applyNonEmptyTokenFloor(
          contents,
          estimateTextTokens(serializedContents),
        ),
        source: 'generic (json fallback)',
      };
    } catch (fallbackError) {
      logger.debug(
        () =>
          `JSON token estimation failed, using conservative character fallback: ${String(fallbackError)}`,
      );
      return {
        tokens: applyNonEmptyTokenFloor(
          contents,
          estimateRawContentTokens(contents),
        ),
        source: 'generic (char fallback)',
      };
    }
  }
}
