/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  parseImageDimensionsFromBase64,
  type ImageDimensions,
} from './imageDimensions.js';

/**
 * Provider-aware image token estimation. Each family applies the documented
 * client-side approximation for its platform; there is no server round-trip.
 */

export type ImageTokenProviderFamily =
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'default';

/** Flat fallback when no provider is known (better than 85, safer than 3000). */
export const DEFAULT_IMAGE_TOKEN_ESTIMATE = 1000;

/**
 * Google publishes no client-side image token formula, so that family charges a
 * conservative flat estimate for every image regardless of dimensions.
 */
const FLAT_IMAGE_TOKEN_ESTIMATE = 3000;

/** Anthropic caps the long edge of an accepted image at this many pixels. */
const ANTHROPIC_MAX_LONG_EDGE = 1568;

/**
 * Anthropic's documented largest accepted 1:1 image is 1092x1092; anything
 * larger is downscaled to at most that many pixels before being tokenised.
 */
const ANTHROPIC_MAX_PIXELS = 1092 * 1092;

/** Anthropic charges one token per this many pixels. */
const ANTHROPIC_PIXELS_PER_TOKEN = 750;

/**
 * The cost of Anthropic's largest accepted image, which is also its worst case
 * when dimensions cannot be parsed.
 */
const ANTHROPIC_UNKNOWN_DIMENSIONS_TOKENS = Math.ceil(
  ANTHROPIC_MAX_PIXELS / ANTHROPIC_PIXELS_PER_TOKEN,
);

/**
 * OpenAI's larger published high-detail example (2048x4096) is the safest
 * documented value when dimensions are unknown. The tile formula has no finite
 * maximum because the aspect ratio is unbounded, so a documented example is
 * preferred over an arbitrarily large constant that would make context
 * compression fire spuriously for every URL-referenced image.
 */
const OPENAI_LEGACY_UNKNOWN_DIMENSIONS_TOKENS = 1105;

/**
 * GPT-5.2+ patch formula caps at 1536 patches, so the worst case at standard
 * detail is ceil(1.2 x 1536) = 1844 tokens.
 */
const OPENAI_PATCH_UNKNOWN_DIMENSIONS_TOKENS = 1844;

/** OpenAI first fits the image inside a square of this many pixels per edge. */
const OPENAI_MAX_EDGE = 2048;

/** OpenAI then normalises the shortest side to this many pixels. */
const OPENAI_SHORT_SIDE = 768;

/** OpenAI divides the normalised image into square tiles of this size. */
const OPENAI_TILE_SIZE = 512;

/** OpenAI charges this many tokens per high-detail tile. */
const OPENAI_TOKENS_PER_TILE = 170;

/** OpenAI charges this base cost for every high-detail image. */
const OPENAI_BASE_TOKENS = 85;

/** GPT-5.2+ patch formula: max patches at standard detail. */
const OPENAI_PATCH_MAX_PATCHES = 1536;

/** GPT-5.2+ patch formula: multiplier applied to patch count. */
const OPENAI_PATCH_MULTIPLIER = 1.2;

/**
 * GPT-5.2+ patch formula: ceil(1.2 x min(ceil(w/32) x ceil(h/32), 1536)).
 * Maximum 1844 tokens at standard detail.
 */
function estimateOpenaiPatchTokens(dimensions: ImageDimensions): number {
  const patchesW = Math.ceil(dimensions.width / 32);
  const patchesH = Math.ceil(dimensions.height / 32);
  const patches = Math.min(patchesW * patchesH, OPENAI_PATCH_MAX_PATCHES);
  return Math.ceil(OPENAI_PATCH_MULTIPLIER * patches);
}

/** Classification of an OpenAI-family model for image token estimation. */
export type OpenaiImageTokenGeneration = 'patch' | 'legacy' | 'unknown';

/**
 * Classify a model name for OpenAI image token estimation.
 *
 * - 'patch': GPT-5.2 and newer, including any later minor (gpt-5.6,
 *   gpt-5.10), named variants like gpt-5.6-sol/terra/luna, and every
 *   GPT-6+ model (gpt-6, gpt-10). The major/minor version is parsed
 *   numerically so multi-digit versions classify correctly.
 * - 'legacy': gpt-4o, gpt-4.1, gpt-5.0, gpt-5.1, and o-series models
 *   (o1, o3, o4-mini).
 * - 'unknown': model is provided but does not match either category.
 *   Callers in the OpenAI family should use the patch formula (conservative-high).
 * - Returns 'unknown' for undefined/empty model so callers can decide.
 */
