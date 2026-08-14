/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Content-assembly helpers extracted from read-many-files.ts to keep the
 * source file under the line-size limit. These functions add file content
 * (text or binary) to the output accumulator while enforcing per-file token
 * and aggregate-byte budgets, preserving the one-over semantics and
 * UTF-8-safe truncation behavior of the original tool.
 *
 * @plan PLAN-20260810-ISSUE3202
 */

import { type ContentPartUnion } from '../types/wire-types.js';
import { type ProcessedFileReadResult } from '../utils/fileUtils.js';
import { estimateNonTextPartTokens } from '../utils/imageTokenEstimation.js';
import {
  completeUtf8PrefixLength,
  type ByteBudget,
} from '../acquisition/index.js';

/** Resolved limits used by the content-assembly and overflow handlers. */
export interface ReadManyFilesLimits {
  maxFileCount: number;
  maxTokens: number;
  truncateMode: 'warn' | 'truncate' | 'sample';
  fileSizeLimit: number;
}

/** Action the caller should take after a content-addition attempt. */
export type AddFileContentAction = 'continue' | 'stop' | 'stopAfterRecord';

export interface AddFileContentResult {
  totalTokens: number;
  totalBytes: number;
  action: AddFileContentAction;
}

export const DEFAULT_OUTPUT_SEPARATOR_FORMAT = '--- {filePath} ---';
export const DEFAULT_OUTPUT_TERMINATOR = '\n--- End of content ---';

type SkippedFilesArray = Array<{ path: string; reason: string }>;

/** Simple token estimation — roughly 4 characters per token. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Truncate a string to at most `maxBytes` UTF-8 bytes without splitting a
 * multibyte character: the cut is moved back to the nearest complete
 * character boundary so the decoded output stays valid UTF-8 text.
 */
function truncateUtf8Safe(str: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  const buf = Buffer.from(str, 'utf8');
  if (buf.length <= maxBytes) return str;
  const validPrefix = completeUtf8PrefixLength(buf.subarray(0, maxBytes));
  return buf.subarray(0, validPrefix).toString('utf8');
}

/**
 * Truncate a string to at most `maxChars` UTF-16 code units without splitting
 * a surrogate pair: if the character just before the cut is a high surrogate
 * (first half of a pair), the cut is moved back one position.
 */
function truncateUtf16Safe(str: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  if (str.length <= maxChars) return str;
  let cut = maxChars;
  if (
    cut > 0 &&
    str.charCodeAt(cut - 1) >= 0xd800 &&
    str.charCodeAt(cut - 1) <= 0xdbff
  ) {
    cut--;
  }
  return str.substring(0, cut);
}

/**
 * Add one file's content to the output accumulator, dispatching between text
 * and non-text (image/PDF) content. Returns the action the caller should take.
 */
export function addFileContent(
  fileReadResult: ProcessedFileReadResult,
  filePath: string,
  relativePathForDisplay: string,
  skippedFiles: SkippedFilesArray,
  contentParts: Array<string | ContentPartUnion>,
  limits: ReadManyFilesLimits,
  totalTokens: number,
  totalBytes: number,
  aggregateByteBudget: ByteBudget,
  sortedFiles: string[],
  processedFilesRelativePaths: string[],
): AddFileContentResult {
  if (typeof fileReadResult.llmContent === 'string') {
    return addTextFileContent(
      fileReadResult,
      filePath,
      relativePathForDisplay,
      skippedFiles,
      contentParts,
      limits,
      totalTokens,
      totalBytes,
      aggregateByteBudget,
      sortedFiles,
      processedFilesRelativePaths,
    );
  }

  // Non-text content (images/PDFs). No provider is available at the tool
  // layer, so image estimates use the provider-agnostic default family.
  const inlineData = fileReadResult.llmContent.inlineData;
  const estimatedTokens = estimateNonTextPartTokens(
    inlineData?.mimeType,
    inlineData?.data,
  );
  const contentBytes = Buffer.byteLength(inlineData?.data ?? '', 'utf8');

  if (totalTokens + estimatedTokens > limits.maxTokens) {
    skippedFiles.push({
      path: relativePathForDisplay,
      reason: 'would exceed token limit (non-text content)',
    });
    return { totalTokens, totalBytes, action: 'continue' };
  }
  if (totalBytes + contentBytes > aggregateByteBudget.bytes) {
    skippedFiles.push({
      path: relativePathForDisplay,
      reason: `would exceed aggregate byte budget (${aggregateByteBudget.bytes.toLocaleString('en-US')} bytes)`,
    });
    return { totalTokens, totalBytes, action: 'continue' };
  }
  totalTokens += estimatedTokens;
  totalBytes += contentBytes;
  contentParts.push(fileReadResult.llmContent);
  return { totalTokens, totalBytes, action: 'continue' };
}

