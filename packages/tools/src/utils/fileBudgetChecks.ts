/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import {
  detectFileType,
  getImageSourceSizeLimit,
  isAssetExplicitlyRequested,
  shouldResizeExplicitImage,
} from './fileUtils.js';
import { getErrorMessage } from './errors.js';
import {
  checkImageBudgetPreflightForFile,
  preflightToSingleFileResult,
  type ImageDimensionBudget,
} from './imageDimensionBudget.js';

/**
 * Check if a file exceeds the configured size limit (issue #3216 extraction
 * from ReadManyFilesTool). Pushes a skip reason and returns 'skip' when
 * exceeded (or on stat error), 'continue' otherwise.
 */
export async function checkFileSizeLimit(
  filePath: string,
  relativePathForDisplay: string,
  skippedFiles: Array<{ path: string; reason: string }>,
  fileSizeLimit: number,
): Promise<'skip' | 'continue'> {
  try {
    const { size } = await fs.promises.stat(filePath);
    if (size <= fileSizeLimit) return 'continue';
    skippedFiles.push({
      path: relativePathForDisplay,
      reason: `file size (${Math.round(size / 1024)}KB) exceeds limit (${Math.round(fileSizeLimit / 1024)}KB)`,
    });
    return 'skip';
  } catch (error) {
    skippedFiles.push({
      path: relativePathForDisplay,
      reason: `stat error: ${getErrorMessage(error)}`,
    });
    return 'skip';
  }
}

/**
 * Check if an asset file (image/pdf/audio) was explicitly requested (#3216).
 * Returns 'skip' when not explicitly requested, 'continue' otherwise.
 */
export async function checkAssetFileRequested(
  filePath: string,
  relativePathForDisplay: string,
  inputPatterns: readonly string[],
  skippedFiles: Array<{ path: string; reason: string }>,
): Promise<'skip' | 'continue'> {
  const ft = await detectFileType(filePath);
  const isAsset = ft === 'image' || ft === 'pdf' || ft === 'audio';
  if (!isAsset || isAssetExplicitlyRequested(filePath, inputPatterns))
    return 'continue';
  skippedFiles.push({
    path: relativePathForDisplay,
    reason:
      'asset file (image/pdf/audio) was not explicitly requested by name or extension',
  });
  return 'skip';
}

/**
 * Outcome of the pre-read gate sequence for a single file in read_many_files.
 *
 * - `'preflight-error'`: the image dimension preflight rejected an explicitly
 *   requested image; `result` is the actionable tool error to return.
 * - `'skip'`: the file was skipped for size or asset-request reasons (the
 *   reason was already pushed onto `skippedFiles`); the loop continues.
 * - `'proceed'`: all gates passed; `resizeBeforeOutputLimit` is the resolved
 *   flag the caller needs for the remaining read/error checks.
 */
export type PreReadGateResult =
  | {
      readonly outcome: 'preflight-error';
      readonly result: ReturnType<typeof preflightToSingleFileResult>;
    }
  | { readonly outcome: 'skip' }
  | { readonly outcome: 'proceed'; readonly resizeBeforeOutputLimit: boolean };

/**
 * Run the full pre-read gate sequence for one file: the H4 image-dimension
 * preflight (before the size-skip gate), then the per-file size limit and the
 * asset-request gate. Returns a {@link PreReadGateResult} so the caller can
 * return the preflight error, continue past a skip, or proceed with the read.
 *
 * The hard image budget is resolved once per file by the caller and passed in
 * so the preflight and the later content-processing path share one decision.
 */
export async function runPreReadGates(
  filePath: string,
  inputPatterns: readonly string[],
  relativePathForDisplay: string,
  skippedFiles: Array<{ path: string; reason: string }>,
  fileSizeLimit: number,
  currentTokens: number,
  imageBudget: ImageDimensionBudget | undefined,
  hasResizePolicy: boolean,
): Promise<PreReadGateResult> {
  const pf = await checkImageBudgetPreflightForFile(
    filePath,
    imageBudget,
    (await detectFileType(filePath)) === 'image',
    isAssetExplicitlyRequested(filePath, inputPatterns),
    relativePathForDisplay,
  );
  if (pf !== undefined) {
    return {
      outcome: 'preflight-error',
      result: preflightToSingleFileResult(pf, currentTokens),
    };
  }
  const resizeBeforeOutputLimit = await shouldResizeExplicitImage(
    filePath,
    inputPatterns,
    hasResizePolicy,
  );
  if (
    (await checkFileSizeLimit(
      filePath,
      relativePathForDisplay,
      skippedFiles,
      getImageSourceSizeLimit(resizeBeforeOutputLimit, fileSizeLimit),
    )) === 'skip' ||
    (await checkAssetFileRequested(
      filePath,
      relativePathForDisplay,
      inputPatterns,
      skippedFiles,
    )) === 'skip'
  ) {
    return { outcome: 'skip' };
  }
  return { outcome: 'proceed', resizeBeforeOutputLimit };
}
