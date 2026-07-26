/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';

export interface RawCommit {
  readonly hash: string;
  readonly subject: string;
  readonly author: string;
  readonly isMerge: boolean;
  readonly parents: readonly string[];
}

export interface ParsedRef {
  readonly number: number;
  readonly verb: string;
}

export interface EnrichedRef {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly labels: readonly string[];
  readonly labelsTruncated: boolean;
  readonly metadataAvailable?: boolean;
  readonly author: string;
  readonly isPr: boolean;
  readonly userImpact: string | null;
}

export type ChangeCategory =
  | 'new'
  | 'improvement'
  | 'fix'
  | 'breaking'
  | 'internal';

export interface ChangeEntry {
  readonly id: string;
  readonly subject: string;
  readonly hash: string;
  readonly author: string;
  readonly refs: readonly ParsedRef[];
  readonly enriched: readonly EnrichedRef[];
  readonly category: ChangeCategory;
  readonly eligibleForHighlights: boolean;
  readonly childHashes: readonly string[];
  readonly sourceFacts: readonly SourceFact[];
}

export interface CategorizedBullets {
  readonly new: readonly string[];
  readonly improvements: readonly string[];
  readonly fixes: readonly string[];
  readonly breaking: readonly string[];
}

export interface ReleaseNotesData {
  readonly releaseTag: string;
  readonly highlights: readonly string[];
  readonly categorized: CategorizedBullets;
  readonly allChanges: readonly string[];
  readonly contributors: readonly string[];
  readonly lastTag: string;
  readonly isFirstRelease: boolean;
  readonly comparisonUrl: string | null;
  readonly curatedHeadline: string | null;
}

export interface GhPort {
  fetchRefs(
    numbers: readonly number[],
  ): Promise<ReadonlyMap<number, EnrichedRef>>;
}

/**
 * Resolves git topology: given a two-parent merge commit, returns the hashes
 * of commits introduced by that merge (on the merged branch, not the base).
 * This lets PR grouping associate a classic merge commit with its child
 * commits without losing any of them.
 */
export interface TopologyResolver {
  getMergeIntroducedHashes(
    firstParent: string,
    secondParent: string,
  ): readonly string[];

  /**
   * Returns the deduplicated hashes of commits introduced by a multi-parent
   * (octopus) merge — commits reachable from any non-first parent but not
   * from the first parent. Handles merges with 3+ parents where multiple
   * branches may have overlapping commit sets.
   */
  getOctopusMergeIntroducedHashes(
    parents: readonly string[],
  ): readonly string[];
}

export interface LlmPort {
  generateHighlights(context: string): Promise<string>;
}

/**
 * A release-metadata port that resolves the publication timestamp for a
 * published GitHub release (stable or nightly). Tag creatordate for
 * lightweight tags reflects the commit the tag points at, NOT when the
 * release was published — so authoritative publication ordering must come
 * from the GitHub release object. Returns null when release metadata is
 * unavailable (e.g. a tag with no published release) so callers can fall
 * back deterministically to tag chronology.
 */
export type ReleaseMetadata =
  | { readonly status: 'published'; readonly publishedAt: number }
  | { readonly status: 'confirmed-absent' }
  | { readonly status: 'unknown' };

export interface ReleaseMetadataPort {
  getReleaseMetadata(tag: string): Promise<ReleaseMetadata>;
}

/**
 * A validated, structured fact extracted from an enriched GitHub issue/PR.
 * Each fact carries a defensible user impact statement. These are the ONLY
 * building blocks for highlight text — the model selects which eligible source
 * IDs to surface, but final text is constructed deterministically from
 * validated source facts, not from free-form model prose.
 */
export interface SourceFact {
  readonly sourceId: string;
  readonly title: string;
  readonly category: ChangeCategory;
  readonly userImpact: string;
  readonly evidence: string;
}

/**
 * Schema for the model's highlight selection. The model selects eligible
 * source IDs only — final highlight text is constructed deterministically
 * from validated SourceFacts, never from free-form model prose.
 */
const highlightSelectionSchema = z.object({
  sourceIds: z.array(z.string()).min(0).max(6),
});

export const llmOutputSchema = highlightSelectionSchema;

export type LlmOutput = z.infer<typeof llmOutputSchema>;
