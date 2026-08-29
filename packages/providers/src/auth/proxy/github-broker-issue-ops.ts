/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue-family operation descriptors for the GitHub broker: issue.view
 * (moved here from github-broker-ops.ts) and issue.list.
 *
 * @plan PLAN-20260731-GHBROKER.P08, PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-008, REQ-009, REQ-013
 * @pseudocode 003-github-broker.md lines 38-55, 101-126
 */

import type {
  GhRunner,
  OpDescriptor,
  ValidationError,
} from './github-broker-types.js';
import { validateParams } from './github-broker-validation.js';
import {
  GITHUB_OP_SPECS,
  type GithubOpSpec,
} from '@vybestack/llxprt-code-tools/tools/github-ops.js';
import {
  assertListShape,
  assertNotPartialSuccess,
  extractAssignees,
  extractAuthor,
  extractComments,
  extractLabels,
  extractMilestone,
  extractNumber,
  extractState,
  extractString,
  type ShapedComment,
  windowByLimit,
} from './github-broker-shaping.js';
import { resolveFetchLimit } from './github-broker-validation.js';
import {
  labelQualifiers,
  resolveTotalCount,
  stateQualifier,
} from './github-broker-count.js';

const ISSUE_VIEW_SPEC: GithubOpSpec = GITHUB_OP_SPECS['issue.view'];
const ISSUE_LIST_SPEC: GithubOpSpec = GITHUB_OP_SPECS['issue.list'];

// ─── issue.view ──────────────────────────────────────────────────────────────

/**
 * Validates parameters for the issue.view operation.
 *
 * @plan PLAN-20260731-GHBROKER.P08, PLAN-20260731-GHBROKER.P15
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines 13-31
 */
export function validateIssueViewParams(
  params: Record<string, unknown>,
): ValidationError | null {
  if (params.number === undefined) {
    return {
      code: 'INVALID_PARAM',
      message: 'Parameter number is required',
    };
  }
  return validateParams(
    ISSUE_VIEW_SPEC.params,
    params,
    undefined,
    'issue.view',
  );
}

/**
 * Builds the `gh` argv array for issue.view. Pure; no I/O.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002, REQ-009, REQ-013
 * @pseudocode 003-github-broker.md lines 46-55, 101-103
 */
export function buildIssueViewArgv(
  params: Record<string, unknown>,
  comments: boolean,
): string[] {
  const number = String(params.number);
  const required = 'number,title,state,author,labels,body,assignees,milestone';
  const fields = comments ? `${required},comments` : required;
  const argv = ['issue', 'view', number, '--json', fields];
  if (typeof params.repo === 'string' && params.repo.length > 0) {
    argv.push('--repo', params.repo);
  }
  return argv;
}

/**
 * The shaped issue.view contract.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 101-103
 */
export interface ShapedIssueView {
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly author: string;
  readonly labels: readonly string[];
  readonly assignees: readonly string[];
  /** The milestone title, null when the issue has no milestone. */
  readonly milestone: string | null;
  readonly body: string;
  readonly comments: readonly ShapedComment[] | null;
}

/**
 * Shapes raw gh JSON for issue.view into the contract. Pure; no I/O.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 101-103
 */
export function shapeIssueView(rawJson: unknown): ShapedIssueView {
  if (rawJson === null || typeof rawJson !== 'object') {
    throw new Error('GITHUB_ERROR: expected a JSON object from gh');
  }
  assertNotPartialSuccess(rawJson);
  const raw = rawJson as Record<string, unknown>;
  return {
    number: extractNumber(raw.number),
    title: extractString(raw.title, ''),
    state: extractState(raw.state),
    author: extractAuthor(raw.author),
    labels: extractLabels(raw.labels),
    assignees: extractAssignees(raw.assignees),
    milestone: extractMilestone(raw.milestone),
    body: extractString(raw.body, ''),
    comments: extractComments(raw.comments),
  };
}

/**
 * The issue.view operation descriptor.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002, REQ-013
 * @pseudocode 003-github-broker.md lines 38-44, 101-103
 */
export const issueViewDescriptor: OpDescriptor = {
  name: 'issue.view',
  requiredParams: ISSUE_VIEW_SPEC.required,
  mutating: ISSUE_VIEW_SPEC.mutating,
  params: ISSUE_VIEW_SPEC.params,
  buildArgv: (params) => {
    const comments = params.comments === true;
    return buildIssueViewArgv(params, comments);
  },
  shape: (rawJson) => shapeIssueView(rawJson),
};

// ─── issue.list ──────────────────────────────────────────────────────────────

/**
 * Validates parameters for the issue.list operation.
 *
 * @plan PLAN-20260731-GHBROKER.P10, PLAN-20260731-GHBROKER.P15
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines 13-31, 120-123
 */
export function validateIssueListParams(
  params: Record<string, unknown>,
): ValidationError | null {
  return validateParams(
    ISSUE_LIST_SPEC.params,
    params,
    undefined,
    'issue.list',
  );
}

/**
 * Builds the `gh` argv array for issue.list. Pure; no I/O.
 *
 * Bodies are deliberately excluded from the --json fields list to avoid
 * exceeding the frame budget with a list of issues containing bodies.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-009, REQ-013
 * @pseudocode 003-github-broker.md lines 46-55, 120-123
 */
