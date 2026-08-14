/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  parseImageDimensions,
  parseImageDimensionsFromBase64,
  parseJpegDimensionsFromReader,
  type JpegSegmentReader,
} from './imageDimensions.js';
import { ToolErrorType } from '../types/tool-error.js';

/**
 * Hard image output budget. `maxDimension` constrains both width and height;
 * `maxPixels` constrains total decoded pixels. An absent field imposes no
 * constraint; a fully absent budget disables the preflight.
 */
export interface ImageDimensionBudget {
  readonly maxDimension?: number;
  readonly maxPixels?: number;
}

/** A budget violation carrying the actual geometry and exceeded boundary. */
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
 * Returns `undefined` when neither key is configured. Throws on a malformed
 * value so a misconfiguration surfaces as a tool error instead of silently
 * disabling the preflight.
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
 * Check a base64 image payload against the active budget. Returns `undefined`
 * when the image is within budget or its dimensions cannot be parsed from the
 * header (no dimension is invented for an unparseable image).
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
 * Check raw image header bytes against the active budget, sharing the boundary
 * logic of {@link checkImageDimensionBudget}. Used by file-processing paths
 * that already hold the raw bytes, avoiding a full base64 encode.
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

/** Build the model-facing error message for a budget violation. */
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

/** Shared display heading wrapping a budget error message. */
export function formatImageBudgetDisplay(message: string): string {
  return `## Image Dimension Limit

${message}`;
}

/** Bounded prefix size for file-based dimension parsing. */
const IMAGE_HEADER_PREFIX_BYTES = 8192;

/** Reads up to `maxBytes` from the start of a file for dimension parsing. */
export type HeaderReader = (maxBytes: number) => Promise<Uint8Array>;

/**
 * Check a file's dimensions against the budget by reading only a bounded
 * header prefix. Returns `undefined` when the image is within budget, no
 * budget is active, or dimensions cannot be parsed.
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
 * Check a file's image dimensions against the active budget, reading only a
 * bounded header prefix. When the fixed prefix cannot reach SOF in a JPEG,
 * falls back to the bounded segment walker. Returns `undefined` when the
 * image is within budget, no budget is active, or dimensions cannot be
 * parsed. I/O errors from the file reads propagate.
 */
export async function checkImageFileBudgetMessage(
  filePath: string,
  budget: ImageDimensionBudget | undefined,
  displayName?: string,
): Promise<string | undefined> {
  if (budget === undefined) return undefined;
  let violation = await checkImageFileDimensionBudget(
    (maxBytes) => readFileHeaderPrefix(filePath, maxBytes),
    budget,
  );
  violation ??= await checkJpegFileDimensionBudget(filePath, budget);
  if (violation === undefined) return undefined;
  return formatImageBudgetError(violation, displayName);
}

/**
 * Locate SOF past the fixed prefix via the bounded segment walker, opening
 * the file once for the whole scan. Only invoked when the file is actually a
 * JPEG and the prefix parse returned no dimensions.
 */
async function checkJpegFileDimensionBudget(
  filePath: string,
  budget: ImageDimensionBudget,
): Promise<ImageBudgetViolation | undefined> {
  const { promises: fsp } = await import('node:fs');
  const fh = await fsp.open(filePath, 'r');
  try {
    const sigBuf = Buffer.alloc(2);
    const { bytesRead } = await fh.read(sigBuf, 0, 2, 0);
    if (bytesRead < 2 || sigBuf[0] !== 0xff || sigBuf[1] !== 0xd8) {
      return undefined;
    }
    const reader: JpegSegmentReader = async (offset, length) => {
      const buf = Buffer.alloc(length);
      const { bytesRead: n } = await fh.read(buf, 0, length, offset);
      return new Uint8Array(buf.buffer, buf.byteOffset, n);
    };
    const dimensions = await parseJpegDimensionsFromReader(reader);
    if (dimensions === undefined) return undefined;
    return checkImageDimensionBudgetFromDimensions(
      dimensions.width,
      dimensions.height,
      budget,
    );
  } finally {
    await fh.close();
  }
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

/** Actionable preflight error returned to read_many_files for an oversized image. */
export interface ImageBudgetPreflightError {
  readonly message: string;
  readonly llmContent: string;
  readonly returnDisplay: string;
  readonly errorType: ToolErrorType;
}

/**
 * Check an explicitly-requested image file's dimensions before the generic
 * size-skip gate in read_many_files. Returns an actionable error when the
 * image is oversized, or `undefined` otherwise.
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
