/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

/**
 * Drop model-bound thinking blocks from an AI turn, preserving all other
 * blocks. Returns undefined when the turn becomes empty after stripping
 * (thinking-only turn with no visible output).
 */
function buildStrippedAiTurn(
  content: IContent,
  turnModel: string,
  currentModel: string,
  logger: { debug: (fn: () => string) => void },
): IContent | undefined {
  const filteredBlocks = content.blocks.filter(
    (b) => !(b.type === 'thinking' && b.sourceField === 'thinking'),
  );

  if (filteredBlocks.length === 0) {
    logger.debug(
      () =>
        `Dropping cross-model thinking-only AI turn (origin ${turnModel}, current ${currentModel})`,
    );
    return undefined;
  }

  return { ...content, blocks: filteredBlocks };
}

/**
 * Determine whether an AI turn's model-bound thinking blocks are foreign to
 * the current request. Returns true when ANY of these conditions hold:
 *  1. The turn's `metadata.model` is set and differs from `currentModel`.
 *  2. The turn's `metadata.providerBaseURL` is set and differs from
 *     `currentBaseURL` (same model name served by a different endpoint,
 *     e.g. z.ai vs native Anthropic — issue #1469).
 *
 * Turns without origin stamps (no model, no baseURL) are left untouched:
 * they predate the stamping fix and we cannot determine their true origin.
 * Stripping them would lose potentially valid same-model reasoning, so the
 * conservative choice is to preserve them (same behavior as #2335).
 *
 * Returns false for non-AI turns or turns without model-bound thinking blocks.
 */
function isForeignThinkingTurn(
  content: IContent,
  currentModel: string,
  currentBaseURL: string | undefined,
): boolean {
  if (content.speaker !== 'ai') {
    return false;
  }

  const hasModelBoundThinking = content.blocks.some(
    (b) => b.type === 'thinking' && b.sourceField === 'thinking',
  );
  if (!hasModelBoundThinking) {
    return false;
  }

  const turnModel = content.metadata?.model;
  const turnBaseURL = content.metadata?.providerBaseURL;

  if (turnModel !== undefined && turnModel !== currentModel) {
    return true;
  }

  if (
    currentBaseURL &&
    turnBaseURL !== undefined &&
    turnBaseURL !== currentBaseURL
  ) {
    return true;
  }

  return false;
}

/**
 * Drop model-bound thinking blocks from AI turns whose originating model or
 * endpoint differs from the current request. Anthropic thinking-block
 * signatures are cryptographically bound to the model AND endpoint that
 * produced them; replaying a foreign signature triggers a 400
 * "Invalid signature in thinking block".
 *
 * Only blocks with `sourceField === 'thinking'` are model-bound — those are
 * the ones converted into `thinking`/`redacted_thinking` API blocks. Thinking
 * blocks from other sources become plain text and are harmless cross-model.
 *
 * When `currentModel` is undefined the function is a no-op (backward compat).
 * Turns without origin stamps are left untouched (see isForeignThinkingTurn).
 *
 * @issue #2335 — cross-model thinking strip
 * @issue #1469 — cross-endpoint thinking strip
 */
export function stripCrossModelThinking(
  contents: IContent[],
  currentModel: string | undefined,
  currentBaseURL: string | undefined,
  logger: { debug: (fn: () => string) => void },
): IContent[] {
  if (!currentModel) {
    return contents;
  }

  const result: IContent[] = [];

  for (const content of contents) {
    if (!isForeignThinkingTurn(content, currentModel, currentBaseURL)) {
      result.push(content);
      continue;
    }

    const stripped = buildStrippedAiTurn(
      content,
      content.metadata?.model ?? '<unknown>',
      currentModel,
      logger,
    );
    if (stripped) {
      result.push(stripped);
    }
  }

  return result;
}
