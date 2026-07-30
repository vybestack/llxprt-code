/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core';
import {
  ExitCodes,
  writeToStdout,
  writeToStderr,
} from '@vybestack/llxprt-code-core';
import { detectImageMode, ImageModeError } from './imageMode.js';
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
  return detectImageMode(
    {
      ...(argv.imageInput !== undefined && argv.imageInput.length > 0
        ? { imageInput: argv.imageInput }
        : {}),
      ...(argv.imageOutput !== undefined && argv.imageOutput.trim() !== ''
        ? { imageOutput: argv.imageOutput }
        : {}),
      ...(argv.imagePrompt !== undefined && argv.imagePrompt.trim() !== ''
        ? { imagePrompt: argv.imagePrompt }
        : {}),
    },
    {
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
    },
  );
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
  config: Config,
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

  const runImageOperation = resolveRunImageOperation(config);
  if (runImageOperation === null) {
    writeToStderr(
      'Image generation is unavailable: no image-capable backend is registered for the current profile.\n',
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

/**
 * Resolve the common image-operation runner bound to the Config composition
 * root via the typed public getter. Returns null when no image capability is
 * configured (capability-specific error path).
 */
function resolveRunImageOperation(
  config: Config,
):
  | ((input: {
      readonly prompt: string;
      readonly outputPath: string;
      readonly inputPaths: readonly string[];
      readonly signal?: AbortSignal;
    }) => Promise<DirectImageResult>)
  | null {
  // Resolve via the typed public getter only. A config without the getter
  // (or one exposing only a property) is treated as unavailable so the unsafe
  // property cast can never regress.
  if (typeof config.getRunImageOperation !== 'function') {
    return null;
  }
  const capability = config.getRunImageOperation();
  if (typeof capability !== 'function') {
    return null;
  }
  return (input) =>
    capability({
      prompt: input.prompt,
      outputPath: input.outputPath,
      inputPaths: input.inputPaths,
      ...(input.signal !== undefined ? { signal: input.signal } : {}),
    });
}

export { ImageModeError };
