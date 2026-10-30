/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Proactive cumulative image-payload budget enforcement.
 *
 * When a model issues parallel tool calls that each return image data
 * (e.g. multiple `read_file` calls on PNG/JPEG files), the assembled
 * tool-response blocks can exceed the provider's maximum request size,
 * producing an HTTP 413 ("request_too_large") error.
 *
 * This module provides pure utilities to measure the wire size of image
 * content across an ordered `ContentBlock[]` and enforce a conservative
 * cumulative budget, omitting over-budget images and producing actionable
 * feedback so the model can request fewer images per call, or a smaller
 * version of an image that cannot fit under the budget on its own.
 *
 * The budget is measured on the **base64-encoded** string length, which is
 * the actual wire size sent in the JSON request payload (not the decoded
 * byte count).  Base64 encoding inflates the raw data by ~33 %, so the
 * budget ceiling must account for this inflation when derived from a
 * provider's hard request-size limit.
 */

import {
  isMediaReferenceBlock,
  type ContentBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { DEFAULT_IMAGE_PAYLOAD_BUDGET_BYTES } from '@vybestack/llxprt-code-core/config/configTypes.js';

export { DEFAULT_IMAGE_PAYLOAD_BUDGET_BYTES };

/**
 * Why an image was omitted. The remedy differs: aggregate overflow is fixed by
 * reading fewer images per batch; an image larger than the whole budget can
 * never fit and must be made smaller.
 */
export type OmissionReason = 'aggregate-budget' | 'exceeds-budget-alone';

/**
 * Metadata for a single image that was omitted because the cumulative
 * budget was exceeded.
 */
export interface OmittedImage {
  /** Name of the tool that produced the image, if known from context. */
  readonly toolName: string | undefined;
  /** Call ID of the preceding `tool_response`, if any. */
  readonly callId: string | undefined;
  /** File label carried by the media block, if any. */
  readonly filename: string | undefined;
  /** MIME type of the image, if available. */
  readonly mimeType: string | undefined;
  /** Encoded wire size (base64 length) of the omitted image. */
  readonly sizeBytes: number;
  /** Whether the batch overflowed or the image is oversize by itself. */
  readonly reason: OmissionReason;
}

/**
 * Result of enforcing the image-payload budget on a `ContentBlock[]`.
 */
export interface BudgetEnforcementResult {
  /** Blocks with over-budget images removed. */
  readonly blocks: ContentBlock[];
  /** Images that were omitted, with metadata for feedback. */
  readonly omitted: readonly OmittedImage[];
  /** Total base64 bytes of images that were retained. */
  readonly totalImageBytes: number;
}

function isImageMimeType(mimeType: unknown): boolean {
  return (
    typeof mimeType === 'string' && mimeType.toLowerCase().startsWith('image/')
  );
}

/**
 * Returns the encoded (base64) wire size of an image `MediaBlock`, for both
 * inline data and validated stored-media references, or 0 for anything that
 * is not an image.
 */
export function getImageEncodedSize(block: ContentBlock): number {
  if (block.type !== 'media' || !isImageMimeType(block.mimeType)) {
    return 0;
  }
  if (isMediaReferenceBlock(block)) {
    return block.normalizedBase64Length;
  }
  return getImageInlineDataSize(block);
}

/**
 * Returns the wire size (base64 string length) of an inline image
 * `MediaBlock`, or 0 for non-image blocks and stored-media references.
 */
export function getImageInlineDataSize(block: ContentBlock): number {
  if (block.type !== 'media') {
    return 0;
  }
  if (
    typeof block.data === 'string' &&
    block.data.length > 0 &&
    isImageMimeType(block.mimeType)
  ) {
    return block.data.length;
  }
  return 0;
}

/**
 * Walks an ordered `ContentBlock[]` and enforces a cumulative image-payload
 * budget.
 *
 * Images are retained in order until adding the next image would exceed
 * `budgetBytes`.  Once the budget is exceeded, all subsequent images are
 * omitted regardless of their individual size.
 *
 * Non-image blocks (text, tool_response, etc.) are always retained.
 *
 * The function tracks the most recent `tool_response` name and call ID so
 * each omitted image can be associated with the call that produced it.  An
 * omitted image is classified as exceeding the budget alone whenever its own
 * size is above `budgetBytes`, even if the budget was already exhausted.
 */
export function enforceImageBudget(
  blocks: ContentBlock[],
  budgetBytes: number,
): BudgetEnforcementResult {
  if (!Number.isFinite(budgetBytes) || budgetBytes <= 0) {
    const retainedImageBytes = blocks.reduce(
      (sum, block) => sum + getImageEncodedSize(block),
      0,
    );
    return { blocks, omitted: [], totalImageBytes: retainedImageBytes };
  }

  const result: ContentBlock[] = [];
  const omitted: OmittedImage[] = [];
  let runningTotal = 0;
  let budgetExhausted = false;
  let currentToolName: string | undefined;
  let currentCallId: string | undefined;

  for (const block of blocks) {
    if (block.type === 'tool_response') {
      currentToolName = block.toolName;
      currentCallId = block.callId;
    }

    const imageSize = getImageEncodedSize(block);
    if (block.type !== 'media' || imageSize === 0) {
      result.push(block);
      continue;
    }

    if (budgetExhausted || runningTotal + imageSize > budgetBytes) {
      budgetExhausted = true;
      omitted.push({
        toolName: currentToolName,
        callId: currentCallId,
        filename: block.filename,
        mimeType: block.mimeType,
        sizeBytes: imageSize,
        reason:
          imageSize > budgetBytes ? 'exceeds-budget-alone' : 'aggregate-budget',
      });
    } else {
      runningTotal += imageSize;
      result.push(block);
    }
  }

  return { blocks: result, omitted, totalImageBytes: runningTotal };
}

/**
 * Feedback is model-visible text added to the request, so its size must not
 * grow with the number of omitted images or the length of their labels. The
 * omitted images themselves are never dropped from the accounting: the header
 * count covers all of them and each category reports how many were not listed.
 */
const MAX_LISTED_PER_CATEGORY = 20;
const MAX_LABEL_LENGTH = 64;

function boundedLabel(label: string): string {
  const characters = [...label];
  return characters.length <= MAX_LABEL_LENGTH
    ? label
    : `${characters.slice(0, MAX_LABEL_LENGTH).join('')}...`;
}

function describeOmittedImage(img: OmittedImage): string {
  const identity = [
    img.filename === undefined || img.filename === ''
      ? undefined
      : `file ${boundedLabel(img.filename)}`,
    img.toolName === undefined || img.toolName === ''
      ? undefined
      : `tool ${boundedLabel(img.toolName)}`,
    img.callId === undefined || img.callId === ''
      ? undefined
      : `call ${boundedLabel(img.callId)}`,
  ].filter((part): part is string => part !== undefined);
  const subject = identity.length > 0 ? identity.join(', ') : 'unidentified';
  return `- ${subject}: ${img.mimeType ?? 'unknown type'}, ${img.sizeBytes} encoded bytes`;
}

function describeOmittedImages(images: readonly OmittedImage[]): string {
  const lines = images
    .slice(0, MAX_LISTED_PER_CATEGORY)
    .map(describeOmittedImage);
  const unlisted = images.length - lines.length;
  if (unlisted > 0) {
    lines.push(`- and ${unlisted} more omitted images not listed`);
  }
  return lines.join('\n');
}

/**
 * Builds a human-readable feedback message for the model when images are
 * omitted due to the cumulative budget being exceeded.  Aggregate overflow and
 * images that cannot fit alone get different remedies.
 */
export function buildOmissionFeedback(
  omitted: readonly OmittedImage[],
  budgetBytes: number,
): string {
  const aggregate = omitted.filter((img) => img.reason === 'aggregate-budget');
  const oversize = omitted.filter(
    (img) => img.reason === 'exceeds-budget-alone',
  );

  const sections = [
    `System: ${omitted.length} image(s) were omitted because the encoded ` +
      `image payload limit for one tool result batch is ${budgetBytes} bytes.`,
  ];
  if (aggregate.length > 0) {
    sections.push(
      `Omitted because the batch exceeded the limit:\n` +
        `${describeOmittedImages(aggregate)}\n` +
        `Request fewer images per call or read them in smaller batches ` +
        `to stay within the limit.`,
    );
  }
  if (oversize.length > 0) {
    sections.push(
      `Cannot fit alone (larger than the ${budgetBytes}-byte limit by ` +
        `itself):\n${describeOmittedImages(oversize)}\n` +
        `These images cannot fit alone. Provide a resized or cropped, ` +
        `smaller version.`,
    );
  }
  return sections.join('\n');
}
