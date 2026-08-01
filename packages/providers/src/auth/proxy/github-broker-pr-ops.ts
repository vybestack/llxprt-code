/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pull-request-family operation descriptors for the GitHub broker:
 * pr.list, pr.view, pr.diff, pr.checks, pr.reviews.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-009, REQ-013
 * @pseudocode 003-github-broker.md lines 38-55, 101-126
 */

import type {
  OpDescriptor,
  ParamKind,
  ValidationError,
} from './github-broker-types.js';
import { resolveLimit, validateParams } from './github-broker-validation.js';
import { watchChecks } from './github-broker-watch.js';
import { resolveOwnerName } from './github-broker-multistep-ops.js';
import {
  assertNotPartialSuccess,
  extractAuthor,
  extractComments,
  extractLabels,
  extractNumber,
  extractString,
  truncateWithMarker,
  type ShapedComment,
  assertListShape,
} from './github-broker-shaping.js';

// ─── pr.list ─────────────────────────────────────────────────────────────────

/**
 * The accepted parameters for pr.list.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-009, REQ-013
 * @pseudocode 003-github-broker.md lines 120-123
 */
const PR_LIST_PARAMS: Readonly<Record<string, ParamKind>> = {
  state: 'state',
  limit: 'limit',
  repo: 'repo',
};

/**
 * Validates parameters for the pr.list operation.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines 13-31
 */
export function validatePrListParams(
  params: Record<string, unknown>,
): ValidationError | null {
  return validateParams(PR_LIST_PARAMS, params);
}

/**
 * Builds the `gh` argv array for pr.list. Pure; no I/O.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-009, REQ-013
 * @pseudocode 003-github-broker.md lines 46-55, 120-123
 */
export function buildPrListArgv(params: Record<string, unknown>): string[] {
  const argv: string[] = [
    'pr',
    'list',
    '--json',
    'number,title,state,labels,updatedAt',
  ];
  if (typeof params.state === 'string') {
    argv.push('--state', params.state);
  }
  argv.push('--limit', String(resolveLimit(params)));
  if (typeof params.repo === 'string') {
    argv.push('--repo', params.repo);
  }
  return argv;
}

/**
 * A single shaped PR in the pr.list contract. Bodies are excluded.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 120-123
 */
export interface ShapedPrListItem {
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly labels: readonly string[];
  readonly updatedAt: string;
}

/**
 * Shapes raw gh JSON for pr.list into an array of list items. Bodies are
 * NEVER included.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 120-123
 */
