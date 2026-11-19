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
 * request text. Users override any of them by placing a file at the same
 * relative path (issue #4128).
 */
export const COMPRESSION_PROMPT_FILES = {
  instructions: 'compression.md',
  securityPreamble: 'compression/security-preamble.md',
  trigger: 'compression/trigger.md',
  triggerWithPriorSnapshot: 'compression/trigger-with-prior-snapshot.md',
  verificationRequest: 'compression/verification-request.md',
  verificationFollowUp: 'compression/verification-follow-up.md',
  activeTodos: 'compression/active-todos.md',
  transcriptPath: 'compression/transcript-path.md',
  largeLastPrompt: 'compression/large-last-prompt.md',
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

/**
 * Load a compression prompt file that carries runtime data and replace its
 * `{{placeholder}}` with `value`. The value is inserted literally. A file
 * without the placeholder would silently drop the data, so it is rejected.
 */
export function fillCompressionPromptFile(
  source: CompressionPromptSource,
  relativePath: CompressionPromptFile,
  placeholder: string,
  value: string,
): string {
  const template = loadCompressionPromptFile(source, relativePath);
  const token = `{{${placeholder}}}`;
  if (!template.includes(token)) {
    throw new PromptResolutionError(
      relativePath,
      `prompt file must contain ${token}`,
    );
  }
  return template.split(token).join(value);
}
