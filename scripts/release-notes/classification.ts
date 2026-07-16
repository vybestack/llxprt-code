/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChangeCategory, EnrichedRef, RawCommit } from './types.js';

export const INTERNAL_LABELS: ReadonlySet<string> = new Set([
  'code quality',
  'modularization',
  'code quality / modularization',
  'refactor',
  'internal',
  'tech-debt',
  'cleanup',
  'ci/cd',
  'ci',
  'cd',
  'continuous integration',
  'continuous deployment',
  'github actions',
  'architecture',
  'development',
  'dev',
  'developer experience',
  'dx',
  'plan',
  'planning',
  'roadmap',
  'chores',
]);

export const PROMOTING_LABELS: ReadonlySet<string> = new Set([
  'provider support',
  'tooling',
  'configuration',
  'feature',
  'enhancement',
  'bug',
  'fix',
  'ux',
  'ui',
  'performance',
]);

const CONVENTIONAL_RE =
  /^(feat|fix|perf|refactor|test|chore|docs|style|ci|build|revert|misc)(?:\([^)]*\))?(!)?:/i;

/**
 * Signal strength ranking for change categories. Used to ensure promoting
 * labels never demote a higher-signal commit-prefix category (e.g. a `feat:`
 * commit tagged `bug` stays `new`, not demoted to `fix`).
 */
const CATEGORY_SIGNAL_RANK: Record<ChangeCategory, number> = {
  breaking: 4,
  new: 3,
  fix: 2,
  improvement: 1,
  internal: 0,
};

export function strongerCategory(
  left: ChangeCategory,
  right: ChangeCategory,
): ChangeCategory {
  return CATEGORY_SIGNAL_RANK[right] > CATEGORY_SIGNAL_RANK[left]
    ? right
    : left;
}

export function classifyCommit(commit: RawCommit): ChangeCategory {
  const subject = commit.subject;
  if (/\bBREAKING CHANGE\b/i.test(subject)) {
    return 'breaking';
  }
  const match = CONVENTIONAL_RE.exec(subject);
  if (match === null) {
    return 'improvement';
  }
  if (match[2] === '!') {
    return 'breaking';
  }
  switch (match[1].toLowerCase()) {
    case 'feat':
      return 'new';
    case 'fix':
      return 'fix';
    case 'perf':
    case 'docs':
    case 'misc':
      return 'improvement';
    default:
      return 'internal';
  }
}

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase();
}

function hasInternalLabel(enriched: readonly EnrichedRef[]): boolean {
  return enriched.some((ref) =>
    ref.labels.some((label) => INTERNAL_LABELS.has(normalizeLabel(label))),
  );
}

/**
 * Positive promoting labels are scoped to the owning/first enriched ref.
 * A related issue's label must not positively recategorize the owning PR,
 * consistent with classifyEnrichedRefs ownership scoping. Internal-label
 * demotion still spans all refs (see hasInternalLabel above).
 */
function owningRef(enriched: readonly EnrichedRef[]): readonly EnrichedRef[] {
  return enriched[0] === undefined ? [] : [enriched[0]];
}

function hasPromotingLabel(enriched: readonly EnrichedRef[]): boolean {
  return enriched.some((ref) =>
    ref.labels.some((label) => PROMOTING_LABELS.has(normalizeLabel(label))),
  );
}

/**
 * Determines highlight eligibility. Internal labels ALWAYS win: an entry with
 * any internal label is never eligible, even if it also carries a promoting
 * label. When no internal label is present, a promoting label overrides the
 * commit-prefix category — an `internal`-category commit tagged `feature`
 * becomes eligible. Without either label type, the commit-prefix category
 * decides: non-internal categories are eligible, `internal` is not.
 *
 * When any enriched ref has truncated labels (totalCount exceeded the
 * first 100 fetched), we cannot guarantee an internal label is absent from
 * the unfetched pages. The entry is conservatively treated as ineligible
 * for highlights rather than risking an internal-labeled change appearing
 * as a headline.
 */
export function isEligibleForHighlights(
  category: ChangeCategory,
  enriched: readonly EnrichedRef[],
): boolean {
  if (
    enriched.some(
      (ref) => ref.labelsTruncated || ref.metadataAvailable === false,
    )
  ) {
    return false;
  }
  if (hasInternalLabel(enriched)) {
    return false;
  }
  if (hasPromotingLabel(owningRef(enriched))) {
    return true;
  }
  return category !== 'internal';
}

/**
 * Determines whether an entry should be demoted from prominent categories
 * (New, Improvements, Fixes, Breaking). Internal labels ALWAYS win: an entry
 * with any internal label is demoted regardless of its commit-prefix category
 * or any promoting label — the internal label signals that the change is
 * internal even when the conventional commit prefix or a promoting label
 * suggests otherwise (e.g. a `feat:` commit tagged `tech-debt`).
 *
 * Truncated labels are also treated conservatively: when a ref's label set
 * was truncated, the entry is demoted from prominent categories because we
 * cannot guarantee an internal label is absent from the unfetched pages.
 */
