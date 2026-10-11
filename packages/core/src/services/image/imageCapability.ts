/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Normalized input accepted by the shared image-operation runner. */
export interface ImageOperationRunnerInput {
  readonly prompt: string;
  readonly outputPath: string;
  readonly inputPaths?: readonly string[];
  readonly signal?: AbortSignal;
}

/** Bounded result surfaced to capability consumers (no base64). */
export interface ImageOperationRunnerResult {
  readonly operation: 'generate' | 'edit';
  readonly absoluteOutputPath: string;
  readonly relativeOutputPath: string;
  readonly mimeType: string;
  readonly backend: string;
  readonly provider: string;
  readonly model: string;
  readonly inputPaths: readonly string[];
}

/**
 * The single shared image-operation entry point that `/image`, direct CLI
 * image mode, and the `generate_image` tool all converge on.
 */
export type ImageOperationRunner = (
  input: ImageOperationRunnerInput,
) => Promise<ImageOperationRunnerResult>;
