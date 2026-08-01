/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Operation descriptors, parameter validation, argv construction, and
 * response shaping for the GitHub broker.
 *
 * Each operation is described by an OpDescriptor: name, mutating flag,
 * params spec, a pure buildArgv(params), and a pure shape(rawJson).
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002, REQ-004, REQ-013
 * @pseudocode 003-github-broker.md lines 13-55, 101-103
 */

import type {
  OpDescriptor,
  ParamKind,
  ValidationError,
} from './github-broker-types.js';
import { mapGraphQLErrorType } from './github-broker-errors.js';

// ─── Validation regexes (pseudocode lines 17-21) ─────────────────────────────

/**
 * Regex for the repo parameter: `owner/name` where owner and name each
 * match `[A-Za-z0-9._-]+`.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002, REQ-009
 * @pseudocode 003-github-broker.md line 17
 */
const REPO_REGEX = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

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
 * Rejects:
 * - missing or invalid `number` (must be positive integer)
 * - `repo` that does not match the owner/name regex
 * - any string parameter value beginning with `-` (flag injection defense)
 * - unknown parameters (fail fast, not ignored)
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
 * When comments is true, the `comments` field is included in `--json`; when
 * false, it is omitted so the response does not carry comment bodies.
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
 * The shaped comment in the issue.view contract.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 101-103
 */
interface ShapedComment {
  readonly author: string;
  readonly createdAt: string;
  readonly body: string;
}

/**
 * The shaped issue.view contract.
 *
 * Comments are included only when the raw JSON has a comments array; when
 * absent, the field is null so the caller can distinguish "not requested"
 * from "zero comments".
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
 * Defensive parsing is correct here because the input is a GitHub API
 * response (genuinely external).
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 101-103
 */
/**
 * Maps a GraphQL error type to a broker error code string for use during
 * shaping (where we throw rather than return a structured result).
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-004
 * @pseudocode 003-github-broker.md lines 67-76
 */
function mapGraphQLErrorTypeForShaping(type: string | undefined): string {
  return mapGraphQLErrorType(type ?? '');
}

export function shapeIssueView(rawJson: unknown): ShapedIssueView {
  if (rawJson === null || typeof rawJson !== 'object') {
    throw new Error('GITHUB_ERROR: expected a JSON object from gh');
  }
  const raw = rawJson as Record<string, unknown>;
  // GraphQL partial success (data AND errors) must surface as an error,
  // never as partial data.
  if (
    raw.data !== undefined &&
    Array.isArray(raw.errors) &&
    raw.errors.length > 0
  ) {
    const first = raw.errors[0] as Record<string, unknown>;
    const type = typeof first.type === 'string' ? first.type : undefined;
    const message =
      typeof first.message === 'string' ? first.message : 'GraphQL error';
    throw new Error(`${mapGraphQLErrorTypeForShaping(type)}: ${message}`);
  }
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
  mutating: false,
  params: ISSUE_VIEW_PARAMS,
  buildArgv: (params) => {
    const comments = params.comments === true;
    return buildIssueViewArgv(params, comments);
  },
  shape: (rawJson) => shapeIssueView(rawJson),
};

/**
 * The registry of all operation descriptors. Unknown ops yield UNKNOWN_OP.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines 46-47
 */
export const OP_REGISTRY: Readonly<Record<string, OpDescriptor>> = {
  'issue.view': issueViewDescriptor,
};

// ─── Generic validation ─────────────────────────────────────────────────────

/**
 * Validates a params object against a param spec. Returns a ValidationError
 * or null if valid.
 *
 * Rules:
 * - unknown params are rejected (not ignored)
 * - string params beginning with `-` are rejected (flag injection defense)
 * - each param kind has its own validation
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines 13-31
 */
export function validateParams(
  spec: Readonly<Record<string, ParamKind>>,
  params: Record<string, unknown>,
): ValidationError | null {
  // Reject unknown params
  for (const key of Object.keys(params)) {
    if (!(key in spec)) {
      return {
        code: 'INVALID_PARAM',
        message: `Unknown parameter: ${key}`,
      };
    }
  }
  // Validate each declared param
  for (const [key, kind] of Object.entries(spec)) {
    const value = params[key];
    if (value === undefined) continue;
    const err = validateParamValue(key, value, kind);
    if (err) return err;
  }
  return null;
}

/**
 * Validates a single parameter value against its declared kind.
 *
 * Delegates to kind-specific validators to keep complexity low.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines 16-31
 */
function validateParamValue(
  key: string,
  value: unknown,
  kind: ParamKind,
): ValidationError | null {
  // Universal rule: reject any string value beginning with '-'
  if (typeof value === 'string' && value.startsWith('-')) {
    return {
      code: 'INVALID_PARAM',
      message: `Parameter ${key} must not begin with '-'`,
    };
  }
  return validateByKind(key, value, kind);
}

/**
 * Validates a value against its kind, dispatching to the right validator.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines 16-31
 */
