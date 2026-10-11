/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ImageOperationRunner } from '@vybestack/llxprt-code-core';
import {
  ExitCodes,
  writeToStdout,
  writeToStderr,
} from '@vybestack/llxprt-code-core';
import {
  detectImageMode,
  ImageModeError,
  type ImageModeFlags,
} from './imageMode.js';
import type { ParsedCliArgs } from '../cliBootstrap.js';

/**
 * The bounded image-operation result surfaced by the direct CLI image path.
 * Mirrors the subset of the common `ImageOperationResult` needed for text/json
 * output. No base64 is ever emitted.
 */
export interface DirectImageResult {
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
 * Map parsed CLI args onto the pure {@link ImageModeFlags} shape.
 *
 * Shared by direct image-mode dispatch and by the CLI entry point's decision to
 * bypass the conversational stdin guard, so both agree on exactly when image
 * mode is active. Empty/blank values are treated as absent.
 */
export function buildImageModeFlags(argv: ParsedCliArgs): ImageModeFlags {
  return {
    ...(argv.imageInput !== undefined && argv.imageInput.length > 0
      ? { imageInput: argv.imageInput }
      : {}),
    ...(argv.imageOutput !== undefined && argv.imageOutput.trim() !== ''
      ? { imageOutput: argv.imageOutput }
      : {}),
    ...(argv.imagePrompt !== undefined && argv.imagePrompt.trim() !== ''
      ? { imagePrompt: argv.imagePrompt }
      : {}),
  };
}

/**
 * Resolve the direct-image-mode request from parsed CLI args, or null when
 * image mode is not active. Throws {@link ImageModeError} when image flags are
 * present but invalid (missing required, conflicts, stream-json).
 *
 * Uses the REAL detectImageMode validator against the REAL parsed args so the
 * parser/dispatch behavior is exercised, not a manually-constructed literal.
 */
export function resolveDirectImageMode(
  argv: ParsedCliArgs,
): ReturnType<typeof detectImageMode> {
  return detectImageMode(buildImageModeFlags(argv), {
    ...(argv.prompt !== undefined && argv.prompt !== ''
      ? { prompt: argv.prompt }
      : {}),
    ...(argv.promptInteractive !== undefined && argv.promptInteractive !== ''
      ? { promptInteractive: argv.promptInteractive }
      : {}),
    positionalPrompt:
      argv.promptWords !== undefined &&
      argv.promptWords.length > 0 &&
      argv.promptWords.some((w) => w.trim() !== '')
        ? argv.promptWords.join(' ')
        : undefined,
    ...(argv.outputFormat !== undefined
      ? { outputFormat: argv.outputFormat }
      : {}),
  });
}

function formatJsonResult(result: DirectImageResult): string {
  return JSON.stringify({
    operation: result.operation,
    output_path: result.absoluteOutputPath,
    relative_output_path: result.relativeOutputPath,
    mime_type: result.mimeType,
    backend: result.backend,
    provider: result.provider,
    model: result.model,
    input_paths: result.inputPaths,
  });
}

function formatTextResult(result: DirectImageResult): string {
  const verb = result.operation === 'generate' ? 'Generated' : 'Edited';
  return `${verb} image via ${result.backend} (${result.model}).
Saved to: ${result.absoluteOutputPath}`;
}

/**
 * Execute the direct image-mode operation end-to-end against the REAL common
 * image-operation service resolved from the Config composition root, then emit
 * the configured output format (text or json) and exit.
 *
 * Never emits base64. Rejects stream-json (validated upstream). Returns the
 * process exit code so callers/tests can assert nonzero on failure/cancellation.
 *
 * Cleanup ownership: this function does NOT call runExitCleanup; the CLI entry
 * point (cli.tsx) owns the single exit-path cleanup so it runs exactly once.
 */
export async function runDirectImageModeAndExit(
  argv: ParsedCliArgs,
  runImageOperation: ImageOperationRunner | undefined,
): Promise<number | null> {
  let request;
  try {
    request = resolveDirectImageMode(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeToStderr(`${message}\n`);
    return ExitCodes.FATAL_INPUT_ERROR;
  }
  if (request === null) {
    return null;
  }

  if (runImageOperation === undefined) {
    writeToStderr(
      'Image generation is unavailable. It uses your Codex account and works ' +
        'with any provider, so this usually means Codex OAuth is not set up. ' +
        'Start llxprt and run "/auth codex enable" to sign in, then retry.\n',
    );
    return ExitCodes.FATAL_CONFIG_ERROR;
  }

  const outputFormat = argv.outputFormat ?? 'text';
  // Wire SIGINT to a cancellation controller so the common runner/backend can
  // abort the provider request and write promptly. Follows the established
  // nonInteractiveCli cancellation pattern.
  const controller = new AbortController();
  const onSigInt = () => controller.abort();
  process.once('SIGINT', onSigInt);
  let exitCode = 0;
  try {
    const result = await runImageOperation({
      prompt: request.prompt,
      outputPath: request.outputPath,
      inputPaths: request.inputPaths,
      signal: controller.signal,
    });

    const output =
      outputFormat === 'json'
        ? formatJsonResult(result)
        : formatTextResult(result);
    writeToStdout(`${output}\n`);
  } catch (error) {
    exitCode = 1;
    const message = error instanceof Error ? error.message : String(error);
    if (outputFormat === 'json') {
      writeToStdout(
        `${JSON.stringify({ error: 'image_operation_failed', message })}\n`,
      );
    } else {
      writeToStderr(`Image ${request.operation} failed: ${message}\n`);
    }
  } finally {
    process.removeListener('SIGINT', onSigInt);
  }
  return exitCode;
}

export { ImageModeError };