function addTextFileContent(
  fileReadResult: ProcessedFileReadResult,
  filePath: string,
  relativePathForDisplay: string,
  skippedFiles: SkippedFilesArray,
  contentParts: Array<string | ContentPartUnion>,
  limits: ReadManyFilesLimits,
  totalTokens: number,
  totalBytes: number,
  aggregateByteBudget: ByteBudget,
  sortedFiles: string[],
  processedFilesRelativePaths: string[],
): AddFileContentResult {
  const separator = DEFAULT_OUTPUT_SEPARATOR_FORMAT.replace(
    '{filePath}',
    filePath,
  );
  let fileContentForLlm = '';

  if (fileReadResult.isTruncated === true) {
    fileContentForLlm += `[WARNING: This file was truncated. To view the full content, use the 'read_file' tool on this specific file.]\n\n`;
  }
  fileContentForLlm += fileReadResult.llmContent as string;
  const contentToAdd = `${separator}\n\n${fileContentForLlm}\n\n`;
  const contentTokens = estimateTokens(contentToAdd);
  const contentBytes = Buffer.byteLength(contentToAdd, 'utf8');

  const overTokens = totalTokens + contentTokens > limits.maxTokens;
  const overBytes = totalBytes + contentBytes > aggregateByteBudget.bytes;

  // The aggregate byte budget is the hard acquisition cap. Check it FIRST so
  // the final assembled output (content + terminator) can never exceed the
  // acquisition budget. Token overflow is a model-facing soft cap handled
  // only when the content fits within the byte budget.
  if (overBytes) {
    return handleByteOverflow(
      limits,
      relativePathForDisplay,
      sortedFiles,
      processedFilesRelativePaths,
      contentParts,
      contentToAdd,
      totalTokens,
      totalBytes,
      aggregateByteBudget,
      skippedFiles,
    );
  }
  if (overTokens) {
    return handleTokenOverflow(
      limits,
      relativePathForDisplay,
      sortedFiles,
      processedFilesRelativePaths,
      contentParts,
      contentToAdd,
      totalTokens,
      totalBytes,
      skippedFiles,
    );
  }

  totalTokens += contentTokens;
  totalBytes += contentBytes;
  contentParts.push(contentToAdd);
  return { totalTokens, totalBytes, action: 'continue' };
}

