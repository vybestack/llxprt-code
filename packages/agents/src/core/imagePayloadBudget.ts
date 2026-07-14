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
 * feedback so the model can re-read them individually.
 *
 * The budget is measured on the **base64-encoded** string length, which is
 * the actual wire size sent in the JSON request payload (not the decoded
 * byte count).  Base64 encoding inflates the raw data by ~33 %, so the
 * budget ceiling must account for this inflation when derived from a
 * provider's hard request-size limit.
 */

import type {
  ContentBlock,
  MediaBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { DEFAULT_IMAGE_PAYLOAD_BUDGET_BYTES } from '@vybestack/llxprt-code-core/config/configTypes.js';

export { DEFAULT_IMAGE_PAYLOAD_BUDGET_BYTES };

/**
 * Metadata for a single image that was omitted because the cumulative
 * budget was exceeded.
 */
export interface OmittedImage {
  /** Name of the tool that produced the image, if known from context. */
  readonly toolName: string | undefined;
  /** MIME type of the image, if available. */
  readonly mimeType: string | undefined;
  /** Wire size (base64 string length) of the omitted image. */
  readonly sizeBytes: number;
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

/**
 * Returns the wire size (base64 string length) of an image `MediaBlock`,
 * or 0 for non-image blocks.
 */
export function getImageInlineDataSize(block: ContentBlock): number {
  if (block.type !== 'media') {
    return 0;
  }
  if (
    typeof block.data === 'string' &&
    block.data.length > 0 &&
    typeof block.mimeType === 'string' &&
    block.mimeType.toLowerCase().startsWith('image/')
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
 * The function tracks the most recent `tool_response` name so each
 * omitted image can be associated with the tool that produced it.
 */
export function enforceImageBudget(
  blocks: ContentBlock[],
  budgetBytes: number,
): BudgetEnforcementResult {
  if (!Number.isFinite(budgetBytes) || budgetBytes <= 0) {
    return { blocks, omitted: [], totalImageBytes: 0 };
  }

  const result: ContentBlock[] = [];
  const omitted: OmittedImage[] = [];
  let runningTotal = 0;
  let budgetExhausted = false;
  let currentToolName: string | undefined;

  for (const block of blocks) {
    if (block.type === 'tool_response') {
      currentToolName = block.toolName;
    }

    const imageSize = getImageInlineDataSize(block);
    if (imageSize === 0) {
      result.push(block);
      continue;
    }

    if (budgetExhausted || runningTotal + imageSize > budgetBytes) {
      budgetExhausted = true;
      omitted.push({
        toolName: currentToolName,
        mimeType: (block as MediaBlock).mimeType,
        sizeBytes: imageSize,
      });
    } else {
      runningTotal += imageSize;
      result.push(block);
    }
  }

  return { blocks: result, omitted, totalImageBytes: runningTotal };
}

/**
 * Builds a human-readable feedback message for the model when images are
 * omitted due to the cumulative budget being exceeded.
 */
export function buildOmissionFeedback(
  omitted: readonly OmittedImage[],
): string {
  const toolNames = [
    ...new Set(
      omitted
        .map((img) => img.toolName)
        .filter(
          (name): name is string => typeof name === 'string' && name.length > 0,
        ),
    ),
  ];
  const toolList =
    toolNames.length > 0 ? ` (tools: ${toolNames.join(', ')})` : '';

  return (
    `System: ${omitted.length} image(s) were omitted because the cumulative ` +
    `image payload would exceed the request size limit${toolList}. ` +
    `Please re-read the images one at a time or in smaller batches to stay ` +
    `within the limit.`
  );
}
