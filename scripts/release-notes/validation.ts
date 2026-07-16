/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  llmOutputSchema,
  type CategorizedBullets,
  type ChangeEntry,
  type LlmOutput,
} from './types.js';
import { sanitizeMarkdown } from './markdown.js';
import { buildFallbackHighlights, validateSelection } from './provenance.js';
import {
  deriveEffectiveCategory,
  shouldDemoteFromProminent,
} from './classification.js';

const MAX_HIGHLIGHTS = 6;

/**
 * Strips Markdown code fences from raw LLM output before JSON parsing.
 */
function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) {
    return trimmed;
  }
  const contentStart = trimmed.indexOf('\n');
  const contentEnd = trimmed.lastIndexOf('```');
  if (contentStart === -1 || contentEnd <= contentStart) {
    return trimmed;
  }
  return trimmed.slice(contentStart + 1, contentEnd).trim();
}

/**
 * Validates raw LLM output as a highlight selection (sourceIds only).
 * The model selects eligible source IDs; final text is constructed
 * deterministically from validated SourceFacts — never from free-form
 * prose. Returns null when the output is malformed or invalid.
 */
export function validateLlmOutput(raw: string): LlmOutput | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(raw));
  } catch {
    return null;
  }
  const result = llmOutputSchema.safeParse(parsed);
  if (!result.success) {
    return null;
  }
  return result.data;
}

/**
 * Validates the model's highlight selection against eligible entries with
 * defensible impact. Returns the validated source ID list, or null when
 * the selection is invalid.
 */
export function validateHighlights(
  selection: readonly string[],
  eligibleEntries: readonly ChangeEntry[],
): readonly string[] | null {
  return validateSelection(selection, eligibleEntries);
}

function displayTitle(entry: ChangeEntry): string {
  const enrichedTitle = entry.enriched.find(
    (ref) => ref.title.trim().length > 0,
  )?.title;
  return sanitizeMarkdown(enrichedTitle?.trim() ?? entry.subject);
}

export function entriesToCategorizedBullets(
  entries: readonly ChangeEntry[],
): CategorizedBullets {
  const categorized: {
    new: string[];
    improvements: string[];
    fixes: string[];
    breaking: string[];
  } = { new: [], improvements: [], fixes: [], breaking: [] };
  for (const entry of entries) {
    // Internal labels demote entries out of prominent categories entirely,
    // not just from highlights.
    if (shouldDemoteFromProminent(entry.enriched)) {
      continue;
    }
    // Derive the effective category with internal-label precedence and
    // promoting-label promotion so that the rendered category reflects
    // labels, not just the commit prefix.
    const effectiveCategory = deriveEffectiveCategory(
      entry.category,
      entry.enriched,
    );
    const title = displayTitle(entry);
    switch (effectiveCategory) {
      case 'new':
        categorized.new.push(title);
        break;
      case 'improvement':
        categorized.improvements.push(title);
        break;
      case 'fix':
        categorized.fixes.push(title);
        break;
      case 'breaking':
        categorized.breaking.push(title);
        break;
      case 'internal':
        break;
    }
  }
  return categorized;
}

/**
 * Builds the deterministic fallback from validated source facts. Highlights
 * are only emitted when defensible user impact can be established — otherwise
 * omitted (fewer/none) rather than inventing claims.
 */
export function buildDeterministicFallback(entries: readonly ChangeEntry[]): {
  highlights: readonly string[];
  categorized: CategorizedBullets;
} {
  const highlights = buildFallbackHighlights(entries).slice(0, MAX_HIGHLIGHTS);
  return { highlights, categorized: entriesToCategorizedBullets(entries) };
}
