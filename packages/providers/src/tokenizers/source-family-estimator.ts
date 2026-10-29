/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  RuntimePromptEstimateRequest,
  RuntimePromptEstimateResult,
  RuntimeTokenizerFactory,
} from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import type { Gpt56SourceProjection } from './gpt56-source-projection.js';
import { countLegacyPromptTokens } from './legacy-source-estimate.js';
import { SourceFamilyInput } from './source-family-input.js';

/**
 * Estimate a sealed disk prompt through the factory's family registry for
 * models whose tokenizer is not the pinned o200k disk counter (official,
 * Claude-calibrated and legacy families).
 *
 * The registry receives a {@link SourceFamilyInput}, not a prompt string, so
 * each family reads the sealed segments the way its tokenizer allows:
 *
 * - Claude-calibrated families spool the prompt text to a scratch file, count
 *   it with the chunked o200k counter and add additive content signals.
 * - Official families (kimi, glm, minimax) count each segment in bounded
 *   chunks cut at exact pre-tokenizer boundaries.
 * - Unregistered and unresolved models use the legacy heuristic through a
 *   streaming equivalent (special-string scan, then the chunked o200k count).
 *
 * Only a scalar result is returned and nothing is retained after the call.
 */
export async function estimateSourceThroughFamilyRegistry(
  request: RuntimePromptEstimateRequest,
  projection: Gpt56SourceProjection,
  factory: RuntimeTokenizerFactory,
  workspaceDirectory: string,
  signal?: AbortSignal,
): Promise<RuntimePromptEstimateResult> {
  const release = projection.acquire();
  try {
    signal?.throwIfAborted();
    const input = new SourceFamilyInput(
      projection,
      release,
      workspaceDirectory,
      signal,
    );
    return await factory.estimatePrompt({
      ...request,
      finalizedProjection: input,
      legacyEstimate: () => countLegacyPromptTokens(input),
    });
  } finally {
    await release();
  }
}
