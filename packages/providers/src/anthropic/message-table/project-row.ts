/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ImageDimensionBudget } from '@vybestack/llxprt-code-tools/utils/imageDimensionBudget.js';
import { stripCrossModelThinking } from '../crossModelThinkingStrip.js';
import { sanitizeRowImages } from '../AnthropicImageSanitizer.js';

/** What decides how a stored row appears in the request. */
export interface RowProjection {
  readonly currentModel: string | undefined;
  readonly currentBaseURL: string | undefined;
  readonly logger: { debug: (fn: () => string) => void };
  /** Oversized base64 images are replaced when set; unset leaves them. */
  readonly imageBudget?: ImageDimensionBudget;
}

/**
 * The row as the request sees it: oversized images replaced and thinking
 * blocks of another model or endpoint removed, or `undefined` when nothing
 * is left of the row. Both rules are row-local, so every pass that needs to
 * know which rows survive (and where) calls this and gets the same answer.
 */
export function projectRow(
  row: IContent,
  projection: RowProjection,
): IContent | undefined {
  const sized = sanitizeRowImages(row, projection.imageBudget).row;
  const kept = stripCrossModelThinking(
    [sized],
    projection.currentModel,
    projection.currentBaseURL,
    projection.logger,
  );
  return kept.length === 0 ? undefined : kept[0];
}
