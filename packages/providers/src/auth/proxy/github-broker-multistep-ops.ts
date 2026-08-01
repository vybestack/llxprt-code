/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Multi-step mutating operations: issue.edit and pr.resolve-thread.
 *
 * These are the two operations that retire `gh api` from the workflow.
 * Issue type has no `gh issue edit` flag and review-thread resolution has
 * no CLI surface at all, so both reach for GraphQL — but the caller never
 * writes a query, which is the entire point.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002, REQ-008, REQ-009, REQ-012
 * @pseudocode 003-github-broker.md lines 38-55
 */

import type {
  GhRunner,
  OpDescriptor,
  ParamKind,
} from './github-broker-types.js';
import { validateParams } from './github-broker-validation.js';
import {
  brokerError,
  type BrokerErrorException,
} from './github-broker-errors.js';
import { appendMulti, appendRepo, appendString } from './github-broker-argv.js';

/**
 * Raises an INVALID_PARAM failure for a caller-supplied value that cannot be
 * satisfied, e.g. an issue type name the repository does not define.
 *
 * Uses the shared BrokerErrorException so the dispatcher's instanceof check
 * recognises it; a module-local error class would have its structured code
 * silently downgraded to GITHUB_ERROR.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002
 */
function invalidParam(message: string): BrokerErrorException {
  return brokerError('INVALID_PARAM', message);
}

/** Reads a nested property path from parsed GraphQL output. */
function dig(root: unknown, path: readonly string[]): unknown {
  let cursor: unknown = root;
  for (const key of path) {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

// ─── issue.edit ──────────────────────────────────────────────────────────────

/** Accepted parameters for issue.edit. */
const ISSUE_EDIT_PARAMS: Readonly<Record<string, ParamKind>> = {
  number: 'number',
  title: 'freetext',
  body: 'body',
  addLabel: 'label',
  removeLabel: 'label',
  addAssignee: 'assignee',
  removeAssignee: 'assignee',
  addProject: 'project',
  removeProject: 'project',
  milestone: 'milestone',
  type: 'freetext',
  repo: 'repo',
};

/**
 * Builds argv for the `gh issue edit` portion of issue.edit. Pure.
 *
 * Deliberately excludes `type`: gh has no issue-type flag, so that field is
 * handled by the GraphQL step instead.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002, REQ-009
 */
export function buildIssueEditArgv(params: Record<string, unknown>): string[] {
  const argv: string[] = ['issue', 'edit', String(params.number)];
  appendString(argv, '--title', params.title);
  appendString(argv, '--body-file', params.body);
  appendMulti(argv, '--add-label', params.addLabel);
  appendMulti(argv, '--remove-label', params.removeLabel);
  appendMulti(argv, '--add-assignee', params.addAssignee);
  appendMulti(argv, '--remove-assignee', params.removeAssignee);
  appendMulti(argv, '--add-project', params.addProject);
  appendMulti(argv, '--remove-project', params.removeProject);
  appendString(argv, '--milestone', params.milestone);
  appendRepo(argv, params);
  return argv;
}

/**
 * True when any field handled by `gh issue edit` was supplied. When only
 * `type` is present the CLI step is skipped entirely.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002
 */
export function hasCliEditFields(params: Record<string, unknown>): boolean {
  return [
    'title',
    'body',
    'addLabel',
    'removeLabel',
    'addAssignee',
    'removeAssignee',
    'addProject',
    'removeProject',
    'milestone',
  ].some((key) => params[key] !== undefined);
}

/** Splits `owner/name`; returns null when absent or malformed. */
function splitRepo(repo: unknown): { owner: string; name: string } | null {
  if (typeof repo !== 'string') return null;
  const [owner, name] = repo.split('/');
  return owner && name ? { owner, name } : null;
}

/**
 * Resolves an issue-type NAME to its node id for the target repository.
 *
 * Fails fast naming the available types when there is no match, because
 * silently doing nothing is the worst outcome: the caller believes the type
 * was set.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002
 */
async function resolveIssueTypeId(
  run: GhRunner,
  owner: string,
  name: string,
  typeName: string,
): Promise<string> {
  const query = `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){issueTypes(first:50){nodes{id name}}}}`;
  const raw = await run([
    'api',
    'graphql',
    '-f',
    `query=${query}`,
    '-f',
    `owner=${owner}`,
    '-f',
    `name=${name}`,
  ]);
  const nodes = dig(raw, ['data', 'repository', 'issueTypes', 'nodes']);
  const list = Array.isArray(nodes) ? nodes : [];
  const available: string[] = [];
  for (const node of list) {
    const obj = (node ?? {}) as Record<string, unknown>;
    const nodeName = typeof obj.name === 'string' ? obj.name : '';
    if (nodeName) available.push(nodeName);
    if (
      nodeName.toLowerCase() === typeName.toLowerCase() &&
      typeof obj.id === 'string'
    ) {
      return obj.id;
    }
  }
  throw invalidParam(
    `Unknown issue type "${typeName}". Available types: ${
      available.length > 0 ? available.join(', ') : '(none defined)'
    }`,
  );
}

/** Resolves an issue number to its GraphQL node id. */
async function resolveIssueNodeId(
  run: GhRunner,
  owner: string,
  name: string,
  number: number,
): Promise<string> {
  const query = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issue(number:$number){id}}}`;
  const raw = await run([
    'api',
    'graphql',
    '-f',
    `query=${query}`,
    '-f',
    `owner=${owner}`,
    '-f',
    `name=${name}`,
    '-F',
    `number=${number}`,
  ]);
  const id = dig(raw, ['data', 'repository', 'issue', 'id']);
  if (typeof id !== 'string') {
    throw invalidParam(`Issue #${number} not found in ${owner}/${name}`);
  }
  return id;
}

