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
  OpDescriptor,
  ParamKind,
  ValidationError,
} from './github-broker-types.js';
import { validateParams } from './github-broker-validation.js';
import {
  assertNotPartialSuccess,
  extractAuthor,
  extractComments,
  extractLabels,
  extractNumber,
  extractString,
  type ShapedComment,
} from './github-broker-shaping.js';
import { resolveLimit } from './github-broker-validation.js';

// ─── issue.view ──────────────────────────────────────────────────────────────

/**
 * The accepted parameters for issue.view.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-008, REQ-009
 * @pseudocode 003-github-broker.md lines 52-55, 101-103
 */
const ISSUE_VIEW_PARAMS: Readonly<Record<string, ParamKind>> = {
  number: 'number',
  comments: 'boolean',
  repo: 'repo',
};

/**
 * Validates parameters for the issue.view operation.
 *
 * @plan PLAN-20260731-GHBROKER.P08
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
  return validateParams(ISSUE_VIEW_PARAMS, params);
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
  const fields = comments
    ? 'number,title,state,author,labels,body,comments'
    : 'number,title,state,author,labels,body';
  const argv = ['issue', 'view', number, '--json', fields];
  if (typeof params.repo === 'string') {
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
    state: extractString(raw.state, ''),
    author: extractAuthor(raw.author),
    labels: extractLabels(raw.labels),
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
  requiredParams: ['number'],
  mutating: false,
  params: ISSUE_VIEW_PARAMS,
  buildArgv: (params) => {
    const comments = params.comments === true;
    return buildIssueViewArgv(params, comments);
  },
  shape: (rawJson) => shapeIssueView(rawJson),
};

// ─── issue.list ──────────────────────────────────────────────────────────────

/**
 * The accepted parameters for issue.list.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-008, REQ-009, REQ-013
 * @pseudocode 003-github-broker.md lines 120-123
 */
const ISSUE_LIST_PARAMS: Readonly<Record<string, ParamKind>> = {
  search: 'freetext',
  state: 'stateIssue',
  label: 'label',
  limit: 'limit',
  repo: 'repo',
};

/**
 * Validates parameters for the issue.list operation.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines 13-31, 120-123
 */
export function validateIssueListParams(
  params: Record<string, unknown>,
): ValidationError | null {
  return validateParams(ISSUE_LIST_PARAMS, params);
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
    'number,title,state,labels,updatedAt',
  ];
  if (typeof params.search === 'string') {
    argv.push('--search', params.search);
  }
  if (typeof params.state === 'string') {
    argv.push('--state', params.state);
  }
  appendLabelArgs(argv, params.label);
  argv.push('--limit', String(resolveLimit(params)));
  if (typeof params.repo === 'string') {
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
  readonly labels: readonly string[];
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
  if (!Array.isArray(rawJson)) return [];
  return rawJson.map((item): ShapedIssueListItem => {
    const obj = (item ?? {}) as Record<string, unknown>;
    return {
      number: extractNumber(obj.number),
      title: extractString(obj.title, ''),
      state: extractString(obj.state, ''),
      labels: extractLabels(obj.labels),
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
export const issueListDescriptor: OpDescriptor = {
  name: 'issue.list',
  mutating: false,
  params: ISSUE_LIST_PARAMS,
  buildArgv: (params) => buildIssueListArgv(params),
  shape: (rawJson) => ({ issues: shapeIssueList(rawJson) }),
};
