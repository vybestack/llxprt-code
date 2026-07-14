/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Phase-local observer helpers for the direct-message characterization
 * tests (P12/P13). This module is the SINGLE sanctioned boundary that reads
 * the neutral `ModelOutput` surface — the characterization tests read
 * observable values ONLY through these helpers so that block/usage indexing
 * never leaks into the test files.
 *
 * P13 flipped `generateDirectMessage` to return `ModelOutput`; these helpers
 * read `content.blocks` (text blocks) and the neutral `usage` field. The
 * tests stay green because they assert observable values (visible text,
 * committed history, usage counts), never the envelope shape.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P12
 * @plan:PLAN-20260707-AGENTNEUTRAL.P13
 * @requirement:REQ-INT-001.3
 */

import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type {
  IContent,
  ContentBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ModelOutput } from '@vybestack/llxprt-code-core/llm-types/index.js';

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

/**
 * The model's visible text extracted from the neutral `content.blocks`
 * text blocks (concatenation of all text-type block text).
 */
export function visibleText(result: unknown): string {
  if (!isModelOutputLike(result)) {
    return '';
  }
  const blocks = result.content?.blocks;
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

/**
 * A deep clone of the committed neutral `HistoryService` state (already
 * `IContent`-based today).
 */
export function committedHistory(historyService: HistoryService): IContent[] {
  return historyService.getAll().map((entry) => structuredClone(entry));
}

export interface NeutralUsageCounts {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
}

/**
 * Neutral usage numbers read from the `ModelOutput.usage` field.
 */
export function usageCounts(result: unknown): NeutralUsageCounts {
  if (!isModelOutputLike(result) || result.usage == null) {
    return {};
  }
  const usage = result.usage;
  return {
    promptTokens: readNumber(usage.promptTokens),
    completionTokens: readNumber(usage.completionTokens),
    totalTokens: readNumber(usage.totalTokens),
    reasoningTokens: readNumber(usage.reasoningTokens),
  };
}

/**
 * The public `ServerAgentStreamEvent` `type` sequence.
 */
export function eventSequence(events: Array<{ type: string }>): string[] {
  return events.map((event) => event.type);
}

export type { ModelOutput };
