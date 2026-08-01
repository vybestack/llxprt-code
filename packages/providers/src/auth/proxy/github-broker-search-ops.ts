/**
 * @license
 * Copyright 2025 Vybestack LLC
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

import type {
  OpDescriptor,
  ParamKind,
  ValidationError,
} from './github-broker-types.js';
import { resolveLimit, validateParams } from './github-broker-validation.js';
import {
  assertNotPartialSuccess,
  extractNumber,
  extractString,
} from './github-broker-shaping.js';

/**
 * The accepted parameters for search.issues.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-009, REQ-013
 * @pseudocode 003-github-broker.md lines 120-123
 */
const SEARCH_ISSUES_PARAMS: Readonly<Record<string, ParamKind>> = {
  query: 'freetext',
  limit: 'limit',
  repo: 'repo',
};

/**
 * Validates parameters for search.issues.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines 13-31
 */
export function validateSearchIssuesParams(
  params: Record<string, unknown>,
): ValidationError | null {
  return validateParams(SEARCH_ISSUES_PARAMS, params);
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
  if (typeof params.repo === 'string') {
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
  if (!Array.isArray(rawJson)) return [];
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
  mutating: false,
  params: SEARCH_ISSUES_PARAMS,
  buildArgv: (params) => buildSearchIssuesArgv(params),
  shape: (rawJson) => ({ issues: shapeSearchResults(rawJson) }),
};

// ─── search.prs ──────────────────────────────────────────────────────────────

/**
 * The accepted parameters for search.prs.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-009, REQ-013
 * @pseudocode 003-github-broker.md lines 120-123
 */
const SEARCH_PRS_PARAMS: Readonly<Record<string, ParamKind>> = {
  query: 'freetext',
  limit: 'limit',
  repo: 'repo',
};

/**
 * Validates parameters for search.prs.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines 13-31
 */
export function validateSearchPrsParams(
  params: Record<string, unknown>,
): ValidationError | null {
  return validateParams(SEARCH_PRS_PARAMS, params);
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
  if (typeof params.repo === 'string') {
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
  mutating: false,
  params: SEARCH_PRS_PARAMS,
  buildArgv: (params) => buildSearchPrsArgv(params),
  shape: (rawJson) => ({ prs: shapeSearchResults(rawJson) }),
};
