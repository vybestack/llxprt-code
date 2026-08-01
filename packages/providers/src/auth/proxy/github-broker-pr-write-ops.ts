/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Mutating PR-family and label-family operation descriptors: pr.create,
 * pr.comment, pr.edit, pr.ready and label.create.
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
import { shapeCreatedUrl } from './github-broker-issue-write-ops.js';

/**
 * Appends `--repo owner/name` when a repo parameter is present.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-009
 */
function appendRepo(argv: string[], params: Record<string, unknown>): void {
  if (typeof params.repo === 'string') argv.push('--repo', params.repo);
}

/**
 * Appends `flag value` when the value is a non-empty string.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002
 */
function appendString(argv: string[], flag: string, value: unknown): void {
  if (typeof value === 'string' && value.length > 0) argv.push(flag, value);
}

/**
 * Appends each element of a repeatable string-array parameter.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002
 */
function appendRepeatable(argv: string[], flag: string, value: unknown): void {
  if (!Array.isArray(value)) return;
  for (const entry of value) {
    if (typeof entry === 'string') argv.push(flag, entry);
  }
}

/**
 * Shapes a response carrying only the operated-on number.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-013
 */
function shapeNumberOnly(params: Record<string, unknown>): {
  number: number | null;
} {
  return { number: typeof params.number === 'number' ? params.number : null };
}

// ─── pr.create ───────────────────────────────────────────────────────────────

/** Accepted parameters for pr.create. */
const PR_CREATE_PARAMS: Readonly<Record<string, ParamKind>> = {
  title: 'freetext',
  body: 'body',
  base: 'branch',
  head: 'branch',
  draft: 'boolean',
  repo: 'repo',
};

/**
 * Validates parameters for pr.create.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002
 */
export function validatePrCreateParams(
  params: Record<string, unknown>,
): ValidationError | null {
  return validateParams(PR_CREATE_PARAMS, params);
}

/**
 * Builds argv for pr.create. Pure.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002, REQ-009
 */
export function buildPrCreateArgv(params: Record<string, unknown>): string[] {
  const argv: string[] = ['pr', 'create'];
  appendString(argv, '--title', params.title);
  appendString(argv, '--body-file', params.body);
  appendString(argv, '--base', params.base);
  appendString(argv, '--head', params.head);
  if (params.draft === true) argv.push('--draft');
  appendRepo(argv, params);
  return argv;
}

/** The pr.create operation descriptor. */
export const prCreateDescriptor: OpDescriptor = {
  name: 'pr.create',
  mutating: true,
  params: PR_CREATE_PARAMS,
  bodyParams: ['body'],
  rawOutput: true,
  buildArgv: (params) => buildPrCreateArgv(params),
  shape: (rawText) => shapeCreatedUrl(rawText),
};

// ─── pr.comment ──────────────────────────────────────────────────────────────

/** Accepted parameters for pr.comment. */
const PR_COMMENT_PARAMS: Readonly<Record<string, ParamKind>> = {
  number: 'number',
  body: 'body',
  repo: 'repo',
};

/**
 * Validates parameters for pr.comment.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002
 */
export function validatePrCommentParams(
  params: Record<string, unknown>,
): ValidationError | null {
  return validateParams(PR_COMMENT_PARAMS, params);
}

/**
 * Builds argv for pr.comment. Pure.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002, REQ-009
 */
export function buildPrCommentArgv(params: Record<string, unknown>): string[] {
  const argv: string[] = ['pr', 'comment', String(params.number)];
  appendString(argv, '--body-file', params.body);
  appendRepo(argv, params);
  return argv;
}

/** The pr.comment operation descriptor. */
export const prCommentDescriptor: OpDescriptor = {
  name: 'pr.comment',
  mutating: true,
  params: PR_COMMENT_PARAMS,
  bodyParams: ['body'],
  rawOutput: true,
  buildArgv: (params) => buildPrCommentArgv(params),
  shape: (rawText) => ({ url: extractString(rawText, '').trim() }),
};

// ─── pr.edit ─────────────────────────────────────────────────────────────────