export function classifyOpenaiModel(
  model: string | undefined,
): OpenaiImageTokenGeneration {
  if (model === undefined || model.length === 0) return 'unknown';
  const normalized = model.trim().toLowerCase();
  const generation = classifyNormalizedOpenaiModel(normalized);
  return generation;
}

function classifyNormalizedOpenaiModel(
  normalized: string,
): OpenaiImageTokenGeneration {
  // Patch when major > 5 (gpt-6, gpt-10, ...) or major == 5 with a minor
  // of at least 2 (gpt-5.2, gpt-5.10). Parsed numerically because regex
  // digit ranges cannot express ">= 2" or ">= 6" for multi-digit versions.
  const version = /^gpt-(\d+)(?:\.(\d+))?/.exec(normalized);
  if (version !== null) {
    const major = parseInt(version[1], 10);
    // The optional minor group is either absent (undefined, falsy) or a
    // digit run (never empty), so a truthiness check separates the cases.
    const minor = version[2] ? parseInt(version[2], 10) : 0;
    if (major > 5 || (major === 5 && minor >= 2)) return 'patch';
  }
  // Known legacy models
  if (isLegacyOpenaiModel(normalized)) return 'legacy';
  return 'unknown';
}

const LEGACY_OPENAI_MODEL_PATTERNS: readonly RegExp[] = [
  /^gpt-4o/,
  /^gpt-4\.1/,
  /^gpt-5\.0/,
  /^gpt-5\.1/,
  /^o[1-9]/,
];

function isLegacyOpenaiModel(normalized: string): boolean {
  return LEGACY_OPENAI_MODEL_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
}

/**
 * Determine whether a model name belongs to the GPT-5.2-or-newer generation
 * that uses the patch-based image token formula. For unknown models in the
 * OpenAI family, returns true (conservative-high, per issue #3477).
 * Returns false for undefined/empty model (no basis to choose).
 */
export function isGpt52OrNewer(model: string | undefined): boolean {
  const generation = classifyOpenaiModel(model);
  if (generation === 'unknown') {
    // Unknown but non-empty model in the openai family: use patch formula
    // (conservative-high). Undefined/empty model: no basis, use legacy.
    return model !== undefined && model.trim().length > 0;
  }
  return generation === 'patch';
}

export interface ImageTokenEstimateInput {
  readonly provider?: string;
  readonly dimensions?: ImageDimensions;
  readonly model?: string;
}

/**
 * Provider-name fragments per family. Substring matching mirrors the tokenizer
 * selection in the providers runtime so alias providers that wrap a backing
 * platform (for example `claudecode` or `codex`) resolve to the same family as
 * the platform they proxy.
 */
const FAMILY_MATCHERS: ReadonlyArray<
  readonly [ImageTokenProviderFamily, readonly string[]]
> = [
  ['anthropic', ['anthropic', 'claude']],
  ['gemini', ['gemini', 'google']],
  ['openai', ['openai', 'codex']],
];

export function resolveImageTokenProviderFamily(
  provider: string | undefined,
): ImageTokenProviderFamily {
  if (provider === undefined) return 'default';
  const normalized = provider.trim().toLowerCase();
  if (normalized.length === 0) return 'default';
  for (const [family, fragments] of FAMILY_MATCHERS) {
    if (fragments.some((fragment) => normalized.includes(fragment))) {
      return family;
    }
  }
  return 'default';
}

function hasValidDimensions(
  dimensions: ImageDimensions | undefined,
): dimensions is ImageDimensions {
  if (dimensions === undefined) return false;
  return (
    Number.isFinite(dimensions.width) &&
    Number.isFinite(dimensions.height) &&
    dimensions.width > 0 &&
    dimensions.height > 0
  );
}

/**
 * Anthropic: downscale until both the long-edge and total-pixel limits hold
 * (never upscaling), then charge one token per 750 pixels.
 */
