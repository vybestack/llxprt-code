/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ToolExecutionPolicy {
  readonly 'shell-replacement'?: unknown;
  readonly 'shell-output-retention-max-bytes'?: unknown;
  readonly 'shell-inactivity-timeout-seconds'?: unknown;
  readonly emojifilter?: unknown;
  readonly 'file-read-max-lines'?: unknown;
  readonly 'tool-output-max-items'?: unknown;
  readonly 'tool-output-max-tokens'?: unknown;
  readonly 'tool-output-truncate-mode'?: unknown;
  readonly 'tool-output-item-size-limit'?: unknown;
  readonly 'max-image-dimension'?: unknown;
  readonly 'max-image-pixels'?: unknown;
  readonly 'image-resize.enabled'?: unknown;
  readonly 'image-resize.maxLongEdge'?: unknown;
  readonly 'image-resize.maxShortEdge'?: unknown;
  readonly 'image-resize.maxPixels'?: unknown;
  readonly 'shell-default-timeout-seconds'?: unknown;
  readonly 'shell-max-timeout-seconds'?: unknown;
  readonly 'model.canSaveCore'?: unknown;
}