function handleTokenOverflow(
  limits: ReadManyFilesLimits,
  relativePathForDisplay: string,
  sortedFiles: string[],
  processedFilesRelativePaths: string[],
  contentParts: Array<string | ContentPartUnion>,
  contentToAdd: string,
  totalTokens: number,
  totalBytes: number,
  skippedFiles: SkippedFilesArray,
): AddFileContentResult {
  if (limits.truncateMode === 'warn') {
    skippedFiles.push({
      path: `${sortedFiles.length - processedFilesRelativePaths.length} remaining file(s)`,
      reason: `would exceed token limit of ${limits.maxTokens}`,
    });
    return { totalTokens, totalBytes, action: 'stop' };
  } else if (limits.truncateMode === 'truncate') {
    const remainingTokens = limits.maxTokens - totalTokens;
    if (remainingTokens > 100) {
      const marker = '\n\n[CONTENT TRUNCATED DUE TO TOKEN LIMIT]';
      // Model-facing token truncation: cut to the remaining token budget
      // (≈4 chars/token) using surrogate-safe UTF-16 truncation so a
      // surrogate pair is never split. Token policy stays separate from the
      // acquisition byte policy; the actual UTF-8 bytes are charged below.
      const maxChars = remainingTokens * 4 - Buffer.byteLength(marker, 'utf8');
      const truncatedContent = truncateUtf16Safe(contentToAdd, maxChars);
      const finalContent = truncatedContent + marker;
      contentParts.push(finalContent);
      const updatedTokens = totalTokens + estimateTokens(finalContent);
      // Charge the actual UTF-8 bytes (multibyte content can add more bytes
      // than the char count suggests). The terminator bytes are already
      // pre-charged in totalBytes by the caller.
      const updatedBytes = totalBytes + Buffer.byteLength(finalContent, 'utf8');
      skippedFiles.push({
        path: relativePathForDisplay,
        reason: 'content truncated to fit token limit',
      });
      return {
        totalTokens: updatedTokens,
        totalBytes: updatedBytes,
        action: 'stopAfterRecord',
      };
    }
    return { totalTokens, totalBytes, action: 'stop' };
  }
  skippedFiles.push({
    path: relativePathForDisplay,
    reason: 'skipped to stay within token limit',
  });
  return { totalTokens, totalBytes, action: 'continue' };
}

function handleByteOverflow(
  limits: ReadManyFilesLimits,
  relativePathForDisplay: string,
  sortedFiles: string[],
  processedFilesRelativePaths: string[],
  contentParts: Array<string | ContentPartUnion>,
  contentToAdd: string,
  totalTokens: number,
  totalBytes: number,
  aggregateByteBudget: ByteBudget,
  skippedFiles: SkippedFilesArray,
): AddFileContentResult {
  if (limits.truncateMode === 'warn') {
    skippedFiles.push({
      path: `${sortedFiles.length - processedFilesRelativePaths.length} remaining file(s)`,
      reason: `would exceed aggregate byte budget (${aggregateByteBudget.bytes.toLocaleString('en-US')} bytes)`,
    });
    return { totalTokens, totalBytes, action: 'stop' };
  } else if (limits.truncateMode === 'truncate') {
    const marker = '\n\n[CONTENT TRUNCATED DUE TO AGGREGATE BYTE BUDGET]';
    // Reserve room for the truncation marker only — the final output
    // terminator bytes are already pre-charged in totalBytes by the caller
    // so the assembled output stays within the aggregate byte budget.
    const reservedBytes = Buffer.byteLength(marker, 'utf8');
    const remainingBytes =
      aggregateByteBudget.bytes - totalBytes - reservedBytes;
    if (remainingBytes > 200) {
      const truncatedContent = truncateUtf8Safe(contentToAdd, remainingBytes);
      const finalContent = truncatedContent + marker;
      contentParts.push(finalContent);
      const updatedBytes = totalBytes + Buffer.byteLength(finalContent, 'utf8');
      const updatedTokens = totalTokens + estimateTokens(finalContent);
      skippedFiles.push({
        path: relativePathForDisplay,
        reason: 'content truncated to fit aggregate byte budget',
      });
      return {
        totalTokens: updatedTokens,
        totalBytes: updatedBytes,
        action: 'stopAfterRecord',
      };
    }
    skippedFiles.push({
      path: relativePathForDisplay,
      reason: 'skipped to stay within aggregate byte budget',
    });
    return { totalTokens, totalBytes, action: 'stop' };
  }
  skippedFiles.push({
    path: relativePathForDisplay,
    reason: 'skipped to stay within aggregate byte budget',
  });
  return { totalTokens, totalBytes, action: 'continue' };
}
