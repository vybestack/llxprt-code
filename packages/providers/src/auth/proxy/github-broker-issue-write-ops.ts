/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Mutating issue-family operation descriptors: issue.create, issue.comment
 * and issue.close.
 *
 * These set `mutating: true` so the tool layer routes them through the
 * existing tool-confirmation path. The broker is host-side and has no UI, so
 * it does not prompt; it only declares intent.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002, REQ-008, REQ-009, REQ-012
 * @pseudocode 003-github-broker.md lines 38-55
 */

import type { OpDescriptor, ValidationError } from './github-broker-types.js';
import { validateParams } from './github-broker-validation.js';
import {
  GITHUB_OP_SPECS,
  type GithubOpSpec,
} from '@vybestack/llxprt-code-tools/tools/github-ops.js';
import { extractString } from './github-broker-shaping.js';
import { appendMulti, appendRepo, appendString } from './github-broker-argv.js';

const ISSUE_CREATE_SPEC: GithubOpSpec = GITHUB_OP_SPECS['issue.create'];
const ISSUE_COMMENT_SPEC: GithubOpSpec = GITHUB_OP_SPECS['issue.comment'];
const ISSUE_CLOSE_SPEC: GithubOpSpec = GITHUB_OP_SPECS['issue.close'];

/**
 * Extracts the trimmed URL that gh create commands print on stdout, and the
 * trailing issue or PR number embedded in it.
 *
 * gh prints a bare URL rather than JSON for create operations, so this is a
 * raw-output op. The result is still shaped into an object: the protocol
 * rejects arrays as response data and a bare string would be a needlessly
 * different contract from every other op.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 124b-124k
 */
export function shapeCreatedUrl(rawText: unknown): {
  url: string;
  number: number | null;
} {
  const url = extractString(rawText, '').trim();
  const match = /\/(\d+)\s*$/.exec(url);
  return { url, number: match ? Number(match[1]) : null };
}

// ─── issue.create ────────────────────────────────────────────────────────────

/**
 * Validates parameters for issue.create.
 *
 * @plan PLAN-20260731-GHBROKER.P11, PLAN-20260731-GHBROKER.P15
 * @requirement REQ-002
 */
export function validateIssueCreateParams(
  params: Record<string, unknown>,
): ValidationError | null {
  return validateParams(ISSUE_CREATE_SPEC.params, params);
}

/**
 * Builds argv for issue.create. Pure; the body value is already a temp-file
 * path supplied by the dispatcher.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002, REQ-009
 */
export function buildIssueCreateArgv(
  params: Record<string, unknown>,
): string[] {
  const argv: string[] = ['issue', 'create'];
  appendString(argv, '--title', params.title);
  appendString(argv, '--body-file', params.body);
  appendMulti(argv, '--label', params.label);
  appendMulti(argv, '--assignee', params.assignee);
  appendString(argv, '--milestone', params.milestone);
  appendString(argv, '--project', params.project);
  appendRepo(argv, params);
  return argv;
}

/** The issue.create operation descriptor. */
export const issueCreateDescriptor: OpDescriptor = {
  name: 'issue.create',
  requiredParams: ISSUE_CREATE_SPEC.required,
  mutating: ISSUE_CREATE_SPEC.mutating,
  params: ISSUE_CREATE_SPEC.params,
  bodyParams: ['body'],
  rawOutput: true,
  buildArgv: (params) => buildIssueCreateArgv(params),
  shape: (rawText) => shapeCreatedUrl(rawText),
};

// ─── issue.comment ───────────────────────────────────────────────────────────

/**
 * Validates parameters for issue.comment.
 *
 * @plan PLAN-20260731-GHBROKER.P11, PLAN-20260731-GHBROKER.P15
 * @requirement REQ-002
 */
export function validateIssueCommentParams(
  params: Record<string, unknown>,
): ValidationError | null {
  return validateParams(ISSUE_COMMENT_SPEC.params, params);
}

/**
 * Builds argv for issue.comment. Pure.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002, REQ-009
 */
export function buildIssueCommentArgv(
  params: Record<string, unknown>,
): string[] {
  const argv: string[] = ['issue', 'comment', String(params.number)];
  appendString(argv, '--body-file', params.body);
  appendRepo(argv, params);
  return argv;
}

/** The issue.comment operation descriptor. */
export const issueCommentDescriptor: OpDescriptor = {
  name: 'issue.comment',
  requiredParams: ISSUE_COMMENT_SPEC.required,
  mutating: ISSUE_COMMENT_SPEC.mutating,
  params: ISSUE_COMMENT_SPEC.params,
  bodyParams: ['body'],
  rawOutput: true,
  buildArgv: (params) => buildIssueCommentArgv(params),
  shape: (rawText) => ({ url: extractString(rawText, '').trim() }),
};

// ─── issue.close ─────────────────────────────────────────────────────────────

/**
 * Validates parameters for issue.close.
 *
 * @plan PLAN-20260731-GHBROKER.P11, PLAN-20260731-GHBROKER.P15
 * @requirement REQ-002
 */
export function validateIssueCloseParams(
  params: Record<string, unknown>,
): ValidationError | null {
  return validateParams(ISSUE_CLOSE_SPEC.params, params);
}

/**
 * Builds argv for issue.close. Pure.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002, REQ-009
 */
export function buildIssueCloseArgv(params: Record<string, unknown>): string[] {
  const argv: string[] = ['issue', 'close', String(params.number)];
  appendString(argv, '--reason', params.reason);
  appendRepo(argv, params);
  return argv;
}

/** The issue.close operation descriptor. */
export const issueCloseDescriptor: OpDescriptor = {
  name: 'issue.close',
  requiredParams: ISSUE_CLOSE_SPEC.required,
  mutating: ISSUE_CLOSE_SPEC.mutating,
  params: ISSUE_CLOSE_SPEC.params,
  rawOutput: true,
  buildArgv: (params) => buildIssueCloseArgv(params),
  shape: (_rawText, params) => ({
    number: typeof params.number === 'number' ? params.number : null,
    state: 'closed',
  }),
};