/**
 * Determines the owner/name to target: the explicit repo parameter, or the
 * current repository resolved through gh.
 */
export async function resolveOwnerName(
  run: GhRunner,
  params: Record<string, unknown>,
): Promise<{ owner: string; name: string }> {
  const explicit = splitRepo(params.repo);
  if (explicit) return explicit;
  const raw = await run(['repo', 'view', '--json', 'owner,name']);
  const owner = dig(raw, ['owner', 'login']);
  const name = dig(raw, ['name']);
  if (typeof owner !== 'string' || typeof name !== 'string') {
    throw invalidParam(
      'Could not determine the current repository; pass repo explicitly',
    );
  }
  return { owner, name };
}

/**
 * Executes issue.edit: `gh issue edit` for the fields the CLI supports,
 * then a GraphQL updateIssue when an issue type was requested.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002, REQ-008, REQ-009
 */
export async function executeIssueEdit(
  params: Record<string, unknown>,
  run: GhRunner,
): Promise<{ number: number | null; type: string | null }> {
  if (hasCliEditFields(params)) {
    await run(buildIssueEditArgv(params), { rawOutput: true });
  }

  const typeName = params.type;
  if (typeof typeName === 'string' && typeName.length > 0) {
    const { owner, name } = await resolveOwnerName(run, params);
    const number = Number(params.number);
    const [issueTypeId, issueId] = await Promise.all([
      resolveIssueTypeId(run, owner, name, typeName),
      resolveIssueNodeId(run, owner, name, number),
    ]);
    const mutation = `mutation($id:ID!,$typeId:ID!){updateIssue(input:{id:$id,issueTypeId:$typeId}){issue{number}}}`;
    await run([
      'api',
      'graphql',
      '-f',
      `query=${mutation}`,
      '-f',
      `id=${issueId}`,
      '-f',
      `typeId=${issueTypeId}`,
    ]);
  }

  return {
    number: typeof params.number === 'number' ? params.number : null,
    type: typeof typeName === 'string' ? typeName : null,
  };
}

/** The issue.edit operation descriptor. */
export const issueEditDescriptor: OpDescriptor = {
  name: 'issue.edit',
  requiredParams: ['number'],
  mutating: true,
  params: ISSUE_EDIT_PARAMS,
  bodyParams: ['body'],
  buildArgv: (params) => buildIssueEditArgv(params),
  shape: (_raw, params) => ({
    number: typeof params.number === 'number' ? params.number : null,
  }),
  execute: (params, run) => executeIssueEdit(params, run),
};

// ─── pr.resolve-thread ───────────────────────────────────────────────────────

/** Accepted parameters for pr.resolve-thread. */
const PR_RESOLVE_THREAD_PARAMS: Readonly<Record<string, ParamKind>> = {
  threadId: 'threadId',
  repo: 'repo',
};

/**
 * Executes pr.resolve-thread via the resolveReviewThread mutation.
 *
 * ResolveReviewThreadInput accepts only clientMutationId and threadId, so
 * no other field is sent. The threadId is exactly what pr.reviews returns,
 * which is why listing actionable threads and resolving them compose
 * without a second round trip.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002, REQ-008
 */
export async function executeResolveThread(
  params: Record<string, unknown>,
  run: GhRunner,
): Promise<{ threadId: string; isResolved: boolean }> {
  const threadId = String(params.threadId);
  const mutation = `mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{id isResolved}}}`;
  const raw = await run([
    'api',
    'graphql',
    '-f',
    `query=${mutation}`,
    '-f',
    `threadId=${threadId}`,
  ]);
  const resolved = dig(raw, [
    'data',
    'resolveReviewThread',
    'thread',
    'isResolved',
  ]);
  return { threadId, isResolved: resolved === true };
}

/** The pr.resolve-thread operation descriptor. */
export const prResolveThreadDescriptor: OpDescriptor = {
  name: 'pr.resolve-thread',
  requiredParams: ['threadId'],
  mutating: true,
  params: PR_RESOLVE_THREAD_PARAMS,
  buildArgv: () => ['api', 'graphql'],
  shape: (_raw, params) => ({ threadId: String(params.threadId) }),
  execute: (params, run) => executeResolveThread(params, run),
};

/**
 * Validates parameters for issue.edit.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002
 */
export function validateIssueEditParams(params: Record<string, unknown>) {
  return validateParams(ISSUE_EDIT_PARAMS, params);
}

/**
 * Validates parameters for pr.resolve-thread.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002
 */
export function validateResolveThreadParams(params: Record<string, unknown>) {
  return validateParams(PR_RESOLVE_THREAD_PARAMS, params);
}
