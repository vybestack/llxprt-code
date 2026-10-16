/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  AnthropicDocumentBlock,
  AnthropicImageBlock,
  AnthropicMessageBlock,
} from './AnthropicMessageNormalizer.js';
import type { MetadataBearingOptions } from '../IProvider.js';
import { RETRY_REQUEST_CONTEXT_KEY } from '../transportAttemptBudget.js';
import {
  checkImageDimensionBudget,
  resolveImageDimensionBudget,
  type ImageDimensionBudget,
} from '@vybestack/llxprt-code-tools/utils/imageDimensionBudget.js';

/** Placeholder inserted in place of a dropped oversized image block. */
const DROPPED_IMAGE_PLACEHOLDER =
  '[Image dropped: exceeded the provider image dimension limit. Provide a smaller image.]';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Proactively sanitize oversized image blocks from an immutable copy of the
 * IContent history according to the active budget. Returns the sanitized
 * contents and the number of replacements made. The input array and its
 * nested blocks are never mutated.
 *
 * When `budget` is `undefined`, the original contents are returned unchanged
 * with zero replacements.
 */
export function sanitizeAnthropicContentImages(
  contents: IContent[],
  budget: ImageDimensionBudget | undefined,
): { contents: IContent[]; replacedCount: number } {
  if (budget === undefined) {
    return { contents, replacedCount: 0 };
  }

  let replacedCount = 0;
  const sanitized = contents.map((content) => {
    const row = sanitizeRowImages(content, budget);
    replacedCount += row.replacedCount;
    return row.row;
  });

  return { contents: sanitized, replacedCount };
}

/**
 * The one-row form of {@link sanitizeAnthropicContentImages}: a copy of `row`
 * whose oversized base64 images are replaced by the dropped-image placeholder.
 * With no budget the row itself comes back.
 */
export function sanitizeRowImages(
  row: IContent,
  budget: ImageDimensionBudget | undefined,
): { row: IContent; replacedCount: number } {
  if (budget === undefined) {
    return { row, replacedCount: 0 };
  }
  let replacedCount = 0;
  const blocks = row.blocks.map((block) => {
    if (block.type !== 'media' || block.encoding !== 'base64') {
      return block;
    }
    const violation = checkImageDimensionBudget(block.data, budget);
    if (violation === undefined) {
      return block;
    }
    replacedCount++;
    return {
      type: 'text' as const,
      text: DROPPED_IMAGE_PLACEHOLDER,
    };
  });
  return { row: { ...row, blocks }, replacedCount };
}

/**
 * Narrow structural classifier for Anthropic HTTP 400 invalid-request errors
 * that specifically state an image dimension exceeded the many-image maximum.
 *
 * Unrelated 400s (extra inputs, tool mismatches, etc.) must NOT be classified
 * so they are never retried by the one-shot recovery path.
 *
 * Recognizes the actual known service wording:
 *   "At least one of the image dimensions exceed max allowed size for
 *    many-image requests: 2000 pixels"
 *
 * The match is case/whitespace-tolerant but conservative: it requires HTTP 400,
 * the `invalid_request_error` type, AND image/dimension/many-image semantics so
 * unrelated width/height or image 400s are not misclassified.
 */
export function isAnthropicImageDimensionLimitError(error: unknown): boolean {
  if (!isRecord(error)) return false;
  if (error['status'] !== 400) return false;
  const parsed = parseAnthropicErrorDetail(error);
  if (parsed === undefined) return false;
  if (parsed.type !== 'invalid_request_error') return false;
  return isManyImageDimensionMessage(parsed.message);
}

/**
 * Conservative semantic match for the many-image dimension error wording.
 * Requires all three signal words (image, dimension(s), and many-image or the
 * specific "max allowed size" phrase) so unrelated image or dimension 400s
 * are not matched.
 */
function isManyImageDimensionMessage(message: string): boolean {
  const normalized = message.replace(/\s+/g, ' ').toLowerCase();
  if (!normalized.includes('image')) return false;
  if (!normalized.includes('dimension')) return false;
  // The real service wording says "many-image requests". "max allowed size"
  // + "dimension" is also sufficient to narrow the match.
  return (
    normalized.includes('many-image') ||
    (normalized.includes('max allowed size') && normalized.includes('exceed'))
  );
}

/**
 * Extract the dimension limit stated in an Anthropic image-dimension error,
 * if present. Parses the trailing "N pixels" from the real service wording.
 * Returns `undefined` when no numeric pixel limit can be found.
 */
