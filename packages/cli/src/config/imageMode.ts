/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure image-mode detection and validation logic for the CLI.
 *
 * Image mode is selected when any of `--image-input`/`-I`, `--image-output`/`-O`,
 * or `--image-prompt`/`-P` is supplied. It requires both `--image-output` and
 * `--image-prompt`, is mutually exclusive with conversational prompts, and
 * rejects stream-json output. This module contains only pure logic so it is
 * fully testable without constructing the conversational agent loop.
 */

export const IMAGE_MODE_MAX_INPUTS = 5;

/**
 * Raw image-mode flags as parsed by yargs.
 */
export interface ImageModeFlags {
  readonly imageInput?: readonly string[];
  readonly imageOutput?: string;
  readonly imagePrompt?: string;
}

/**
 * Conflicting conversational flags that image mode must not combine with.
 */
export interface ImageModeConflicts {
  readonly positionalPrompt?: string;
  readonly prompt?: string;
  readonly promptInteractive?: string;
  readonly outputFormat?: string;
}

export interface ValidatedImageMode {
  readonly operation: 'generate' | 'edit';
  readonly outputPath: string;
  readonly prompt: string;
  readonly inputPaths: readonly string[];
}

/**
 * Error thrown when image-mode arguments are invalid or conflicting.
 */
export class ImageModeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageModeError';
  }
}

/**
 * Detect whether image mode is active based on the presence of any image flag.
 * Returns true if any image flag is present (without validating); the caller
 * then runs {@link validateImageModeArgs} to produce the structured request.
 */
export function isImageModeActive(flags: ImageModeFlags): boolean {
  return (
    flags.imageInput !== undefined ||
    flags.imageOutput !== undefined ||
    flags.imagePrompt !== undefined
  );
}

/**
 * Detect whether image mode is active. Returns the validated request, or null
 * when no image flags are present. Throws {@link ImageModeError} if image
 * flags are present but invalid (missing required flags, conflicts, etc.).
 */
export function detectImageMode(
  flags: ImageModeFlags,
  conflicts: ImageModeConflicts = {},
): ValidatedImageMode | null {
  if (!isImageModeActive(flags)) {
    return null;
  }
  return validateImageModeArgs(flags, conflicts);
}

/**
 * Validate image-mode arguments and return a structured request.
 *
 * Throws {@link ImageModeError} for missing required flags, conflicts with
 * conversational prompts, the five-input limit, non-png output, or stream-json.
 */
export function validateImageModeArgs(
  flags: ImageModeFlags,
  conflicts: ImageModeConflicts = {},
): ValidatedImageMode {
  const output = (flags.imageOutput ?? '').trim();
  const prompt = (flags.imagePrompt ?? '').trim();
  const inputs = flags.imageInput ?? [];

  // Conflict checks
  const conflictSources: string[] = [];
  if (
    conflicts.positionalPrompt !== undefined &&
    conflicts.positionalPrompt !== ''
  ) {
    conflictSources.push('a positional conversational prompt');
  }
  if (conflicts.prompt !== undefined && conflicts.prompt !== '') {
    conflictSources.push('--prompt/-p');
  }
  if (
    conflicts.promptInteractive !== undefined &&
    conflicts.promptInteractive !== ''
  ) {
    conflictSources.push('--prompt-interactive/-i');
  }
  if (conflictSources.length > 0) {
    throw new ImageModeError(
      `Image mode is mutually exclusive with ${conflictSources.join(', ')}.`,
    );
  }

  if (
    conflicts.outputFormat === 'stream-json' ||
    conflicts.outputFormat === 'stream_json'
  ) {
    throw new ImageModeError(
      'stream-json output is not supported for image mode.',
    );
  }

  if (output === '') {
    throw new ImageModeError('Image mode requires --image-output/-O <path>.');
  }
  if (prompt === '') {
    throw new ImageModeError('Image mode requires --image-prompt/-P <text>.');
  }

  if (!output.toLowerCase().endsWith('.png')) {
    throw new ImageModeError(
      `Image output path must end with .png (received "${output}").`,
    );
  }

  if (inputs.length > IMAGE_MODE_MAX_INPUTS) {
    throw new ImageModeError(
      `At most ${IMAGE_MODE_MAX_INPUTS} --image-input/-I flags are supported (received ${inputs.length}).`,
    );
  }

  const operation = inputs.length === 0 ? 'generate' : 'edit';

  return {
    operation,
    outputPath: output,
    prompt,
    inputPaths: [...inputs],
  };
}
