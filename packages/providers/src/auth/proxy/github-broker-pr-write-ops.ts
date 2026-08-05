/**
 * @license
 * Copyright 2026 Vybestack LLC
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

import type { OpDescriptor, ValidationError } from './github-broker-types.js';
import { validateParams } from './github-broker-validation.js';
import { GITHUB_OP_SPECS } from '@vybestack/llxprt-code-tools/tools/github-ops.js';
import { extractString } from './github-broker-shaping.js';
import { shapeCreatedUrl } from './github-broker-issue-write-ops.js';
import { appendMulti, appendRepo, appendString } from './github-broker-argv.js';

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

/**
 * Validates parameters for pr.create.
 *
 * @plan PLAN-20260731-GHBROKER.P11, PLAN-20260731-GHBROKER.P15
 * @requirement REQ-002
 */
export function validatePrCreateParams(
  params: Record<string, unknown>,
): ValidationError | null {
  return validateParams(GITHUB_OP_SPECS['pr.create'].params, params);
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
  requiredParams: GITHUB_OP_SPECS['pr.create'].required,
  mutating: GITHUB_OP_SPECS['pr.create'].mutating,
  params: GITHUB_OP_SPECS['pr.create'].params,
  bodyParams: ['body'],
  rawOutput: true,
  buildArgv: (params) => buildPrCreateArgv(params),
  shape: (rawText) => shapeCreatedUrl(rawText),
};

// ─── pr.comment ──────────────────────────────────────────────────────────────

/**
 * Validates parameters for pr.comment.
 *
 * @plan PLAN-20260731-GHBROKER.P11, PLAN-20260731-GHBROKER.P15
 * @requirement REQ-002
 */
export function validatePrCommentParams(
  params: Record<string, unknown>,
): ValidationError | null {
  return validateParams(GITHUB_OP_SPECS['pr.comment'].params, params);
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
  requiredParams: GITHUB_OP_SPECS['pr.comment'].required,
  mutating: GITHUB_OP_SPECS['pr.comment'].mutating,
  params: GITHUB_OP_SPECS['pr.comment'].params,
  bodyParams: ['body'],
  rawOutput: true,
  buildArgv: (params) => buildPrCommentArgv(params),
  shape: (rawText) => ({ url: extractString(rawText, '').trim() }),
};

// ─── pr.edit ─────────────────────────────────────────────────────────────────

/**
 * Validates parameters for pr.edit.
 *
 * @plan PLAN-20260731-GHBROKER.P11, PLAN-20260731-GHBROKER.P15
 * @requirement REQ-002
 */
export function validatePrEditParams(
  params: Record<string, unknown>,
): ValidationError | null {
  return validateParams(GITHUB_OP_SPECS['pr.edit'].params, params);
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
  appendMulti(argv, '--add-label', params.addLabel);
  appendMulti(argv, '--remove-label', params.removeLabel);
  appendMulti(argv, '--add-assignee', params.addAssignee);
  appendString(argv, '--milestone', params.milestone);
  appendRepo(argv, params);
  return argv;
}

/** The pr.edit operation descriptor. */
export const prEditDescriptor: OpDescriptor = {
  name: 'pr.edit',
  requiredParams: GITHUB_OP_SPECS['pr.edit'].required,
  mutating: GITHUB_OP_SPECS['pr.edit'].mutating,
  params: GITHUB_OP_SPECS['pr.edit'].params,
  bodyParams: ['body'],
  rawOutput: true,
  buildArgv: (params) => buildPrEditArgv(params),
  shape: (_rawText, params) => shapeNumberOnly(params),
};

// ─── pr.ready ────────────────────────────────────────────────────────────────

/**
 * Validates parameters for pr.ready.
 *
 * @plan PLAN-20260731-GHBROKER.P11, PLAN-20260731-GHBROKER.P15
 * @requirement REQ-002
 */
export function validatePrReadyParams(
  params: Record<string, unknown>,
): ValidationError | null {
  return validateParams(GITHUB_OP_SPECS['pr.ready'].params, params);
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
  requiredParams: GITHUB_OP_SPECS['pr.ready'].required,
  mutating: GITHUB_OP_SPECS['pr.ready'].mutating,
  params: GITHUB_OP_SPECS['pr.ready'].params,
  rawOutput: true,
  buildArgv: (params) => buildPrReadyArgv(params),
  shape: (_rawText, params) => shapeNumberOnly(params),
};

// ─── label.create ────────────────────────────────────────────────────────────

/**
 * Validates parameters for label.create.
 *
 * @plan PLAN-20260731-GHBROKER.P11, PLAN-20260731-GHBROKER.P15
 * @requirement REQ-002
 */
export function validateLabelCreateParams(
  params: Record<string, unknown>,
): ValidationError | null {
  return validateParams(GITHUB_OP_SPECS['label.create'].params, params);
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
  requiredParams: GITHUB_OP_SPECS['label.create'].required,
  mutating: GITHUB_OP_SPECS['label.create'].mutating,
  params: GITHUB_OP_SPECS['label.create'].params,
  rawOutput: true,
  buildArgv: (params) => buildLabelCreateArgv(params),
  shape: (_rawText, params) => ({
    name: typeof params.name === 'string' ? params.name : '',
  }),
};
