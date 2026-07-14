/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Phase-local observer helpers for the client-contract characterization
 * tests (P20). This module is the SINGLE sanctioned boundary that reads
 * the current client-surface contract output — the characterization tests
 * read observable values ONLY through these helpers so that
 * `.candidates`/`.parts`/`.content.parts`/`.usageMetadata` indexing never
 * leaks into the test files.
 *
 * Current state (post-P21):
 *  - `generateDirectMessage` returns `ModelOutput` (neutral, post-P13).
 *    `visibleText`/`usageCounts` read `content.blocks` / `usage`.
 *  - `getHistory()` returns `IContent[]` (neutral, post-P21).
 *    `historyContent` returns a deep clone of the neutral history so the
 *    spec asserts content-equivalence and clone-independence.
 *  - `sendMessageStream` yields `ServerAgentStreamEvent`.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P20
 * @requirement:REQ-INT-001.2
 */

import type {
  IContent,
  ContentBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';

// ---------------------------------------------------------------------------
// Structural local types — the helper never exports a Contract* / candidate
// / parts / usageMetadata value. These local shapes let the helper accept
// the current envelope without coupling the spec to provider internals.
// ---------------------------------------------------------------------------

/**
 * Local structural view of `ModelOutput` (the current
 * `generateDirectMessage` return type). Only the observable fields the
 * helper reads are modeled.
 */
interface ModelOutputLike {
  content?: { blocks?: ContentBlock[] };
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    reasoningTokens?: number;
  } | null;
}

function isModelOutputLike(result: unknown): result is ModelOutputLike {
  return result !== null && typeof result === 'object';
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

// ---------------------------------------------------------------------------
// Observer: visible text from a direct-message result
// ---------------------------------------------------------------------------

/**
 * The model's visible text extracted from the neutral `content.blocks`
 * text blocks (concatenation of all text-type block text). Reads the
 * current `ModelOutput.content.blocks` surface ONLY — never
 * `.candidates`/`.parts`.
 */
export function visibleText(directResult: unknown): string {
  if (!isModelOutputLike(directResult)) {
    return '';
  }
  const blocks = directResult.content?.blocks;
  if (!Array.isArray(blocks)) {
    return '';
  }
  return blocks
    .filter(
      (block) =>
        block.type === 'text' &&
        typeof block.text === 'string' &&
        block.text !== '',
    )
    .map((block) => (block as { text: string }).text)
    .join('');
}

// ---------------------------------------------------------------------------
// Observer: history as neutral IContent[] (deep clone)
// ---------------------------------------------------------------------------

/**
 * Returns a DEEP CLONE of the neutral `IContent[]` history from
 * `getHistory()` so callers can freely inspect/mutate without touching
 * the live contract value. Post-P21, `getHistory()` returns `IContent[]`
 * directly, so this is a pass-through clone (no provider conversion).
 */
export function historyContent(historyResult: unknown): IContent[] {
  if (!Array.isArray(historyResult)) {
    return [];
  }
  // Post-P21: getHistory() returns neutral IContent[] directly — no
  // conversion needed, just a defensive deep clone.
  const neutral = historyResult as IContent[];
  return neutral.map((entry) => structuredClone(entry));
}

// ---------------------------------------------------------------------------
// Observer: neutral usage counts from a direct-message result
// ---------------------------------------------------------------------------

export interface NeutralUsageCounts {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
}

/**
 * Neutral usage numbers read from the `ModelOutput.usage` field. Never
 * reads `.usageMetadata` (the Gemini-named envelope) — only the neutral
 * `usage` object on `ModelOutput`.
 */
export function usageCounts(directResult: unknown): NeutralUsageCounts {
  if (!isModelOutputLike(directResult) || directResult.usage == null) {
    return {};
  }
  const usage = directResult.usage;
  return {
    promptTokens: readNumber(usage.promptTokens),
    completionTokens: readNumber(usage.completionTokens),
    totalTokens: readNumber(usage.totalTokens),
    reasoningTokens: readNumber(usage.reasoningTokens),
  };
}

// ---------------------------------------------------------------------------
// Observer: ServerAgentStreamEvent type sequence
// ---------------------------------------------------------------------------

/**
 * The public `ServerAgentStreamEvent` `type` sequence. Reads ONLY the
 * `.type` discriminator — never event-internal payload fields.
 */
export function eventSequence(
  events: ReadonlyArray<{ type: string }>,
): string[] {
  return events.map((event) => event.type);
}
