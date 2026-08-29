/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Search-family operation descriptors for the GitHub broker:
 * search.issues and search.prs.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-009, REQ-013
 * @pseudocode 003-github-broker.md lines 38-55, 120-123
 */

import type { OpDescriptor, ValidationError } from './github-broker-types.js';
import { resolveLimit, validateParams } from './github-broker-validation.js';
import { augmentSearchError } from './github-broker-errors.js';
import {
  GITHUB_OP_SPECS,
  isGithubRepoName,
  type GithubOpSpec,
} from '@vybestack/llxprt-code-tools/tools/github-ops.js';
import {
  assertNotPartialSuccess,
  extractNumber,
  extractString,
  assertListShape,
} from './github-broker-shaping.js';

const SEARCH_ISSUES_SPEC: GithubOpSpec = GITHUB_OP_SPECS['search.issues'];
const SEARCH_PRS_SPEC: GithubOpSpec = GITHUB_OP_SPECS['search.prs'];

/**
 * The prefix of a `repo:` qualifier inside a search query.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002
 */
const REPO_PREFIX = 'repo:';

/**
 * Tokenizes a search query into a list of positional terms, treating a
 * double-quoted run as one term with its surrounding quotes STRIPPED.
 *
 * gh quotes each positional term's value itself when it constructs the API
 * query. A pre-quoted value arrives double-quoted at the API and matches
 * nothing, so this function removes the quotes rather than preserving them. An
 * unterminated quote makes the rest of the string one token.
 *
 * `milestone:"0.11.0" is:open` -> `["milestone:0.11.0", "is:open"]`
 * `"sandbox proxy" is:open` -> `["sandbox proxy", "is:open"]`
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-013
 */
export function tokenizeSearchQuery(query: string): readonly string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const char of query) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes && isWhitespace(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

/**
 * True for space, tab, newline and the other Unicode whitespace characters.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002
 */
function isWhitespace(char: string): boolean {
  return /\s/u.test(char);
}

/**
 * Normalizes a search query into the raw terms gh should receive as separate
 * positional argv elements. A `repo:owner/name` term whose value matches the
 * repo shape is lifted: its value is returned as `liftedRepo` and the term
 * removed. Only the FIRST liftable repo term is lifted; the rest stay as
 * ordinary terms. A non-conforming `repo:` value stays a term (never silently
 * dropped). Pure; never adds quote characters.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-013
 */
export function normalizeSearchQuery(query: string): {
  readonly terms: readonly string[];
  readonly liftedRepo: string | null;
} {
  const tokens = tokenizeSearchQuery(query);
  let liftedRepo: string | null = null;
  const terms: string[] = [];
  for (const token of tokens) {
    if (liftedRepo === null && token.startsWith(REPO_PREFIX)) {
      const value = token.slice(REPO_PREFIX.length);
      if (isGithubRepoName(value)) {
        liftedRepo = value;
        continue;
      }
    }
    terms.push(token);
  }
  return { terms, liftedRepo };
}

/**
 * Appends the repository scope and then the tokenized query terms, which are
 * emitted LAST and behind a `--` option terminator.
 *
 * The terminator is required, not cosmetic. GitHub's search syntax excludes a
 * qualifier by prefixing it with a dash (`-label:bug`), and once each term is
 * its own argv element gh parses a leading-dash term as a CLI flag and fails
 * with "unknown shorthand flag: 'l'". Terms therefore go after `--`, which
 * means every flag must already be on argv by the time this runs.
 *
 * Value-level validation rejects a `query` that STARTS with a dash, but not
 * `is:open -label:bug`, where the dash is on an interior term — so the
 * terminator is what actually makes exclusion syntax usable.
 *
 * No quote characters are ever emitted: gh quotes each term's value itself,
 * so a pre-quoted value would arrive at the API double-quoted and match
 * nothing.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-013
 */
function appendSearchQuery(
  argv: string[],
  params: Record<string, unknown>,
): void {
  const query = typeof params.query === 'string' ? params.query : '';
  const { terms, liftedRepo } = normalizeSearchQuery(query);
  // An explicit repo parameter wins on conflict; the lifted repo: term is
  // dropped from the terms either way.
  const explicitRepo = hasNonEmptyRepo(params) ? String(params.repo) : null;
  const repo = explicitRepo ?? liftedRepo;
  if (repo !== null) {
    argv.push('--repo', repo);
  }
  // A bare trailing `--` would be noise, so it is emitted only when there is
  // at least one term to protect.
  if (terms.length > 0) {
    argv.push('--', ...terms);
  }
}

/**
 * True when params carries a non-empty explicit repo parameter.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002
 */
function hasNonEmptyRepo(params: Record<string, unknown>): boolean {
  return typeof params.repo === 'string' && params.repo.length > 0;
}

/**
 * Validates parameters for search.issues.
 *
 * @plan PLAN-20260731-GHBROKER.P10, PLAN-20260731-GHBROKER.P15
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines 13-31
 */
export function validateSearchIssuesParams(
  params: Record<string, unknown>,
): ValidationError | null {
  return validateParams(
    SEARCH_ISSUES_SPEC.params,
    params,
    undefined,
    'search.issues',
  );
}

/**
 * Builds the `gh` argv array for search.issues. Pure; no I/O.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-009, REQ-013
 * @pseudocode 003-github-broker.md lines 46-55, 120-123
 */
export function buildSearchIssuesArgv(
  params: Record<string, unknown>,
): string[] {
  const argv: string[] = [
    'search',
    'issues',
    '--json',
    'number,title,state,repository,updatedAt',
  ];
  argv.push('--limit', String(resolveLimit(params)));
  // Must come last: it emits --repo and then the `--` terminator followed by
  // the query terms, so every flag has to already be on argv.
  appendSearchQuery(argv, params);
  return argv;
}

/**
 * A single shaped search result item.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 120-123
 */
export interface ShapedSearchItem {
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly repository: string;
  readonly updatedAt: string;
}

/**
 * Shapes raw gh JSON for search.issues/search.prs into an array of items.
 * Bodies are excluded.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 120-123
 */
export function shapeSearchResults(
  rawJson: unknown,
): readonly ShapedSearchItem[] {
  assertNotPartialSuccess(rawJson);
  assertListShape(rawJson, 'search');
  return rawJson.map((item): ShapedSearchItem => {
    const obj = (item ?? {}) as Record<string, unknown>;
    return {
      number: extractNumber(obj.number),
      title: extractString(obj.title, ''),
      state: extractString(obj.state, ''),
      repository: extractRepository(obj.repository),
      updatedAt: extractString(obj.updatedAt, ''),
    };
  });
}

/**
 * Extracts the repository full name from a gh repository object
 * (defensive).
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 */
function extractRepository(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.nameWithOwner === 'string') return obj.nameWithOwner;
    if (typeof obj.full_name === 'string') return obj.full_name;
  }
  return '';
}

