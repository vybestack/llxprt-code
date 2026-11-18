/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { CORE_DEFAULTS } from '../../prompt-config/defaults/core-defaults.js';
import { PromptResolutionError, type CompressionContext } from './types.js';

/**
 * Prompt files, relative to the prompts directory, that hold the compression
 * request text besides `compression.md`. Users override any of them by
 * placing a file at the same relative path (issue #4128).
 */
export const COMPRESSION_PROMPT_FILES = {
  securityPreamble: 'compression/security-preamble.md',
  trigger: 'compression/trigger.md',
  triggerWithPriorSnapshot: 'compression/trigger-with-prior-snapshot.md',
  verificationRequest: 'compression/verification-request.md',
  verificationFollowUp: 'compression/verification-follow-up.md',
} as const;

export type CompressionPromptFile =
  (typeof COMPRESSION_PROMPT_FILES)[keyof typeof COMPRESSION_PROMPT_FILES];

export type CompressionPromptSource = Pick<
  CompressionContext,
  'promptResolver' | 'promptBaseDir' | 'promptContext'
>;

/**
 * Load a compression prompt file: the user's override when the resolver
 * finds one in the prompts directory, otherwise the shipped default.
 */
export function loadCompressionPromptFile(
  source: CompressionPromptSource,
  relativePath: CompressionPromptFile,
): string {
  const resolved = source.promptResolver.resolveFile(
    source.promptBaseDir,
    relativePath,
    source.promptContext,
  );
  const content =
    resolved.found && resolved.path !== null
      ? readFileSync(resolved.path, 'utf-8')
      : CORE_DEFAULTS[relativePath];
  const text = content.trim();
  if (text === '') {
    throw new PromptResolutionError(relativePath, 'prompt file is empty');
  }
  return text;
}