export function parseAnthropicImageDimensionLimit(
  error: unknown,
): number | undefined {
  if (!isRecord(error)) return undefined;
  const parsed = parseAnthropicErrorDetail(error);
  if (parsed === undefined) return undefined;
  // Parse "N pixels" (case-insensitive) from the real many-image wording.
  // A token-based scan avoids regex backtracking concerns entirely.
  const tokens = parsed.message.split(/\s+/);
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i + 1].toLowerCase().startsWith('pixel')) {
      const value = Number(tokens[i]);
      if (Number.isInteger(value) && value > 0) return value;
    }
  }
  return undefined;
}

/**
 * Parsed Anthropic error detail extracted from the SDK error object.
 * The SDK stores the raw response body on `.error`. The standard Anthropic
 * body is `{type:'error', error:{type:'invalid_request_error', message:'...'}}`,
 * but some shapes are flat (`{type:'invalid_request_error', message:'...'}`).
 * This function unwraps both and also falls back to the top-level `.message`.
 */
interface AnthropicErrorDetail {
  readonly type: string;
  readonly message: string;
}

function parseAnthropicErrorDetail(
  e: Record<string, unknown>,
): AnthropicErrorDetail | undefined {
  const body = e['error'];

  // Nested Anthropic body: {type:'error', error:{type, message}}
  if (isRecord(body)) {
    const innerError = body['error'];
    if (isRecord(innerError)) {
      const innerType = innerError['type'];
      const innerMessage = innerError['message'];
      if (
        typeof innerType === 'string' &&
        typeof innerMessage === 'string' &&
        innerMessage.length > 0
      ) {
        return { type: innerType, message: innerMessage };
      }
    }
    // Flat body: {type:'invalid_request_error', message:'...'}
    const flatType = body['type'];
    const flatMessage = body['message'];
    if (
      typeof flatType === 'string' &&
      typeof flatMessage === 'string' &&
      flatMessage.length > 0
    ) {
      return { type: flatType, message: flatMessage };
    }
  }

  // Fallback: the top-level error.message (SDK may stringify the body).
  const directMessage = e['message'];
  if (typeof directMessage === 'string' && directMessage.length > 0) {
    // Try to recover type and message from a JSON-stringified body.
    const recovered = tryRecoverFromJsonString(directMessage);
    if (recovered !== undefined) return recovered;
  }

  return undefined;
}

/**
 * Attempt to recover the Anthropic error type and message from a
 * JSON-stringified body that the SDK may have embedded in the top-level
 * `.message`. Returns `undefined` when the string is not valid JSON or lacks
 * the expected shape.
 */
function tryRecoverFromJsonString(
  message: string,
): AnthropicErrorDetail | undefined {
  // The SDK message format is "STATUS {json}" — find the first `{`.
  const braceIndex = message.indexOf('{');
  if (braceIndex < 0) return undefined;
  try {
    const parsed = JSON.parse(message.slice(braceIndex));
    if (!isRecord(parsed)) return undefined;
    const innerError = parsed['error'];
    if (isRecord(innerError)) {
      const innerType = innerError['type'];
      const innerMessage = innerError['message'];
      if (
        typeof innerType === 'string' &&
        typeof innerMessage === 'string' &&
        innerMessage.length > 0
      ) {
        return { type: innerType, message: innerMessage };
      }
    }
    const flatType = parsed['type'];
    const flatMessage = parsed['message'];
    if (
      typeof flatType === 'string' &&
      typeof flatMessage === 'string' &&
      flatMessage.length > 0
    ) {
      return { type: flatType, message: flatMessage };
    }
  } catch {
    // Not valid JSON
  }
  return undefined;
}

/**
 * Resolve the active image dimension budget from Anthropic config ephemerals.
 * Delegates to the shared tool-side resolver so both entry points fail fast on
 * invalid configured values; profile-loaded modelDefaults ephemerals are not
 * registry-validated.
 */
export function resolveAnthropicImageBudget(
  ephemerals: Readonly<Record<string, unknown>>,
): ImageDimensionBudget | undefined {
  return resolveImageDimensionBudget(ephemerals);
}

/**
 * Merge a configured image budget with an error-derived dimension limit for
 * the one-shot recovery path (H3).
 *
 * The merged budget retains the configured `maxPixels` and uses the STRICHER
 * max dimension: `min(configured maxDimension, parsed provider maxDimension)`.
 * When no dimension is configured, the parsed limit is used. When neither a
 * configured budget nor an error limit exists, `undefined` is returned.
 */
