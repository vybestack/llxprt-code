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

import type {
  OpDescriptor,
  ParamKind,
  ValidationError,
} from './github-broker-types.js';
import { validateParams } from './github-broker-validation.js';
import { extractString } from './github-broker-shaping.js';
import { appendMulti, appendRepo, appendString } from './github-broker-argv.js';

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

/** Accepted parameters for issue.create. */
const ISSUE_CREATE_PARAMS: Readonly<Record<string, ParamKind>> = {
  title: 'freetext',
  body: 'body',
  label: 'label',
  assignee: 'assignee',
  milestone: 'milestone',
  project: 'project',
  repo: 'repo',
};

/**
 * Validates parameters for issue.create.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002
 */
export function validateIssueCreateParams(
  params: Record<string, unknown>,
): ValidationError | null {
  return validateParams(ISSUE_CREATE_PARAMS, params);
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
  requiredParams: ['title'],
  mutating: true,
  params: ISSUE_CREATE_PARAMS,
  bodyParams: ['body'],
  rawOutput: true,
  buildArgv: (params) => buildIssueCreateArgv(params),
  shape: (rawText) => shapeCreatedUrl(rawText),
};

// ─── issue.comment ───────────────────────────────────────────────────────────

/** Accepted parameters for issue.comment. */
const ISSUE_COMMENT_PARAMS: Readonly<Record<string, ParamKind>> = {
  number: 'number',
  body: 'body',
  repo: 'repo',
};

/**
 * Validates parameters for issue.comment.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002
 */
export function validateIssueCommentParams(
  params: Record<string, unknown>,
): ValidationError | null {
  return validateParams(ISSUE_COMMENT_PARAMS, params);
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
  requiredParams: ['number', 'body'],
  mutating: true,
  params: ISSUE_COMMENT_PARAMS,
  bodyParams: ['body'],
  rawOutput: true,
  buildArgv: (params) => buildIssueCommentArgv(params),
  shape: (rawText) => ({ url: extractString(rawText, '').trim() }),
};

// ─── issue.close ─────────────────────────────────────────────────────────────

/** Accepted parameters for issue.close. */
const ISSUE_CLOSE_PARAMS: Readonly<Record<string, ParamKind>> = {
  number: 'number',
  reason: 'closeReason',
  repo: 'repo',
};

/**
 * Validates parameters for issue.close.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002
 */
export function validateIssueCloseParams(
  params: Record<string, unknown>,
): ValidationError | null {
  return validateParams(ISSUE_CLOSE_PARAMS, params);
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
  requiredParams: ['number'],
  mutating: true,
  params: ISSUE_CLOSE_PARAMS,
  rawOutput: true,
  buildArgv: (params) => buildIssueCloseArgv(params),
  shape: (_rawText, params) => ({
    number: typeof params.number === 'number' ? params.number : null,
    state: 'closed',
  }),
};