export function buildIssueListArgv(params: Record<string, unknown>): string[] {
  const argv: string[] = [
    'issue',
    'list',
    '--json',
    'number,title,state,author,labels,updatedAt,assignees,milestone',
  ];
  if (typeof params.search === 'string' && params.search.length > 0) {
    argv.push('--search', params.search);
  }
  if (typeof params.state === 'string' && params.state.length > 0) {
    argv.push('--state', params.state);
  }
  appendLabelArgs(argv, params.label);
  argv.push('--limit', String(resolveFetchLimit(params)));
  if (typeof params.repo === 'string' && params.repo.length > 0) {
    argv.push('--repo', params.repo);
  }
  return argv;
}

/**
 * Appends --label flags for each label value to the argv array.
 *
 * Labels may be provided as a single string or an array of strings.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002
 */
function appendLabelArgs(argv: string[], labelValue: unknown): void {
  if (typeof labelValue === 'string') {
    argv.push('--label', labelValue);
    return;
  }
  if (Array.isArray(labelValue)) {
    for (const l of labelValue) {
      if (typeof l === 'string') {
        argv.push('--label', l);
      }
    }
  }
}

/**
 * A single shaped issue in the issue.list contract. Bodies are excluded.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 120-123
 */
export interface ShapedIssueListItem {
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly author: string;
  readonly labels: readonly string[];
  readonly assignees: readonly string[];
  /** The milestone title, null when the issue has no milestone. */
  readonly milestone: string | null;
  readonly updatedAt: string;
}

/**
 * Shapes raw gh JSON for issue.list into an array of list items. Pure;
 * no I/O. Bodies are NEVER included in list results.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 120-123
 */
export function shapeIssueList(
  rawJson: unknown,
): readonly ShapedIssueListItem[] {
  assertNotPartialSuccess(rawJson);
  assertListShape(rawJson, 'issue.list');
  return rawJson.map((item): ShapedIssueListItem => {
    const obj = (item ?? {}) as Record<string, unknown>;
    return {
      number: extractNumber(obj.number),
      title: extractString(obj.title, ''),
      state: extractState(obj.state),
      author: extractAuthor(obj.author),
      labels: extractLabels(obj.labels),
      assignees: extractAssignees(obj.assignees),
      milestone: extractMilestone(obj.milestone),
      updatedAt: extractString(obj.updatedAt, ''),
    };
  });
}

/**
 * The issue.list operation descriptor.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-013
 * @pseudocode 003-github-broker.md lines 38-44, 120-123
 */
/**
 * Rebuilds an issue.list call as a GitHub search query, so the same filters
 * can be counted.
 *
 * `search` is spliced verbatim because it is already GitHub search syntax
 * (that is what `gh issue list --search` takes), quotes and all. The mapping
 * was checked against live counts rather than assumed: label, `no:assignee`
 * and `milestone:` filters each produced identical numbers from `gh issue
 * list` and from the search API (33/33, 143/143, 141/141), as did an
 * unfiltered open count (210/210).
 *
 * @plan PLAN-20260828-ISSUE3407
 * @requirement AC-8
 * @issue 3407
 */
export function buildIssueListCountQuery(
  params: Record<string, unknown>,
): string {
  const parts: string[] = [];
  if (typeof params.search === 'string' && params.search.length > 0) {
    parts.push(params.search);
  }
  const state = stateQualifier(params.state ?? 'open');
  if (state !== null) parts.push(state);
  parts.push(...labelQualifiers(params.label));
  if (typeof params.repo === 'string' && params.repo.length > 0) {
    parts.push(`repo:${params.repo}`);
  }
  parts.push('type:issue');
  return parts.join(' ');
}

/**
 * Runs issue.list and reports how many issues match in total.
 *
 * issue.list is the operation an agent reaches for when counting, because it
 * is the one that filters richly and returns `milestone`. Leaving the total
 * to search.issues alone meant "how many issues are on milestone X" needed
 * two operations, which every evaluated model called out.
 *
 * @plan PLAN-20260828-ISSUE3407
 * @requirement AC-8
 * @issue 3407
 */
async function executeIssueList(
  params: Record<string, unknown>,
  run: GhRunner,
): Promise<Record<string, unknown>> {
  const page = windowByLimit(
    shapeIssueList(await run(buildIssueListArgv(params))),
    params,
  );
  const effectiveQuery = buildIssueListCountQuery(params);
  return {
    hasMore: page.hasMore,
    totalCount: await resolveTotalCount(page, effectiveQuery, run),
    effectiveQuery,
    issues: page.items,
  };
}

export const issueListDescriptor: OpDescriptor = {
  name: 'issue.list',
  requiredParams: ISSUE_LIST_SPEC.required,
  mutating: ISSUE_LIST_SPEC.mutating,
  params: ISSUE_LIST_SPEC.params,
  buildArgv: (params) => buildIssueListArgv(params),
  execute: (params, run) => executeIssueList(params, run),
  shape: (rawJson, params) => {
    const { items, hasMore } = windowByLimit(shapeIssueList(rawJson), params);
    return { hasMore, issues: items };
  },
};
