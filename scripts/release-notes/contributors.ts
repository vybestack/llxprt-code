/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { parseRefs } from './filtering.js';
import type { EnrichedRef, GhPort, RawCommit } from './types.js';

/** The maintainer login to exclude from contributor thanks. */
export const MAINTAINER_LOGIN = 'acoliver';

/**
 * Extracts unique PR numbers from raw commit subjects using the same
 * `parseRefs` logic that drives commit grouping (processing.ts). This covers
 * classic merges (`Merge pull request #N`), terminal squash markers (`(#N)`),
 * and Fixes/Closes/Resolves references that point to a PR.
 *
 * Numbers are de-duplicated (preserving first-seen order) so the same PR
 * referenced by multiple commits is enriched only once.
 */
export function extractPrNumbers(
  commits: readonly RawCommit[],
): readonly number[] {
  const seen = new Set<number>();
  const numbers: number[] = [];
  for (const commit of commits) {
    for (const ref of parseRefs(commit.subject)) {
      if (!seen.has(ref.number)) {
        seen.add(ref.number);
        numbers.push(ref.number);
      }
    }
  }
  return numbers;
}

/**
 * Determines whether a login should be excluded from the contributor thanks
 * section: the maintainer, empty/deleted authors, and bot accounts (suffix
 * `[bot]`).
 */
export function isExcludedContributor(login: string): boolean {
  if (login.trim().length === 0) {
    return true;
  }
  if (login === MAINTAINER_LOGIN) {
    return true;
  }
  return login.endsWith('[bot]');
}

/**
 * Computes the sorted, de-duplicated contributor logins for a release given
 * the raw commits. PR numbers are derived from the same shared `parseRefs`
 * extraction used for commit grouping, then enriched via the gh port. Only
 * enriched PR refs (isPr) with a non-excluded author are retained.
 *
 * This works across both classic merge and squash-merge conventions and
 * degrades gracefully when GitHub returns partial data (a missing or
 * non-PR ref is simply skipped).
 */
export async function computeContributors(
  ghPort: GhPort,
  commits: readonly RawCommit[],
): Promise<readonly string[]> {
  const prNumbers = extractPrNumbers(commits);
  if (prNumbers.length === 0) {
    return [];
  }
  let refs: ReadonlyMap<number, EnrichedRef>;
  try {
    refs = await ghPort.fetchRefs(prNumbers);
  } catch {
    console.warn(
      `GitHub enrichment failed for contributor lookup; continuing without contributors.`,
    );
    return [];
  }
  return [
    ...new Set(
      [...refs.values()]
        .filter((ref) => ref.isPr)
        .map((ref) => ref.author)
        .filter(
          (author): author is string =>
            author !== null && author !== undefined && author.length > 0,
        )
        .filter((author) => !isExcludedContributor(author)),
    ),
  ].sort();
}
