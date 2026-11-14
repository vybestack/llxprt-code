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
const MAX_UNSERIALIZABLE_CHILDREN = 1_000;

export interface EstimationResult {
  tokens: number;
  source: string;
  transportToken?: object;
}

export interface LoadBalancerEstimatorDeps {
  tokenizerFactory?: RuntimeTokenizerFactory | undefined;
}

class GenericTokenizerProvider implements TokenizerProvider {
  constructor(readonly activeProvider: string | undefined) {}

  getTokenizerForModel(_modelName: string): ITokenizer {
    return {
      countTokens: (text: unknown) =>
        Promise.resolve(estimateTextTokens(String(text ?? ''))),
    };
  }
}

function createTokenizerAdapter(
  runtimeTokenizer: ITokenizer,
  activeProvider: string,
): TokenizerProvider {
  return {
    getTokenizerForModel: () => runtimeTokenizer,
    activeProvider,
  };
}

/**
 * A repeatable ordered row source. `open()` yields a fresh pass over the same
 * rows, so a tokenizer pass and a generic fallback pass never share a reader.
 * `array` is present only for the legacy array route, which keeps its
 * serialized-JSON and character fallbacks.
 */
export interface EstimationRowSource {
  readonly count: number;
  open(): AsyncIterable<IContent>;
  readonly array?: readonly IContent[];
}

function arrayRowSource(contents: readonly IContent[]): EstimationRowSource {
  return {
    count: contents.length,
    open: async function* open() {
      yield* contents;
    },
    array: contents,
  };
}

export function estimateRequestTokens(
  contents: IContent[],
  providerName: string,
  modelName: string,
  deps: LoadBalancerEstimatorDeps,
): Promise<EstimationResult> {
  return estimateRowSourceTokens(
    arrayRowSource(contents),
    providerName,
    modelName,
    deps,
  );
}

export async function estimateRowSourceTokens(
  rows: EstimationRowSource,
  providerName: string,
  modelName: string,
  deps: LoadBalancerEstimatorDeps,
): Promise<EstimationResult> {
  if (rows.count === 0) {
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
      return await estimateWithTokenizer(
        rows,
        modelName,
        tokenizer,
        providerName,
      );
    } catch (error) {
      if (tokenizer.fallbackPolicy === 'deny') {
        throw error;
      }
      tokenizerFailureModel = modelName;
      logger.debug(
        () =>
          `Tokenizer estimation failed, using generic fallback: ${String(error)}`,
      );
    }
  } else {
    tokenizerFailureModel = modelName;
    logger.debug(
      () =>
        `No tokenizer available for ${providerName}/${modelName}, using generic fallback`,
    );
  }

  const result = await estimateWithGeneric(rows, providerName);
  return {
    ...result,
    source: `${result.source} (tokenizer unavailable: ${tokenizerFailureModel})`,
  };
}

function referenceMetadataCharacterEquivalent(block: unknown): number {
  if (typeof block !== 'object' || block === null) return 0;
  if (
    Reflect.get(block, 'type') !== 'media' ||
    Reflect.get(block, 'encoding') !== 'reference'
  ) {
    return 0;
  }
  const normalizedBase64Length = Reflect.get(block, 'normalizedBase64Length');
  if (typeof normalizedBase64Length !== 'number') {
    return 0;
  }
  const mimeType = Reflect.get(block, 'mimeType');
  if (
    typeof mimeType === 'string' &&
    mimeType.toLowerCase().startsWith('image/') &&
    Reflect.get(block, 'dimensions') !== undefined
  ) {
    return 0;
  }
  return Math.min(
    Math.ceil(normalizedBase64Length / BASE64_MEDIA_CHAR_DIVISOR),
    MEDIA_DATA_CHAR_CAP,
  );
}

function referenceMetadataTokens(encodedCharacterEquivalent: number): number {
  return Math.ceil(encodedCharacterEquivalent / CHARS_PER_TOKEN_FALLBACK);
}

/** Pass-through that folds each row's reference-metadata cost as it streams. */
async function* withReferenceMetadataFold(
  rows: AsyncIterable<IContent>,
  fold: { characters: number },
): AsyncGenerator<IContent> {
  for await (const content of rows) {
    foldReferenceMetadata(content, fold);
    yield content;
  }
}