export function shapePrList(rawJson: unknown): readonly ShapedPrListItem[] {
  assertNotPartialSuccess(rawJson);
  assertListShape(rawJson, 'pr.list');
  return rawJson.map((item): ShapedPrListItem => {
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
 * The pr.list operation descriptor.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-013
 * @pseudocode 003-github-broker.md lines 38-44, 120-123
 */
export const prListDescriptor: OpDescriptor = {
  name: 'pr.list',
  mutating: false,
  params: PR_LIST_PARAMS,
  buildArgv: (params) => buildPrListArgv(params),
  shape: (rawJson) => ({ prs: shapePrList(rawJson) }),
};

// ─── pr.view ─────────────────────────────────────────────────────────────────

/**
 * The accepted parameters for pr.view.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-009, REQ-013
 * @pseudocode 003-github-broker.md lines 101-103
 */
const PR_VIEW_PARAMS: Readonly<Record<string, ParamKind>> = {
  number: 'number',
  comments: 'boolean',
  repo: 'repo',
};

/**
 * Validates parameters for the pr.view operation.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines 13-31
 */
export function validatePrViewParams(
  params: Record<string, unknown>,
): ValidationError | null {
  if (params.number === undefined) {
    return {
      code: 'INVALID_PARAM',
      message: 'Parameter number is required',
    };
  }
  return validateParams(PR_VIEW_PARAMS, params);
}

/**
 * Builds the `gh` argv array for pr.view. Pure; no I/O.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-009, REQ-013
 * @pseudocode 003-github-broker.md lines 46-55
 */
export function buildPrViewArgv(
  params: Record<string, unknown>,
  comments: boolean,
): string[] {
  const number = String(params.number);
  const fields = comments
    ? 'number,title,state,author,body,labels,isDraft,reviewDecision,headRefName,baseRefName,comments'
    : 'number,title,state,author,body,labels,isDraft,reviewDecision,headRefName,baseRefName';
  const argv = ['pr', 'view', number, '--json', fields];
  if (typeof params.repo === 'string') {
    argv.push('--repo', params.repo);
  }
  return argv;
}

/**
 * The shaped pr.view contract. Mirrors issue.view with PR-specific fields.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 101-103
 */
export interface ShapedPrView {
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly author: string;
  readonly labels: readonly string[];
  readonly body: string;
  readonly isDraft: boolean;
  readonly reviewDecision: string;
  readonly headRefName: string;
  readonly baseRefName: string;
  readonly comments: readonly ShapedComment[] | null;
}

/**
 * Shapes raw gh JSON for pr.view into the contract. Pure; no I/O.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 101-103
 */
export function shapePrView(rawJson: unknown): ShapedPrView {
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
    isDraft: raw.isDraft === true,
    reviewDecision: extractString(raw.reviewDecision, ''),
    headRefName: extractString(raw.headRefName, ''),
    baseRefName: extractString(raw.baseRefName, ''),
    comments: extractComments(raw.comments),
  };
}

/**
 * The pr.view operation descriptor.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-013
 * @pseudocode 003-github-broker.md lines 38-44
 */
export const prViewDescriptor: OpDescriptor = {
  name: 'pr.view',
  requiredParams: ['number'],
  mutating: false,
  params: PR_VIEW_PARAMS,
  buildArgv: (params) => {
    const comments = params.comments === true;
    return buildPrViewArgv(params, comments);
  },
  shape: (rawJson) => shapePrView(rawJson),
};

// ─── pr.diff ─────────────────────────────────────────────────────────────────

/**
 * The accepted parameters for pr.diff.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-009, REQ-013
 * @pseudocode 003-github-broker.md lines 125-126
 */
const PR_DIFF_PARAMS: Readonly<Record<string, ParamKind>> = {
  number: 'number',
  repo: 'repo',
};

/**
 * Validates parameters for the pr.diff operation.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines 13-31
 */
export function validatePrDiffParams(
  params: Record<string, unknown>,
): ValidationError | null {
  if (params.number === undefined) {
    return {
      code: 'INVALID_PARAM',
      message: 'Parameter number is required',
    };
  }
  return validateParams(PR_DIFF_PARAMS, params);
}

/**
 * Builds the `gh` argv array for pr.diff. Pure; no I/O.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-009, REQ-013
 * @pseudocode 003-github-broker.md lines 46-55, 125-126
 */
export function buildPrDiffArgv(params: Record<string, unknown>): string[] {
  const number = String(params.number);
  const argv = ['pr', 'diff', number];
  if (typeof params.repo === 'string') {
    argv.push('--repo', params.repo);
  }
  return argv;
}

/**
 * The shaped pr.diff contract: truncated unified diff text with optional
 * truncation metadata.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 125-126
 */
export interface ShapedPrDiff {
  readonly diff: string;
  readonly truncated: { field: string; originalBytes: number } | null;
}

/**
 * Shapes raw diff TEXT (not JSON) for pr.diff. Truncates at 64 KiB with
 * a marker if the diff is oversized.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 125-126
 */
export function shapePrDiff(rawText: unknown): ShapedPrDiff {
  const text = typeof rawText === 'string' ? rawText : '';
  const { value, truncated } = truncateWithMarker(text, 'diff');
  return { diff: value, truncated };
}

/**
 * The pr.diff operation descriptor. rawOutput=true so the dispatcher
 * passes the raw text to shape without JSON-parsing.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-013
 * @pseudocode 003-github-broker.md lines 38-44, 125-126
 */
export const prDiffDescriptor: OpDescriptor = {
  name: 'pr.diff',
  requiredParams: ['number'],
  mutating: false,
  params: PR_DIFF_PARAMS,
  buildArgv: (params) => buildPrDiffArgv(params),
  shape: (rawText) => shapePrDiff(rawText),
  rawOutput: true,
};

// ─── pr.checks ───────────────────────────────────────────────────────────────

/**
 * The accepted parameters for pr.checks.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-009, REQ-013
 * @pseudocode 003-github-broker.md lines 105-109
 */
const PR_CHECKS_PARAMS: Readonly<Record<string, ParamKind>> = {
  number: 'number',
  repo: 'repo',
  watch: 'boolean',
};

/**
 * Validates parameters for the pr.checks operation.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines 13-31
 */
export function validatePrChecksParams(
  params: Record<string, unknown>,
): ValidationError | null {
  if (params.number === undefined) {
    return {
      code: 'INVALID_PARAM',
      message: 'Parameter number is required',
    };
  }
  return validateParams(PR_CHECKS_PARAMS, params);
}

/**
 * Builds the `gh` argv array for pr.checks. Pure; no I/O.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-009, REQ-013
 * @pseudocode 003-github-broker.md lines 46-55, 105-109
 */
export function buildPrChecksArgv(params: Record<string, unknown>): string[] {
  const number = String(params.number);
  const argv = ['pr', 'checks', number, '--json', 'name,state,bucket,link'];
  if (typeof params.repo === 'string') {
    argv.push('--repo', params.repo);
  }
  return argv;
}

/**
 * A single shaped check in the pr.checks contract.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 105-109
 */
export interface ShapedCheck {
  readonly name: string;
  readonly bucket: string;
  readonly state: string;
  readonly link: string;
}

/**
 * The shaped pr.checks contract. Summary counts are derived from the
 * `bucket` field that gh already provides (pass|fail|pending|skipping).
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 105-109
 */
export interface ShapedPrChecks {
  readonly checks: readonly ShapedCheck[];
  readonly summary: {
    readonly pass: number;
    readonly fail: number;
    readonly pending: number;
    readonly skipping: number;
  };
}

/**
 * Shapes raw gh JSON for pr.checks. Summary counts by the `bucket` field.
 * Do NOT re-derive state from the state string — gh already provides bucket.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 105-109
 */
export function shapePrChecks(rawJson: unknown): ShapedPrChecks {
  assertNotPartialSuccess(rawJson);
  const checks: ShapedCheck[] = [];
  if (Array.isArray(rawJson)) {
    for (const item of rawJson) {
      const obj = (item ?? {}) as Record<string, unknown>;
      checks.push({
        name: extractString(obj.name, ''),
        bucket: extractString(obj.bucket, ''),
        state: extractString(obj.state, ''),
        link: extractString(obj.link, ''),
      });
    }
  }
  const summary = countByBucket(checks);
  return { checks, summary };
}

/**
 * Counts checks by their bucket field.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 105-109
 */
function countByBucket(checks: readonly ShapedCheck[]): {
  pass: number;
  fail: number;
  pending: number;
  skipping: number;
} {
  const counts = { pass: 0, fail: 0, pending: 0, skipping: 0 };
  for (const c of checks) {
    if (c.bucket === 'pass') counts.pass++;
    else if (c.bucket === 'fail') counts.fail++;
    else if (c.bucket === 'pending') counts.pending++;
    else if (c.bucket === 'skipping') counts.skipping++;
  }
  return counts;
}

/**
 * The pr.checks operation descriptor. tolerateNonZeroExit=true because gh
 * exits non-zero when checks are failing or pending, which is NOT an error
 * for this op.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-013
 * @pseudocode 003-github-broker.md lines 38-44, 105-109
 */
export const prChecksDescriptor: OpDescriptor = {
  name: 'pr.checks',
  requiredParams: ['number'],
  mutating: false,
  params: PR_CHECKS_PARAMS,
  buildArgv: (params) => buildPrChecksArgv(params),
  shape: (rawJson) => shapePrChecks(rawJson),
  tolerateNonZeroExit: true,
  /**
   * With `watch: true` the host owns the polling loop and the call blocks
   * until CI concludes, replacing the pattern where the model polls itself
   * and fights tool timeouts. Without it, this is a single call.
   *
   * @plan PLAN-20260731-GHBROKER.P13
   * @requirement REQ-007, REQ-010
   */
  execute: async (params, run, signal) => {
    const argv = buildPrChecksArgv(params);
    if (params.watch !== true) {
      return shapePrChecks(await run(argv, { tolerateNonZeroExit: true }));
    }
    return watchChecks(argv, run, signal);
  },
};

// ─── pr.reviews ──────────────────────────────────────────────────────────────

/**
 * The accepted parameters for pr.reviews.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-009, REQ-013
 * @pseudocode 003-github-broker.md lines 111-118
 */
const PR_REVIEWS_PARAMS: Readonly<Record<string, ParamKind>> = {
  number: 'number',
  actionable: 'boolean',
  repo: 'repo',
};

/**
 * Validates parameters for the pr.reviews operation.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines 13-31
 */
export function validatePrReviewsParams(
  params: Record<string, unknown>,
): ValidationError | null {
  if (params.number === undefined) {
    return {
      code: 'INVALID_PARAM',
      message: 'Parameter number is required',
    };
  }
  return validateParams(PR_REVIEWS_PARAMS, params);
}

/**
 * GraphQL query for fetching review threads. Selects id, isResolved,
 * isOutdated, path, line, viewerCanResolve, and comments nodes.
 *
 * This op uses `gh api graphql` because review thread resolution state is
 * NOT available through `gh pr view --json`.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 111-118
 */
const REVIEW_THREADS_QUERY = `query ReviewThreads($owner: String!, $name: String!, $number: Int!, $first: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: $first) {
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          viewerCanResolve
          comments(first: 100) {
            nodes {
              author { login }
              body
            }
          }
        }
      }
    }
  }
}`;

/**
 * Maximum number of review threads to fetch in a single page.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 111-118
 */
const MAX_REVIEW_THREADS = 50;

/**
 * Builds the `gh` argv array for pr.reviews (uses gh api graphql). Pure;
 * no I/O.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-009, REQ-013
 * @pseudocode 003-github-broker.md lines 46-55, 111-118
 */
export function buildPrReviewsArgv(
  params: Record<string, unknown>,
  owner?: string,
  name?: string,
): string[] {
  const prNumber = String(params.number);
  const repoStr = typeof params.repo === 'string' ? params.repo : '';
  const [repoOwner = '', repoName = ''] = repoStr.split('/');
  const validOwner = owner ?? repoOwner;
  const validName = name ?? repoName;
  const query = REVIEW_THREADS_QUERY.replace(/\s+/g, ' ').trim();
  const argv = [
    'api',
    'graphql',
    '-f',
    `query=${query}`,
    '-f',
    `owner=${validOwner}`,
    '-f',
    `name=${validName}`,
    '-F',
    `number=${prNumber}`,
    '-F',
    `first=${MAX_REVIEW_THREADS}`,
  ];
  return argv;
}

/**
 * A single shaped review comment.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 111-118
 */
export interface ShapedReviewComment {
  readonly author: string;
  readonly body: string;
}

/**
 * A single shaped review thread.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 111-118
 */
export interface ShapedReviewThread {
  readonly id: string;
  readonly path: string;
  readonly line: number;
  readonly isResolved: boolean;
  readonly isOutdated: boolean;
  readonly viewerCanResolve: boolean;
  readonly comments: readonly ShapedReviewComment[];
}

/**
 * The shaped pr.reviews contract.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 111-118
 */
export interface ShapedPrReviews {
  readonly threads: readonly ShapedReviewThread[];
  readonly truncated: boolean;
}

/**
 * Shapes raw GraphQL JSON for pr.reviews into the contract. Pure; no I/O.
 *
 * When actionable is true, EXCLUDES threads where isResolved or isOutdated
 * is true. This is the core ask of issue #135: it drops summary-only
 * review bodies and leaves exactly the items needing action.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 111-118
 */
export function shapePrReviews(
  rawJson: unknown,
  actionable: boolean,
): ShapedPrReviews {
  if (rawJson === null || typeof rawJson !== 'object') {
    return { threads: [], truncated: false };
  }
  assertNotPartialSuccess(rawJson);
  const nodes = extractThreadNodes(rawJson);
  const threads: ShapedReviewThread[] = [];
  let truncated = false;
  for (const node of nodes) {
    const thread = shapeThread(node);
    if (actionable && (thread.isResolved || thread.isOutdated)) {
      continue;
    }
    threads.push(thread);
  }
  if (nodes.length >= MAX_REVIEW_THREADS) {
    truncated = true;
  }
  return { threads, truncated };
}

/**
 * Extracts the review thread nodes from a GraphQL response.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 111-118
 */
function extractThreadNodes(rawJson: unknown): readonly unknown[] {
  const data = navigatePath(rawJson, [
    'data',
    'repository',
    'pullRequest',
    'reviewThreads',
    'nodes',
  ]);
  return Array.isArray(data) ? data : [];
}

/**
 * Navigates a nested object by a path of keys, returning the value at the
 * end or undefined. Defensive parsing of external GraphQL data.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 */
function navigatePath(obj: unknown, path: readonly string[]): unknown {
  let current: unknown = obj;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Shapes a single GraphQL review thread node.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 111-118
 */
function shapeThread(node: unknown): ShapedReviewThread {
  const obj = (node ?? {}) as Record<string, unknown>;
  return {
    id: extractString(obj.id, ''),
    path: extractString(obj.path, ''),
    line: extractNumber(obj.line),
    isResolved: obj.isResolved === true,
    isOutdated: obj.isOutdated === true,
    viewerCanResolve: obj.viewerCanResolve === true,
    comments: extractReviewComments(obj.comments),
  };
}

/**
 * Extracts shaped review comments from a GraphQL comments connection.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 */
function extractReviewComments(value: unknown): readonly ShapedReviewComment[] {
  const nodes = navigatePath(value, ['nodes']);
  if (!Array.isArray(nodes)) return [];
  return nodes.map((node): ShapedReviewComment => {
    const obj = (node ?? {}) as Record<string, unknown>;
    return {
      author: extractAuthor(obj.author),
      body: extractString(obj.body, ''),
    };
  });
}

/**
 * The pr.reviews operation descriptor. usesGraphql=true so the dispatcher
 * applies GraphQL partial-success validation. The shape function receives
 * the actionable flag from params to filter resolved/outdated threads.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-013
 * @pseudocode 003-github-broker.md lines 38-44, 111-118
 */
export const prReviewsDescriptor: OpDescriptor = {
  name: 'pr.reviews',
  requiredParams: ['number'],
  mutating: false,
  params: PR_REVIEWS_PARAMS,
  buildArgv: (params) => buildPrReviewsArgv(params),
  shape: (rawJson, params) =>
    shapePrReviews(rawJson, params.actionable === true),
  usesGraphql: true,
  /**
   * GraphQL cannot infer the repository the way `gh` infers it for --repo,
   * so when repo is omitted the owner and name must be resolved first.
   * Interpolating empty strings instead produced a baffling GraphQL error
   * for the ordinary "current repo" case.
   *
   * @plan PLAN-20260731-GHBROKER.P19
   * @requirement REQ-009
   */
  execute: async (params, run) => {
    let owner: string | undefined;
    let name: string | undefined;
    if (typeof params.repo !== 'string') {
      const resolved = await resolveOwnerName(run, params);
      owner = resolved.owner;
      name = resolved.name;
    }
    const raw = await run(buildPrReviewsArgv(params, owner, name));
    return shapePrReviews(raw, params.actionable === true);
  },
};
