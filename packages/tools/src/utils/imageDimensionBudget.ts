/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  parseImageDimensions,
  parseImageDimensionsFromBase64,
} from './imageDimensions.js';
import { ToolErrorType } from '../types/tool-error.js';

/**
 * A hard, provider/model-specific image output budget. When resolved from the
 * active ephemeral settings, every built-in image-producing tool rejects bytes
 * that exceed either boundary before they are handed to the model.
 *
 * `maxDimension` constrains BOTH the width and the height (the longest single
 * edge). `maxPixels` constrains the total decoded pixel count.
 *
 * Both are optional: an absent field imposes no constraint, and a fully absent
 * budget (undefined) disables the hard preflight entirely.
 */
export interface ImageDimensionBudget {
  readonly maxDimension?: number;
  readonly maxPixels?: number;
}

/**
 * A concrete budget violation discovered by {@link checkImageDimensionBudget}.
 * Carries the actual geometry and the boundary that was exceeded so the
 * model-facing error is fully actionable.
 */
export interface ImageBudgetViolation {
  readonly width: number;
  readonly height: number;
  readonly pixels: number;
  readonly maxDimension?: number;
  readonly maxPixels?: number;
  readonly exceededDimension: boolean;
  readonly exceededPixels: boolean;
}

function readPositiveInteger(
  settings: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined {
  const value = settings[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(
      `Invalid image dimension budget: ${key} must be a positive integer`,
    );
  }
  return value;
}

/**
 * Resolve the active image dimension/pixel budget from ephemeral settings.
 *
 * Returns `undefined` when neither key is configured (no hard limit). Throws
 * immediately on a malformed value so a misconfiguration surfaces as a real
 * tool error instead of silently disabling the preflight.
 */
export function resolveImageDimensionBudget(
  settings: Readonly<Record<string, unknown>>,
): ImageDimensionBudget | undefined {
  const maxDimension = readPositiveInteger(settings, 'max-image-dimension');
  const maxPixels = readPositiveInteger(settings, 'max-image-pixels');
  if (maxDimension === undefined && maxPixels === undefined) {
    return undefined;
  }
  return { maxDimension, maxPixels };
}

/**
 * Check a base64 image payload against the active budget.
 *
 * Returns an {@link ImageBudgetViolation} when either the width/height exceeds
 * `maxDimension` or the total pixels exceed `maxPixels`. Returns `undefined`
 * when the image is within budget OR when the dimensions cannot be parsed from
 * the header (we never invent a dimension for an unparseable image; it retains
 * existing behavior).
 */
export function checkImageDimensionBudget(
  base64: string,
  budget: ImageDimensionBudget,
): ImageBudgetViolation | undefined {
  const dimensions = parseImageDimensionsFromBase64(base64);
  if (dimensions === undefined) {
    return undefined;
  }
  return checkImageDimensionBudgetFromDimensions(
    dimensions.width,
    dimensions.height,
    budget,
  );
}

/**
 * Check raw image header bytes (a `Uint8Array`, e.g. a `Buffer`) against the
 * active budget WITHOUT first base64-encoding the full payload. Shares the
 * exact boundary logic with {@link checkImageDimensionBudget} via
 * {@link checkImageDimensionBudgetFromDimensions}, so both entry points have
 * identical boundary behavior; only the dimension source differs.
 *
 * Returns `undefined` when the image is within budget OR when the dimensions
 * cannot be parsed from the header (we never invent a dimension for an
 * unparseable image). Used by file-processing paths that already hold the raw
 * bytes so the complete buffer is never base64-encoded just to inspect
 * bounded dimensions.
 */
export function checkImageDimensionBudgetFromBuffer(
  bytes: Uint8Array,
  budget: ImageDimensionBudget,
): ImageBudgetViolation | undefined {
  const dimensions = parseImageDimensions(bytes);
  if (dimensions === undefined) {
    return undefined;
  }
  return checkImageDimensionBudgetFromDimensions(
    dimensions.width,
    dimensions.height,
    budget,
  );
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

/**
 * Build the model-facing error message for a budget violation. Includes the
 * actual dimensions, the exceeded boundary, the image identity, and a direct
 * instruction to create a thumbnail or downscale first.
 */
export function formatImageBudgetError(
  violation: ImageBudgetViolation,
  displayName?: string,
): string {
  const identity = displayName ? ` ${displayName}` : '';
  const parts: string[] = [
    `Image${identity} is ${violation.width}x${violation.height} pixels (${formatNumber(violation.pixels)} total)`,
  ];
  if (violation.exceededDimension && violation.maxDimension !== undefined) {
    parts.push(
      `exceeds the configured maximum dimension of ${violation.maxDimension} pixels on either width or height`,
    );
  }
  if (violation.exceededPixels && violation.maxPixels !== undefined) {
    parts.push(
      `exceeds the configured maximum of ${formatNumber(violation.maxPixels)} total pixels`,
    );
  }
  parts.push(
    'Create a smaller thumbnail or downscale the image to within the budget, then read it again',
  );
  return parts.join('; ') + '.';
}

/**
 * Shared terminal display heading for image budget violations. Every
 * model-facing budget error site wraps its message with this so the user-facing
 * presentation cannot drift between tools.
 */
export function formatImageBudgetDisplay(message: string): string {
  return `## Image Dimension Limit

${message}`;
}

/**
 * Bounded prefix size for file-based dimension parsing. Covers PNG, GIF, WEBP
 * headers entirely and JPEG SOF markers in practice; deliberately small so
 * a multi-megabyte file is never read in full just to inspect dimensions.
 */
const IMAGE_HEADER_PREFIX_BYTES = 8192;

/**
 * Read a bounded prefix of a file for dimension parsing. Returns a Uint8Array
 * containing up to `maxBytes` from the start of the file.
 */
export type HeaderReader = (maxBytes: number) => Promise<Uint8Array>;

/**
 * Check a file's image dimensions against the active budget by reading only a
 * bounded header prefix — never the full file. Returns a violation when the
 * image exceeds the budget, or `undefined` when the image is within budget, no
 * budget is active, or the dimensions cannot be parsed (non-image or corrupt).
 *
 * Used by read_many_files to check explicitly-requested images BEFORE the
 * generic per-item size-skip gate, so an oversized image receives an actionable
 * tool error instead of being silently skipped for file-size reasons.
 */
export async function checkImageFileDimensionBudget(
  readPrefix: HeaderReader,
  budget: ImageDimensionBudget,
): Promise<ImageBudgetViolation | undefined> {
  const bytes = await readPrefix(IMAGE_HEADER_PREFIX_BYTES);
  if (bytes.length === 0) return undefined;
  const dimensions = parseImageDimensions(bytes);
  if (dimensions === undefined) return undefined;
  return checkImageDimensionBudgetFromDimensions(
    dimensions.width,
    dimensions.height,
    budget,
  );
}

/**
 * Read a bounded prefix from a file on disk. Opens, reads up to `maxBytes`
 * from offset 0, and always closes the handle.
 */
export async function readFileHeaderPrefix(
  filePath: string,
  maxBytes: number,
): Promise<Uint8Array> {
  const { promises: fsp } = await import('node:fs');
  const fh = await fsp.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
    return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead);
  } finally {
    await fh.close();
  }
}