export function resolveRecoveryImageBudget(
  configured: ImageDimensionBudget | undefined,
  errorLimit: number | undefined,
): ImageDimensionBudget | undefined {
  if (configured === undefined) {
    return errorLimit !== undefined ? { maxDimension: errorLimit } : undefined;
  }
  let maxDimension = configured.maxDimension;
  if (errorLimit !== undefined) {
    maxDimension =
      maxDimension !== undefined
        ? Math.min(maxDimension, errorLimit)
        : errorLimit;
  }
  if (maxDimension === undefined && configured.maxPixels === undefined) {
    return undefined;
  }
  return { maxDimension, maxPixels: configured.maxPixels };
}

/**
 * Request-scoped state for the one-shot image dimension recovery (H2).
 * Stored inside the shared `_retryRequestContext` metadata so it survives
 * across outer RetryOrchestrator attempts for the same logical request.
 */
export interface ImageRecoveryRequestState {
  /**
   * The budget the recovery retry applied, kept so a later outer attempt
   * builds its request under it again. A number or two; never a body.
   */
  recoveryBudget?: ImageDimensionBudget;
  recoveryUsed: boolean;
}

const IMAGE_RECOVERY_KEY = 'anthropicImageRecovery';

function getRetryContext(
  options: MetadataBearingOptions,
): Record<string, unknown> | undefined {
  const metadata = options.metadata;
  if (metadata === undefined) return undefined;
  const ctx = metadata[RETRY_REQUEST_CONTEXT_KEY];
  return isRecord(ctx) ? ctx : undefined;
}

/**
 * Return the existing recovery state for this request, or `undefined` when
 * there is no orchestrator context (direct provider call).
 */
export function getImageRecoveryState(
  options: MetadataBearingOptions,
): ImageRecoveryRequestState | undefined {
  const ctx = getRetryContext(options);
  if (ctx === undefined) return undefined;
  const state = ctx[IMAGE_RECOVERY_KEY];
  return isImageRecoveryState(state) ? state : undefined;
}

/**
 * Return the existing recovery state or create and attach a fresh one to the
 * shared retry context. When there is no orchestrator context (direct call),
 * a fresh ephemeral state is returned (not shared across calls).
 */
export function ensureImageRecoveryState(
  options: MetadataBearingOptions,
): ImageRecoveryRequestState {
  const ctx = getRetryContext(options);
  if (ctx === undefined) {
    return { recoveryUsed: false };
  }
  const existing = ctx[IMAGE_RECOVERY_KEY];
  if (isImageRecoveryState(existing)) return existing;
  const state: ImageRecoveryRequestState = { recoveryUsed: false };
  ctx[IMAGE_RECOVERY_KEY] = state;
  return state;
}

function isImageRecoveryState(
  value: unknown,
): value is ImageRecoveryRequestState {
  return isRecord(value) && typeof value['recoveryUsed'] === 'boolean';
}

/**
 * Whether an image or document block carries base64 bytes that break the
 * budget. A block with a URL source, or with bytes whose header states no
 * dimension, is never counted as oversized.
 */
function exceedsBudget(
  block: AnthropicImageBlock | AnthropicDocumentBlock,
  budget: ImageDimensionBudget,
): boolean {
  if (block.source.type !== 'base64') return false;
  return checkImageDimensionBudget(block.source.data, budget) !== undefined;
}

function droppedImageBlock(): { type: 'text'; text: string } {
  return { type: 'text', text: DROPPED_IMAGE_PLACEHOLDER };
}

/**
 * Sanitize one finished Anthropic content block against `budget`: an
 * oversized base64 image/document block becomes the dropped-image text
 * block, and the same holds for such blocks inside a `tool_result`'s content
 * array, where the wrapper keeps `tool_use_id`, `is_error`, sibling text,
 * valid images, ordering and every other field. The input is never mutated;
 * a block with nothing to replace comes back as the same object.
 *
 * Used by the one-shot reactive retry when Anthropic returns a 400
 * image-dimension error: the retry's message table is built again and each of
 * its blocks passes through here, so no sanitized copy of the body exists.
 */
export function sanitizeWireBlockImages(
  block: AnthropicMessageBlock,
  budget: ImageDimensionBudget,
): { block: AnthropicMessageBlock; replacedCount: number } {
  if (block.type === 'image' || block.type === 'document') {
    return exceedsBudget(block, budget)
      ? { block: droppedImageBlock(), replacedCount: 1 }
      : { block, replacedCount: 0 };
  }
  if (block.type !== 'tool_result' || !Array.isArray(block.content)) {
    return { block, replacedCount: 0 };
  }
  let replacedCount = 0;
  const content = block.content.map((nested) => {
    if (nested.type === 'text' || !exceedsBudget(nested, budget)) return nested;
    replacedCount++;
    return droppedImageBlock();
  });
  return replacedCount === 0
    ? { block, replacedCount }
    : { block: { ...block, content }, replacedCount };
}
