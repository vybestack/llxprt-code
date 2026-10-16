/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  PromptEstimatorFiles,
  type PromptEstimate,
} from '../runtime/prompt-estimator-files.js';
import { createMediaSupportPredicate } from './AnthropicEndpointUtils.js';

/** What an Anthropic projection owns: its prompt files and the media it dropped. */
export type AnthropicPromptEstimate = PromptEstimate;

/**
 * The prompt files of an Anthropic body (`system`, `messages` and `tools`).
 * The media the endpoint cannot carry is listed as unsupported.
 */
export function createAnthropicEstimatorFiles(
  model: string,
  signal: AbortSignal | undefined,
  dump: boolean,
  baseURL: string | undefined,
): PromptEstimatorFiles {
  return new PromptEstimatorFiles({
    protocol: 'anthropic-messages',
    scratchPrefix: 'anthropic-prompt-keys-',
    model,
    signal,
    dump,
    isSupportedMedia: createMediaSupportPredicate(baseURL),
  });
}