function estimateAnthropicTokens(dimensions: ImageDimensions): number {
  const { width, height } = dimensions;
  const edgeScale = Math.min(
    1,
    ANTHROPIC_MAX_LONG_EDGE / Math.max(width, height),
  );
  const edgePixels = width * edgeScale * (height * edgeScale);
  const areaScale =
    edgePixels > ANTHROPIC_MAX_PIXELS
      ? Math.sqrt(ANTHROPIC_MAX_PIXELS / edgePixels)
      : 1;
  const pixels = edgePixels * areaScale * areaScale;
  // Any visible image costs at least one token.
  return Math.max(1, Math.ceil(pixels / ANTHROPIC_PIXELS_PER_TOKEN));
}

/** Tolerance absorbing float error for dimensions that land exactly on a tile edge. */
const TILE_EDGE_EPSILON = 1e-6;

function countTiles(edge: number): number {
  return Math.max(1, Math.ceil(edge / OPENAI_TILE_SIZE - TILE_EDGE_EPSILON));
}

/**
 * OpenAI high detail: fit inside 2048x2048, normalise the shortest side to 768,
 * then count 512-px tiles at 170 tokens each plus an 85-token base.
 */
function estimateOpenaiTokens(dimensions: ImageDimensions): number {
  const { width, height } = dimensions;
  const boundScale = Math.min(1, OPENAI_MAX_EDGE / Math.max(width, height));
  const boundedWidth = width * boundScale;
  const boundedHeight = height * boundScale;
  const shortSideScale =
    OPENAI_SHORT_SIDE / Math.min(boundedWidth, boundedHeight);
  const tiles =
    countTiles(boundedWidth * shortSideScale) *
    countTiles(boundedHeight * shortSideScale);
  return OPENAI_TOKENS_PER_TILE * tiles + OPENAI_BASE_TOKENS;
}

function estimateForFamily(
  family: ImageTokenProviderFamily,
  dimensions: ImageDimensions | undefined,
  model: string | undefined,
): number {
  if (!hasValidDimensions(dimensions)) {
    switch (family) {
      case 'anthropic':
        return ANTHROPIC_UNKNOWN_DIMENSIONS_TOKENS;
      case 'openai':
        return isGpt52OrNewer(model)
          ? OPENAI_PATCH_UNKNOWN_DIMENSIONS_TOKENS
          : OPENAI_LEGACY_UNKNOWN_DIMENSIONS_TOKENS;
      case 'gemini':
        return FLAT_IMAGE_TOKEN_ESTIMATE;
      default:
        return DEFAULT_IMAGE_TOKEN_ESTIMATE;
    }
  }
  switch (family) {
    case 'anthropic':
      return estimateAnthropicTokens(dimensions);
    case 'openai':
      return isGpt52OrNewer(model)
        ? estimateOpenaiPatchTokens(dimensions)
        : estimateOpenaiTokens(dimensions);
    case 'gemini':
      return FLAT_IMAGE_TOKEN_ESTIMATE;
    default:
      return DEFAULT_IMAGE_TOKEN_ESTIMATE;
  }
}

/**
 * Estimate image token cost for a given provider family and optional parsed
 * dimensions. Always returns a positive integer.
 */
export function estimateImageTokens(input: ImageTokenEstimateInput): number {
  const family = resolveImageTokenProviderFamily(input.provider);
  return estimateForFamily(family, input.dimensions, input.model);
}

/**
 * Estimate tokens for a non-text (binary) part described by its MIME type and
 * optional base64 payload. Images are measured from their parsed header
 * dimensions; every other binary payload uses the flat default estimate.
 */
export function estimateNonTextPartTokens(
  mimeType: string | undefined,
  base64Data: string | undefined,
  provider?: string,
  model?: string,
): number {
  const isImage = mimeType?.toLowerCase().startsWith('image/') ?? false;
  if (!isImage) {
    return DEFAULT_IMAGE_TOKEN_ESTIMATE;
  }
  const dimensions =
    base64Data === undefined
      ? undefined
      : parseImageDimensionsFromBase64(base64Data);
  return estimateImageTokens({ provider, dimensions, model });
}