/**
 * The search.issues operation descriptor.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-013
 * @pseudocode 003-github-broker.md lines 38-44, 120-123
 */
export const searchIssuesDescriptor: OpDescriptor = {
  name: 'search.issues',
  requiredParams: SEARCH_ISSUES_SPEC.required,
  mutating: SEARCH_ISSUES_SPEC.mutating,
  params: SEARCH_ISSUES_SPEC.params,
  buildArgv: (params) => buildSearchIssuesArgv(params),
  shape: (rawJson) => ({ issues: shapeSearchResults(rawJson) }),
  augmentError: augmentSearchError,
};

// ─── search.prs ──────────────────────────────────────────────────────────────

/**
 * Validates parameters for search.prs.
 *
 * @plan PLAN-20260731-GHBROKER.P10, PLAN-20260731-GHBROKER.P15
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines 13-31
 */
export function validateSearchPrsParams(
  params: Record<string, unknown>,
): ValidationError | null {
  return validateParams(
    SEARCH_PRS_SPEC.params,
    params,
    undefined,
    'search.prs',
  );
}

/**
 * Builds the `gh` argv array for search.prs. Pure; no I/O.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-009, REQ-013
 * @pseudocode 003-github-broker.md lines 46-55, 120-123
 */
export function buildSearchPrsArgv(params: Record<string, unknown>): string[] {
  const argv: string[] = [
    'search',
    'prs',
    '--json',
    'number,title,state,repository,updatedAt',
  ];
  argv.push('--limit', String(resolveLimit(params)));
  // Must come last: it emits --repo and then the `--` terminator followed by
  // the query terms, so every flag has to already be on argv.
  appendSearchQuery(argv, params);
  return argv;
}

/**
 * The search.prs operation descriptor.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-013
 * @pseudocode 003-github-broker.md lines 38-44, 120-123
 */
export const searchPrsDescriptor: OpDescriptor = {
  name: 'search.prs',
  requiredParams: SEARCH_PRS_SPEC.required,
  mutating: SEARCH_PRS_SPEC.mutating,
  params: SEARCH_PRS_SPEC.params,
  buildArgv: (params) => buildSearchPrsArgv(params),
  shape: (rawJson) => ({ prs: shapeSearchResults(rawJson) }),
  augmentError: augmentSearchError,
};
