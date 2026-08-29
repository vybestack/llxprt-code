/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Asking GitHub how many results a query has, for the list and search
 * operations that page.
 *
 * A page plus a `hasMore` boolean answers "is there more" but not "how many",
 * and "how many open issues are there" is an ordinary question. Without a
 * total, counting past the page ceiling means splitting the query into
 * disjoint buckets and summing them by hand; three separate models
 * independently invented that workaround during evaluation and one of them
 * still miscounted.
 *
 * Every op that pages routes through here so they cannot drift into reporting
 * counts differently.
 *
 * @plan PLAN-20260828-ISSUE3407
 * @requirement AC-8
 * @issue 3407
 */

import type { GhRunner } from './github-broker-types.js';
import { brokerError } from './github-broker-errors.js';
import type { WindowedItems } from './github-broker-shaping.js';

/**
 * Re-quotes a term whose value contains whitespace.
 *
 * This is the one place quoting is CORRECT, and it is the exact inverse of the
 * rule the argv builders follow. Terms handed to `gh` as separate argv
 * elements must not be quoted, because gh quotes each value itself when it
 * assembles the query. Here the query string IS assembled by hand, so nobody
 * else will do it: joining `label:help wanted` unquoted makes the API read
 * `label:help` plus the freetext `wanted`, which matched 0 issues against the
 * 2 the page returned for the same search.
 *
 * @plan PLAN-20260828-ISSUE3407
 * @requirement AC-8
 * @issue 3407
 */
export function quoteCountTerm(term: string): string {
  if (!/\s/.test(term)) return term;
  const colon = term.indexOf(':');
  // A bare multi-word keyword is quoted whole; a qualifier keeps its name
  // outside the quotes so it is still parsed as a qualifier.
  return colon === -1
    ? `"${term}"`
    : `${term.slice(0, colon)}:"${term.slice(colon + 1)}"`;
}

/**
 * Builds the argv that asks GitHub for the size of a whole result set.
 *
 * `per_page=1` keeps the payload to a single row: only `total_count` is
 * wanted, and gh's built-in jq extracts it so nothing else crosses the wire.
 *
 * @plan PLAN-20260828-ISSUE3407
 * @requirement AC-8
 * @issue 3407
 */
export function buildCountArgv(query: string): string[] {
  return [
    'api',
    '-X',
    'GET',
    'search/issues',
    '-f',
    `q=${query}`,
    '-f',
    'per_page=1',
    '--jq',
    '.total_count',
  ];
}

/**
 * Parses gh's `--jq .total_count` output, which arrives as raw text.
 *
 * A non-numeric total means gh returned something unexpected; surfacing that
 * beats reporting a silently wrong count, which is the failure this whole
 * mechanism exists to prevent.
 *
 * @plan PLAN-20260828-ISSUE3407
 * @requirement AC-8
 * @issue 3407
 */
export function parseSearchTotal(raw: unknown): number {
  const text = typeof raw === 'string' ? raw.trim() : '';
  const value = Number(text);
  if (!Number.isInteger(value) || value < 0) {
    throw brokerError(
      'GITHUB_ERROR',
      `search: expected a numeric total from gh but received "${text}"`,
    );
  }
  return value;
}

/**
 * Resolves the size of the whole result set for a page.
 *
 * The extra request is only made when the page is actually truncated; when
 * everything fits, the page length IS the total and no second call happens.
 * That matters because GitHub rate-limits the search endpoint separately from
 * everything else, so a count is not spent unless it buys something.
 *
 * @plan PLAN-20260828-ISSUE3407
 * @requirement AC-8
 * @issue 3407
 */
export async function resolveTotalCount<T>(
  page: WindowedItems<T>,
  query: string,
  run: GhRunner,
): Promise<number> {
  if (!page.hasMore) return page.items.length;
  return parseSearchTotal(
    await run(buildCountArgv(query), { rawOutput: true }),
  );
}

/**
 * Renders the state filter shared by the list operations as a search
 * qualifier.
 *
 * `closed` deliberately maps to `is:closed` rather than excluding merges:
 * `gh pr list --state closed` returns merged pull requests too (measured: 196
 * merged against 4 plain-closed), and search's `is:closed` likewise includes
 * them, so the count matches the rows it accompanies. `all` contributes no
 * qualifier at all.
 *
 * @plan PLAN-20260828-ISSUE3407
 * @requirement AC-8
 * @issue 3407
 */
export function stateQualifier(value: unknown): string | null {
  if (typeof value !== 'string' || value === '' || value === 'all') return null;
  return `is:${value}`;
}

/**
 * Renders `label` (a string or an array of them) as search qualifiers.
 *
 * @plan PLAN-20260828-ISSUE3407
 * @requirement AC-8
 * @issue 3407
 */
export function labelQualifiers(value: unknown): string[] {
  if (typeof value === 'string') {
    return [quoteCountTerm(`label:${value}`)];
  }
  if (!Array.isArray(value)) return [];
  return value
    .filter((label): label is string => typeof label === 'string')
    .map((label) => quoteCountTerm(`label:${label}`));
}