export function classifyEnrichedRefs(
  enriched: readonly EnrichedRef[],
): ChangeCategory {
  if (
    enriched.some(
      (ref) => ref.labelsTruncated || ref.metadataAvailable === false,
    )
  ) {
    return 'internal';
  }
  if (hasInternalLabel(enriched)) {
    return 'internal';
  }
  const categories = enriched.map((ref) =>
    classifyCommit({
      subject: ref.title,
      hash: '',
      author: '',
      isMerge: false,
      parents: [],
    }),
  );
  const primary = categories[0] ?? 'internal';
  const fallback = categories.find((category) => category !== 'internal');
  const titleCategory =
    primary === 'internal' ? (fallback ?? primary) : primary;
  return promotedCategory(titleCategory, owningRef(enriched));
}

export function shouldDemoteFromProminent(
  enriched: readonly EnrichedRef[],
): boolean {
  if (
    enriched.some(
      (ref) => ref.labelsTruncated || ref.metadataAvailable === false,
    )
  ) {
    return true;
  }
  return hasInternalLabel(enriched);
}

/**
 * Derives the effective categorized category for a change entry, applying
 * internal-label precedence and promoting-label promotion.
 *
 * Internal labels ALWAYS win: an entry with any internal label is
 * classified as `internal` regardless of its commit-prefix category or any
 * promoting label — the internal label signals that the change is internal
 * even when the conventional commit prefix or a promoting label suggests
 * otherwise (e.g. a `feat:` commit tagged `tech-debt`).
 *
 * When no internal label is present, a promoting label overrides the
 * commit-prefix category: an `internal`-category commit tagged `feature`
 * becomes `new`, `bug`/`fix` becomes `fix`, and `enhancement`/`ux`/`ui`/
 * `performance` becomes `improvement`.
 *
 * When neither label type is present, the original commit-prefix category
 * is returned unchanged.
 */
export function deriveEffectiveCategory(
  category: ChangeCategory,
  enriched: readonly EnrichedRef[],
): ChangeCategory {
  if (
    enriched.some(
      (ref) => ref.labelsTruncated || ref.metadataAvailable === false,
    )
  ) {
    return 'internal';
  }
  if (hasInternalLabel(enriched)) {
    return 'internal';
  }
  if (hasPromotingLabel(owningRef(enriched))) {
    return promotedCategory(category, owningRef(enriched));
  }
  return category;
}

/**
 * Derives the promoted category from promoting labels, with a deterministic
 * precedence: bug/fix → fix; feature/enhancement/provider support → new;
 * ux/ui/performance → improvement. When multiple promoting labels exist,
 * the first matching precedence tier wins.
 *
 * Promoting labels only move a category UP (or laterally within the same
 * signal rank): a promoting label can promote an internal-prefix commit, but
 * never demotes a higher-signal commit-prefix category. For example, a
 * `feat:` commit tagged `bug` stays `new` (rank 3), not demoted to `fix`
 * (rank 2).
 */
function promotedCategory(
  original: ChangeCategory,
  enriched: readonly EnrichedRef[],
): ChangeCategory {
  const target = promotingLabelTarget(enriched);
  if (target === null) {
    return original === 'internal' ? 'improvement' : original;
  }
  // Only apply the promotion when it does not lower the signal rank.
  // This prevents a lower-signal promoting label from demoting a stronger
  // commit-prefix category (e.g. `feat:` tagged `bug` stays `new`).
  if (CATEGORY_SIGNAL_RANK[target] >= CATEGORY_SIGNAL_RANK[original]) {
    return target;
  }
  return original;
}

/**
 * Determines the target category implied by promoting labels, scanning
 * refs in deterministic precedence order: bug/fix → fix, then
 * feature/enhancement/provider support → new, then ux/ui/performance →
 * improvement. Returns null when only lower-signal promoting labels
 * (tooling, configuration) are present, which promote `internal` to
 * `improvement` but do not override a non-internal original.
 */
function promotingLabelTarget(
  enriched: readonly EnrichedRef[],
): ChangeCategory | null {
  for (const ref of enriched) {
    const labels = ref.labels.map((label) => normalizeLabel(label));
    if (labels.includes('bug') || labels.includes('fix')) {
      return 'fix';
    }
  }
  for (const ref of enriched) {
    const labels = ref.labels.map((label) => normalizeLabel(label));
    if (
      labels.includes('feature') ||
      labels.includes('enhancement') ||
      labels.includes('provider support')
    ) {
      return 'new';
    }
  }
  for (const ref of enriched) {
    const labels = ref.labels.map((label) => normalizeLabel(label));
    if (
      labels.includes('ux') ||
      labels.includes('ui') ||
      labels.includes('performance')
    ) {
      return 'improvement';
    }
  }
  // tooling, configuration — only meaningful when promoting from internal.
  return null;
}
