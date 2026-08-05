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
import {
  GITHUB_OP_SPECS,
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
 * Validates parameters for search.issues.
 *
 * @plan PLAN-20260731-GHBROKER.P10, PLAN-20260731-GHBROKER.P15
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines 13-31
 */
export function validateSearchIssuesParams(
  params: Record<string, unknown>,
): ValidationError | null {
  return validateParams(SEARCH_ISSUES_SPEC.params, params);
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
  appendSearchQuery(argv, params);
  argv.push('--limit', String(resolveLimit(params)));
  if (typeof params.repo === 'string' && params.repo.length > 0) {
    argv.push('--repo', params.repo);
  }
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
 * Appends the query as a positional argument to the argv array. The query
 * is placed in the positional slot (before flags) so gh reads it as the
 * search query.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002
 */
function appendSearchQuery(
  argv: string[],
  params: Record<string, unknown>,
): void {
  if (typeof params.query === 'string') {
    // Insert the query right after the subcommand, before --json, so gh
    // interprets it as the positional search query.
    argv.splice(2, 0, params.query);
  }
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
  return validateParams(SEARCH_PRS_SPEC.params, params);
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
  appendSearchQuery(argv, params);
  argv.push('--limit', String(resolveLimit(params)));
  if (typeof params.repo === 'string' && params.repo.length > 0) {
    argv.push('--repo', params.repo);
  }
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
};