/**
 * H4 preflight: check an explicitly-requested image file's dimensions against
 * the active budget by reading only a bounded header prefix, and return the
 * formatted, actionable error message when the image is oversized. Returns
 * `undefined` when the image is within budget, no budget is active, or the
 * dimensions cannot be parsed. The caller decides how to surface the message.
 */
export async function checkImageFileBudgetMessage(
  filePath: string,
  budget: ImageDimensionBudget | undefined,
  displayName?: string,
): Promise<string | undefined> {
  if (budget === undefined) return undefined;
  const violation = await checkImageFileDimensionBudget(
    (maxBytes) => readFileHeaderPrefix(filePath, maxBytes),
    budget,
  );
  if (violation === undefined) return undefined;
  return formatImageBudgetError(violation, displayName);
}

/**
 * Check dimensions directly (used by both base64 and file-based paths).
 */
function checkImageDimensionBudgetFromDimensions(
  width: number,
  height: number,
  budget: ImageDimensionBudget,
): ImageBudgetViolation | undefined {
  const pixels = width * height;
  const exceededDimension =
    budget.maxDimension !== undefined &&
    (width > budget.maxDimension || height > budget.maxDimension);
  const exceededPixels =
    budget.maxPixels !== undefined && pixels > budget.maxPixels;
  if (!exceededDimension && !exceededPixels) return undefined;
  return {
    width,
    height,
    pixels,
    maxDimension: budget.maxDimension,
    maxPixels: budget.maxPixels,
    exceededDimension,
    exceededPixels,
  };
}

/**
 * Complete H4 preflight result: an actionable error for read_many_files when an
 * explicitly-requested image file exceeds the budget. The caller wraps this
 * into its own tool-result type.
 */
export interface ImageBudgetPreflightError {
  readonly message: string;
  readonly llmContent: string;
  readonly returnDisplay: string;
  readonly errorType: ToolErrorType;
}

/**
 * H4 preflight: check an explicitly-requested image file's dimensions BEFORE
 * the generic per-item size-skip gate in read_many_files. Reads only a bounded
 * header prefix. Returns an actionable error when the image is oversized, or
 * `undefined` when within budget, no budget, not an image, or not explicitly
 * requested.
 */
export async function checkImageBudgetPreflightForFile(
  filePath: string,
  budget: ImageDimensionBudget | undefined,
  isImage: boolean,
  isExplicitlyRequested: boolean,
  displayName?: string,
): Promise<ImageBudgetPreflightError | undefined> {
  if (budget === undefined || !isImage || !isExplicitlyRequested) {
    return undefined;
  }
  const msg = await checkImageFileBudgetMessage(filePath, budget, displayName);
  if (msg === undefined) return undefined;
  return {
    message: msg,
    llmContent: msg,
    returnDisplay: formatImageBudgetDisplay(msg),
    errorType: ToolErrorType.READ_CONTENT_FAILURE,
  };
}

/**
 * Wrap a preflight error into the standard single-file processing result
 * shape used by read_many_files (done + totalTokens + tool error).
 */
export function preflightToSingleFileResult(
  pf: ImageBudgetPreflightError,
  currentTokens: number,
): {
  done: true;
  totalTokens: number;
  error: {
    llmContent: string;
    returnDisplay: string;
    error: { message: string; type: ToolErrorType };
  };
} {
  return {
    done: true,
    totalTokens: currentTokens,
    error: {
      llmContent: pf.llmContent,
      returnDisplay: pf.returnDisplay,
      error: { message: pf.message, type: pf.errorType },
    },
  };
}
