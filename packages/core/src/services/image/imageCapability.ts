/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The public image-operation capability contract exposed on `Config`.
 *
 * Declared once here and reused by the Config composition root, the CLI UI
 * runtime, and the `/image` command so the three consumers cannot drift.
 * It is deliberately narrower than {@link ImageOperationResult}: it carries
 * only the bounded path/identity metadata, never the base64 media payload.
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