/** Accepted parameters for pr.edit. */
const PR_EDIT_PARAMS: Readonly<Record<string, ParamKind>> = {
  number: 'number',
  title: 'freetext',
  body: 'body',
  addLabel: 'label',
  removeLabel: 'label',
  addAssignee: 'assignee',
  milestone: 'milestone',
  repo: 'repo',
};

/**
 * Validates parameters for pr.edit.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002
 */
export function validatePrEditParams(
  params: Record<string, unknown>,
): ValidationError | null {
  return validateParams(PR_EDIT_PARAMS, params);
}

/**
 * Builds argv for pr.edit. Pure.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002, REQ-009
 */
export function buildPrEditArgv(params: Record<string, unknown>): string[] {
  const argv: string[] = ['pr', 'edit', String(params.number)];
  appendString(argv, '--title', params.title);
  appendString(argv, '--body-file', params.body);
  appendRepeatable(argv, '--add-label', params.addLabel);
  appendRepeatable(argv, '--remove-label', params.removeLabel);
  appendString(argv, '--add-assignee', params.addAssignee);
  appendString(argv, '--milestone', params.milestone);
  appendRepo(argv, params);
  return argv;
}

/** The pr.edit operation descriptor. */
export const prEditDescriptor: OpDescriptor = {
  name: 'pr.edit',
  mutating: true,
  params: PR_EDIT_PARAMS,
  bodyParams: ['body'],
  rawOutput: true,
  buildArgv: (params) => buildPrEditArgv(params),
  shape: (_rawText, params) => shapeNumberOnly(params),
};

// ─── pr.ready ────────────────────────────────────────────────────────────────

/** Accepted parameters for pr.ready. */
const PR_READY_PARAMS: Readonly<Record<string, ParamKind>> = {
  number: 'number',
  repo: 'repo',
};

/**
 * Validates parameters for pr.ready.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002
 */
export function validatePrReadyParams(
  params: Record<string, unknown>,
): ValidationError | null {
  return validateParams(PR_READY_PARAMS, params);
}

/**
 * Builds argv for pr.ready. Pure.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002, REQ-009
 */
export function buildPrReadyArgv(params: Record<string, unknown>): string[] {
  const argv: string[] = ['pr', 'ready', String(params.number)];
  appendRepo(argv, params);
  return argv;
}

/** The pr.ready operation descriptor. */
export const prReadyDescriptor: OpDescriptor = {
  name: 'pr.ready',
  mutating: true,
  params: PR_READY_PARAMS,
  rawOutput: true,
  buildArgv: (params) => buildPrReadyArgv(params),
  shape: (_rawText, params) => shapeNumberOnly(params),
};

// ─── label.create ────────────────────────────────────────────────────────────

/** Accepted parameters for label.create. */
const LABEL_CREATE_PARAMS: Readonly<Record<string, ParamKind>> = {
  name: 'freetext',
  color: 'color',
  description: 'freetext',
  force: 'boolean',
  repo: 'repo',
};

/**
 * Validates parameters for label.create.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002
 */
export function validateLabelCreateParams(
  params: Record<string, unknown>,
): ValidationError | null {
  return validateParams(LABEL_CREATE_PARAMS, params);
}

/**
 * Builds argv for label.create. Pure.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002, REQ-009
 */
export function buildLabelCreateArgv(
  params: Record<string, unknown>,
): string[] {
  const argv: string[] = ['label', 'create', String(params.name)];
  appendString(argv, '--color', params.color);
  appendString(argv, '--description', params.description);
  if (params.force === true) argv.push('--force');
  appendRepo(argv, params);
  return argv;
}

/** The label.create operation descriptor. */
export const labelCreateDescriptor: OpDescriptor = {
  name: 'label.create',
  mutating: true,
  params: LABEL_CREATE_PARAMS,
  rawOutput: true,
  buildArgv: (params) => buildLabelCreateArgv(params),
  shape: (_rawText, params) => ({
    name: typeof params.name === 'string' ? params.name : '',
  }),
};