function foldReferenceMetadata(
  content: IContent,
  fold: { characters: number },
): void {
  if (!Array.isArray(content.blocks)) return;
  for (const block of content.blocks) {
    fold.characters += referenceMetadataCharacterEquivalent(block);
  }
}

async function estimateWithTokenizer(
  rows: EstimationRowSource,
  modelName: string,
  tokenizer: ITokenizer,
  providerName: string,
): Promise<EstimationResult> {
  const tokenizerProvider = createTokenizerAdapter(tokenizer, providerName);
  const reference = { characters: 0 };
  const tokens = await estimateTokensForContents(
    withReferenceMetadataFold(rows.open(), reference),
    modelName,
    tokenizerProvider,
    logger,
  );
  return {
    tokens:
      applyNonEmptyTokenFloor(rows.count, tokens) +
      (reference.characters === 0
        ? 0
        : referenceMetadataTokens(reference.characters)),
    source: `${modelName} (tokenizer)`,
  };
}

function applyNonEmptyTokenFloor(count: number, tokens: number): number {
  if (count === 0) {
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
  try {
    if (Array.isArray(value)) {
      let total = 2;
      const childCount = Math.min(value.length, MAX_UNSERIALIZABLE_CHILDREN);
      for (let index = 0; index < childCount; index++) {
        total += estimateUnserializableCharacters(
          value[index],
          seen,
          depth + 1,
        );
      }
      const omittedCount = value.length - childCount;
      if (omittedCount > 0) {
        total += omittedCount * NON_TEXT_BLOCK_CHAR_ESTIMATE;
      }
      return total;
    }

    let total = 2;
    const keys = Reflect.ownKeys(value);
    const keyCount = Math.min(keys.length, MAX_UNSERIALIZABLE_CHILDREN);
    for (let index = 0; index < keyCount; index++) {
      const key = keys[index];
      total += String(key).length;
      total += estimateUnserializableCharacters(
        (value as Record<PropertyKey, unknown>)[key],
        seen,
        depth + 1,
      );
    }
    const omittedCount = keys.length - keyCount;
    if (omittedCount > 0) {
      total += omittedCount * NON_TEXT_BLOCK_CHAR_ESTIMATE;
    }
    return total;
  } finally {
    seen.delete(value);
  }
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

function estimateRawContentTokens(contents: readonly IContent[]): number {
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
  rows: EstimationRowSource,
  providerName?: string,
): Promise<EstimationResult> {
  const reference = { characters: 0 };
  const addReference = (result: EstimationResult): EstimationResult =>
    reference.characters === 0
      ? result
      : {
          ...result,
          tokens: result.tokens + referenceMetadataTokens(reference.characters),
        };
  const contents = rows.array;
  try {
    const tokens = await estimateTokensForContents(
      withReferenceMetadataFold(rows.open(), reference),
      undefined,
      new GenericTokenizerProvider(providerName),
      logger,
    );
    return addReference({
      tokens: applyNonEmptyTokenFloor(rows.count, tokens),
      source: 'generic (tiktoken/char fallback)',
    });
  } catch (error) {
    // Row-stream failures (reader errors, abort) are not estimation
    // degradations and must surface. Only the legacy array route has the
    // serialized-JSON and character fallbacks.
    if (contents === undefined) throw error;
    logger.debug(
      () =>
        `Generic token estimation failed, using JSON fallback: ${String(error)}`,
    );
    // The failed pass may have folded only a prefix of the rows.
    reference.characters = 0;
    for (const content of contents) foldReferenceMetadata(content, reference);
    return addReference(estimateFromArrayFallbacks(contents));
  }
}

function estimateFromArrayFallbacks(
  contents: readonly IContent[],
): EstimationResult {
  try {
    const serializedContents = JSON.stringify(
      contents,
      (_key, value: unknown) => sanitizeMediaForJsonFallback(value),
    );
    return {
      tokens: applyNonEmptyTokenFloor(
        contents.length,
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
        contents.length,
        estimateRawContentTokens(contents),
      ),
      source: 'generic (char fallback)',
    };
  }
}