function validateByKind(
  key: string,
  value: unknown,
  kind: ParamKind,
): ValidationError | null {
  switch (kind) {
    case 'repo':
      return validateRepoParam(key, value);
    case 'number':
      return validateNumberParam(key, value);
    case 'boolean':
      return validateBooleanParam(key, value);
    case 'state':
      return validateStateParam(key, value);
    case 'label':
      return validateLabelParam(key, value);
    case 'threadId':
      return validateThreadIdParam(key, value);
    case 'body':
    case 'freetext':
      return validateStringParam(key, value);
    default:
      return null;
  }
}

/**
 * Validates a repo parameter: must be "owner/name" matching the regex.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002, REQ-009
 * @pseudocode 003-github-broker.md line 17
 */
function validateRepoParam(
  key: string,
  value: unknown,
): ValidationError | null {
  if (typeof value !== 'string' || !REPO_REGEX.test(value)) {
    return {
      code: 'INVALID_PARAM',
      message: `Parameter ${key} must be "owner/name"`,
    };
  }
  return null;
}

/**
 * Validates a number parameter: must be a positive integer.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md line 18
 */
function validateNumberParam(
  key: string,
  value: unknown,
): ValidationError | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return {
      code: 'INVALID_PARAM',
      message: `Parameter ${key} must be a positive integer`,
    };
  }
  return null;
}

/**
 * Validates a boolean parameter.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002
 */
function validateBooleanParam(
  key: string,
  value: unknown,
): ValidationError | null {
  if (typeof value !== 'boolean') {
    return {
      code: 'INVALID_PARAM',
      message: `Parameter ${key} must be a boolean`,
    };
  }
  return null;
}

/**
 * Validates a state parameter: must be one of open|closed|merged|all.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md line 19
 */
function validateStateParam(
  key: string,
  value: unknown,
): ValidationError | null {
  if (typeof value !== 'string') {
    return {
      code: 'INVALID_PARAM',
      message: `Parameter ${key} must be a string`,
    };
  }
  const allowed = ['open', 'closed', 'merged', 'all'];
  if (!allowed.includes(value)) {
    return {
      code: 'INVALID_PARAM',
      message: `Parameter ${key} must be one of: ${allowed.join(', ')}`,
    };
  }
  return null;
}

/**
 * Validates a label parameter: string or array of strings.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md line 20
 */
function validateLabelParam(
  key: string,
  value: unknown,
): ValidationError | null {
  if (Array.isArray(value)) {
    return validateLabelArray(key, value);
  }
  if (typeof value !== 'string') {
    return {
      code: 'INVALID_PARAM',
      message: `Parameter ${key} must be a string or array of strings`,
    };
  }
  return null;
}

/**
 * Validates that every element of a label array is a string.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002
 */
function validateLabelArray(
  key: string,
  value: unknown[],
): ValidationError | null {
  for (const el of value) {
    if (typeof el !== 'string') {
      return {
        code: 'INVALID_PARAM',
        message: `Parameter ${key} must be an array of strings`,
      };
    }
  }
  return null;
}

/**
 * Validates a threadId parameter: must match /^[A-Za-z0-9_=-]+$/.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md line 21
 */
function validateThreadIdParam(
  key: string,
  value: unknown,
): ValidationError | null {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_=-]+$/.test(value)) {
    return {
      code: 'INVALID_PARAM',
      message: `Parameter ${key} contains invalid characters`,
    };
  }
  return null;
}

/**
 * Validates a generic string parameter (body, freetext).
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines 22-24
 */
function validateStringParam(
  key: string,
  value: unknown,
): ValidationError | null {
  if (typeof value !== 'string') {
    return {
      code: 'INVALID_PARAM',
      message: `Parameter ${key} must be a string`,
    };
  }
  return null;
}

// ─── Shaping helpers (defensive parsing of external data) ───────────────────

/**
 * Extracts a number from an unknown value, defaulting to 0.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-013
 */
function extractNumber(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

/**
 * Extracts a string from an unknown value, returning a default.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-013
 */
function extractString(value: unknown, def: string): string {
  return typeof value === 'string' ? value : def;
}

/**
 * Extracts the author login from a gh author object (defensive).
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-013
 */
function extractAuthor(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.login === 'string') return obj.login;
  }
  return '';
}

/**
 * Extracts label names from a gh labels array (defensive).
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-013
 */
function extractLabels(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((label): string => {
      if (typeof label === 'string') return label;
      if (typeof label === 'object' && label !== null) {
        const obj = label as Record<string, unknown>;
        if (typeof obj.name === 'string') return obj.name;
      }
      return '';
    })
    .filter((name) => name.length > 0);
}

/**
 * Extracts shaped comments from a gh comments array (defensive). Returns
 * null when there is no comments array, so the caller can distinguish
 * "not requested" from "zero comments".
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 101-103
 */
function extractComments(value: unknown): readonly ShapedComment[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((comment): ShapedComment => {
    const obj = (comment ?? {}) as Record<string, unknown>;
    return {
      author: extractAuthor(obj.author),
      createdAt: extractString(obj.createdAt, ''),
      body: extractString(obj.body, ''),
    };
  });
}
