/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The single source of truth for the `github` tool's operation catalog.
 *
 * Both the tool layer (`github.ts`) and the broker layer
 * (`packages/providers/.../github-broker-*.ts`) consume this catalog, so the
 * parameter table a model sees in its function declaration cannot drift from
 * the parameter table the broker validates against. Adding an operation or a
 * parameter is a one-place edit.
 *
 * The catalog deliberately lives in `packages/tools` and flows one way:
 * `packages/providers` depends on `packages/tools`, never the reverse.
 *
 * @plan PLAN-20260731-GHBROKER.P15
 * @requirement REQ-008, REQ-012, REQ-013
 */

/**
 * The kind of a single parameter. Mirrors the broker's value-validation
 * switch: each kind has a distinct validation rule (a `number` must be a
 * positive integer, a `label` may be a string or array of strings, etc.).
 *
 * The broker re-exports this as `ParamKind` so its existing type uses keep
 * compiling.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002
 */
export type GithubParamKind =
  | 'repo'
  | 'number'
  | 'boolean'
  | 'state'
  | 'stateIssue'
  | 'label'
  | 'threadId'
  | 'body'
  | 'freetext'
  | 'limit'
  | 'closeReason'
  | 'color'
  | 'assignee'
  | 'milestone'
  | 'project'
  | 'branch';

/**
 * Specification for one operation: a one-line summary, whether it writes,
 * the parameters it accepts (name -> kind), and the subset that is required.
 *
 * @plan PLAN-20260731-GHBROKER.P15
 * @requirement REQ-008
 */
export interface GithubOpSpec {
  /** Short human description, used in the tool description and renders. */
  readonly summary: string;
  /** True for operations that change state (drive confirmation). */
  readonly mutating: boolean;
  /** Accepted parameters mapped to their validation kind. */
  readonly params: Readonly<Record<string, GithubParamKind>>;
  /** Parameters that must be present for the op to run. */
  readonly required: readonly string[];
}

/**
 * Every operation and its specification. Insertion order is the canonical
 * operation order (the order `SUPPORTED_OPS` has always published), so
 * `Object.keys` here is stable and matches the tool's enum.
 *
 * The accepted and required sets are transcribed verbatim from the broker
 * descriptors; this issue only exposes and explains them, never changes them.
 *
 * @plan PLAN-20260731-GHBROKER.P15
 * @requirement REQ-008
 */
export const GITHUB_OP_SPECS: Readonly<Record<string, GithubOpSpec>> = {
  'issue.view': {
    summary: 'view an issue',
    mutating: false,
    params: { number: 'number', comments: 'boolean', repo: 'repo' },
    required: ['number'],
  },
  'issue.list': {
    summary: 'list issues',
    mutating: false,
    params: {
      search: 'freetext',
      state: 'stateIssue',
      label: 'label',
      limit: 'limit',
      repo: 'repo',
    },
    required: [],
  },
  'issue.create': {
    summary: 'create an issue',
    mutating: true,
    params: {
      title: 'freetext',
      body: 'body',
      label: 'label',
      assignee: 'assignee',
      milestone: 'milestone',
      project: 'project',
      repo: 'repo',
    },
    required: ['title'],
  },
  'issue.comment': {
    summary: 'comment on an issue',
    mutating: true,
    params: { number: 'number', body: 'body', repo: 'repo' },
    required: ['number', 'body'],
  },
  'issue.edit': {
    summary: 'edit an issue',
    mutating: true,
    params: {
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
    },
    required: ['number'],
  },
  'issue.close': {
    summary: 'close an issue',
    mutating: true,
    params: { number: 'number', reason: 'closeReason', repo: 'repo' },
    required: ['number'],
  },
  'pr.view': {
    summary: 'view a pull request',
    mutating: false,
    params: { number: 'number', comments: 'boolean', repo: 'repo' },
    required: ['number'],
  },
  'pr.list': {
    summary: 'list pull requests',
    mutating: false,
    params: { state: 'state', limit: 'limit', repo: 'repo' },
    required: [],
  },
  'pr.diff': {
    summary: 'view a pull request diff',
    mutating: false,
    params: { number: 'number', repo: 'repo' },
    required: ['number'],
  },
  'pr.checks': {
    summary: 'view pull request checks',
    mutating: false,
    params: { number: 'number', repo: 'repo', watch: 'boolean' },
    required: ['number'],
  },
  'pr.reviews': {
    summary: 'view pull request review threads',
    mutating: false,
    params: { number: 'number', actionable: 'boolean', repo: 'repo' },
    required: ['number'],
  },
  'pr.create': {
    summary: 'create a pull request',
    mutating: true,
    params: {
      title: 'freetext',
      body: 'body',
      base: 'branch',
      head: 'branch',
      draft: 'boolean',
      repo: 'repo',
    },
    required: ['title'],
  },
  'pr.comment': {
    summary: 'comment on a pull request',
    mutating: true,
    params: { number: 'number', body: 'body', repo: 'repo' },
    required: ['number', 'body'],
  },
  'pr.edit': {
    summary: 'edit a pull request',
    mutating: true,
    params: {
      number: 'number',
      title: 'freetext',
      body: 'body',
      addLabel: 'label',
      removeLabel: 'label',
      addAssignee: 'assignee',
      milestone: 'milestone',
      repo: 'repo',
    },
    required: ['number'],
  },
  'pr.ready': {
    summary: 'mark a pull request ready for review',
    mutating: true,
    params: { number: 'number', repo: 'repo' },
    required: ['number'],
  },
  'pr.resolve-thread': {
    summary: 'resolve a review thread',
    mutating: true,
    params: { threadId: 'threadId', repo: 'repo' },
    required: ['threadId'],
  },
  'search.issues': {
    summary: 'search issues across repositories',
    mutating: false,
    params: { query: 'freetext', limit: 'limit', repo: 'repo' },
    required: ['query'],
  },
  'search.prs': {
    summary: 'search pull requests across repositories',
    mutating: false,
    params: { query: 'freetext', limit: 'limit', repo: 'repo' },
    required: ['query'],
  },
  'run.list': {
    summary: 'list workflow runs',
    mutating: false,
    params: { limit: 'limit', branch: 'freetext', repo: 'repo' },
    required: [],
  },
  'label.list': {
    summary: 'list labels',
    mutating: false,
    params: { limit: 'limit', repo: 'repo' },
    required: [],
  },
  'label.create': {
    summary: 'create a label',
    mutating: true,
    params: {
      name: 'freetext',
      color: 'color',
      description: 'freetext',
      force: 'boolean',
      repo: 'repo',
    },
    required: ['name'],
  },
};

/**
 * The operation names in canonical order. `Object.keys` preserves insertion
 * order, so this is exactly the order declared above and the order the tool
 * has always published.
 *
 * @plan PLAN-20260731-GHBROKER.P15
 * @requirement REQ-008
 */
export const GITHUB_SUPPORTED_OPS: readonly string[] =
  Object.keys(GITHUB_OP_SPECS);

/**
 * The set of operations that change state and therefore require
 * confirmation in the tool layer.
 *
 * @plan PLAN-20260731-GHBROKER.P15
 * @requirement REQ-012
 */
export const GITHUB_MUTATING_OPS: ReadonlySet<string> = new Set(
  GITHUB_SUPPORTED_OPS.filter((op) => GITHUB_OP_SPECS[op].mutating),
);

/**
 * A short, human-readable hint for each parameter kind, used in the
 * accepted-parameter line so a model (or user) reading an error learns what
 * shape the value should take.
 *
 * @plan PLAN-20260731-GHBROKER.P15
 * @requirement REQ-008
 */
export const GITHUB_PARAM_KIND_HINTS: Readonly<
  Record<GithubParamKind, string>
> = {
  repo: 'owner/name',
  number: 'positive integer',
  boolean: 'boolean',
  state: 'open, closed, merged, or all',
  stateIssue: 'open, closed, or all',
  // The tool schema publishes these as array<string> because a type union is
  // not projectable to any provider; the validator stays permissive.
  label: 'array of strings',
  threadId: 'review thread id',
  body: 'markdown text',
  freetext: 'string',
  limit: 'positive integer 1–100',
  closeReason: 'completed or not planned',
  color: 'hex color like #RRGGBB',
  assignee: 'array of strings',
  milestone: 'string',
  project: 'string',
  branch: 'string',
};

/**
 * Builds the accepted-parameter line for an operation, e.g.
 * "issue.comment accepts: number (positive integer, required), body (markdown
 * text, required), repo (owner/name)." Returns a stable message for an
 * unknown op.
 *
 * @plan PLAN-20260731-GHBROKER.P15
 * @requirement REQ-008
 */
export function describeGithubOpParams(op: string): string {
  if (!Object.prototype.hasOwnProperty.call(GITHUB_OP_SPECS, op)) {
    return `${op} is not a supported operation.`;
  }
  const spec: GithubOpSpec = GITHUB_OP_SPECS[op];
  const parts = Object.entries(spec.params).map(([name, kind]) => {
    const hint = GITHUB_PARAM_KIND_HINTS[kind];
    return spec.required.includes(name)
      ? `${name} (${hint}, required)`
      : `${name} (${hint})`;
  });
  return `${op} accepts: ${parts.join(', ')}.`;
}

/**
 * One reference line for an operation, used in the tool description:
 * "issue.comment — comment on an issue. required: number, body. optional:
 * repo." Returns a stable message for an unknown op.
 *
 * @plan PLAN-20260731-GHBROKER.P15
 * @requirement REQ-008
 */
export function describeGithubOp(op: string): string {
  if (!Object.prototype.hasOwnProperty.call(GITHUB_OP_SPECS, op)) {
    return `${op} — unknown operation.`;
  }
  const spec: GithubOpSpec = GITHUB_OP_SPECS[op];
  const optional = Object.keys(spec.params).filter(
    (name) => !spec.required.includes(name),
  );
  const fragments = [`${op} — ${spec.summary}.`];
  if (spec.required.length > 0) {
    fragments.push(`required: ${spec.required.join(', ')}.`);
  }
  if (optional.length > 0) {
    fragments.push(`optional: ${optional.join(', ')}.`);
  }
  return fragments.join(' ');
}

/**
 * Validates parameters against an operation's spec. Returns an actionable,
 * op-naming message when invalid, or `null` when valid. Runs both structural
 * validation (unknown parameters, missing required parameters) and the
 * shared per-kind value validation, so an invalid value such as
 * `issue.list { state: 'merged' }` is rejected at the tool boundary instead
 * of after a broker round trip.
 *
 * @plan PLAN-20260731-GHBROKER.P15
 * @requirement REQ-008, REQ-002
 */
export function validateGithubOpParams(
  op: string,
  params: Readonly<Record<string, unknown>>,
): string | null {
  if (!Object.prototype.hasOwnProperty.call(GITHUB_OP_SPECS, op)) {
    return `Unknown operation "${op}". Supported operations: ${GITHUB_SUPPORTED_OPS.join(', ')}.`;
  }
  const spec: GithubOpSpec = GITHUB_OP_SPECS[op];
  for (const key of Object.keys(params)) {
    // `in` walks the prototype chain, so `constructor`, `toString` and an own
    // `__proto__` key would read as known parameters here and then never be
    // validated — silently ignored, which is what the fail-fast invariant
    // forbids. `hasOwnProperty` confines the check to the op's own params.
    if (!Object.prototype.hasOwnProperty.call(spec.params, key)) {
      return unknownParamToolMessage(op, key);
    }
  }
  for (const key of spec.required) {
    if (params[key] === undefined) {
      return `${op}: missing required parameter "${key}". ${describeGithubOpParams(
        op,
      )}`;
    }
  }
  for (const key of Object.keys(params)) {
    const value = params[key];
    if (value === undefined) continue;
    const msg = validateGithubParamValue(key, value, spec.params[key]);
    if (msg !== null) return `${op}: ${msg}`;
  }
  return null;
}

/**
 * Catalog-backed redirect for a rejected unknown parameter. Names every OTHER
 * operation that accepts the parameter, so a caller rejected for passing a
 * param the op does not take learns which op does. Refines well-known cases
 * with an explicit hint.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002
 */
export function githubParamRedirect(
  op: string,
  param: string,
): Readonly<{ elsewhere: readonly string[]; hint?: string }> | null {
  // Iterating the catalog's own entries rather than filtering the op-name
  // list and indexing back into the catalog means there is no lookup that
  // could miss: the name and the spec are read from the same entry. Order is
  // unchanged, since GITHUB_SUPPORTED_OPS is Object.keys of this same object.
  const elsewhere = Object.entries(GITHUB_OP_SPECS)
    .filter(
      ([other, spec]) =>
        other !== op &&
        Object.prototype.hasOwnProperty.call(spec.params, param),
    )
    .map(([other]) => other);
  if (elsewhere.length === 0) return null;
  if (op === 'issue.create' && param === 'type') {
    return {
      elsewhere,
      hint: 'Issue type is set AFTER creation via issue.edit ({ op: "issue.edit", number, type }), never on issue.create — gh issue create has no --type flag. Create the issue first, then set the type.',
    };
  }
  return { elsewhere };
}

/**
 * The redirect sentence for an unknown parameter shared by the tool boundary
 * and the broker, so both name the same operations.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002
 */
export function githubParamRedirectText(op: string, param: string): string {
  const redirect = githubParamRedirect(op, param);
  if (redirect === null) return '';
  const extra = redirect.hint !== undefined ? ` ${redirect.hint}` : '';
  return `That parameter is accepted by ${redirect.elsewhere.join(', ')}.${extra}`;
}

/**
 * Builds the tool-boundary unknown-parameter rejection, naming the accepted
 * params and the catalog-backed redirect.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002
 */
function unknownParamToolMessage(op: string, key: string): string {
  return `${op}: unknown parameter "${key}". ${describeGithubOpParams(op)} ${githubParamRedirectText(op, key)}`.trim();
}

/**
 * Hard maximum for list/search `limit` params. The catalog owns this value
 * so the tool boundary and the broker share one cap; the broker re-exports
 * it as `MAX_LIMIT`.
 *
 * @plan PLAN-20260731-GHBROKER.P10, PLAN-20260731-GHBROKER.P15
 * @requirement REQ-002, REQ-013
 */
export const GITHUB_LIMIT_MAX = 100;

/**
 * Regex for the repo parameter: `owner/name` where owner and name each
 * match `[A-Za-z0-9._-]+`.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002, REQ-009
 */
const REPO_REGEX = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/**
 * True when `value` has the shape of a GitHub repository name (`owner/name`).
 *
 * Shared between the repo value validator and the broker's search-query
 * tokenizer (which lifts a `repo:` term into the `--repo` flag), so the
 * two layers match on one predicate rather than each owning a copy of the regex.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002
 */
export function isGithubRepoName(value: unknown): value is string {
  return typeof value === 'string' && REPO_REGEX.test(value);
}

/** Allowed close-reason values for `gh issue close`. */
const CLOSE_REASONS = ['completed', 'not planned'] as const;

/** Allowed state values for pr.list (the full set including "merged"). */
const STATE_VALUES = ['open', 'closed', 'merged', 'all'] as const;

/** Allowed state values for issue.list (no "merged"). */
const STATE_ISSUE_VALUES = ['open', 'closed', 'all'] as const;

/**
 * Validates that `value` is a string or an array of strings, with a
 * per-element leading-dash check. Shared by the `label` and `assignee`
 * kinds.
 *
 * The per-element dash check matters because array elements are pushed
 * straight into the gh argv by repeatable-flag helpers; checking only the
 * container would let `{ label: ['--some-flag'] }` through.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002
 */
function validateStringOrArrayValue(
  key: string,
  value: unknown,
): string | null {
  if (Array.isArray(value)) {
    for (const el of value) {
      if (typeof el !== 'string') {
        return `Parameter ${key} must be an array of strings`;
      }
      if (el.startsWith('-')) {
        return `Parameter ${key} may not contain a value beginning with '-'`;
      }
    }
    return null;
  }
  if (typeof value !== 'string') {
    return `Parameter ${key} must be a string or array of strings`;
  }
  return null;
}

/**
 * Validates that `value` is a string within the allowed list, producing the
 * same two-stage messages the broker always produced (non-string vs.
 * out-of-set).
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002
 */
function validateEnumValue(
  key: string,
  value: unknown,
  allowed: readonly string[],
): string | null {
  if (typeof value !== 'string') {
    return `Parameter ${key} must be a string`;
  }
  if (!allowed.includes(value)) {
    return `Parameter ${key} must be one of: ${allowed.join(', ')}`;
  }
  return null;
}

/**
 * Validates a single parameter value against its declared kind. Returns a
 * rejection message, or `null` when valid. This is the single source of
 * truth for per-kind value rules: the tool boundary and the broker both
 * call it, so they cannot drift.
 *
 * The leading-`-` flag-injection check is applied to every top-level string
 * value before the per-kind dispatch, exactly as the broker did.
 *
 * The per-kind dispatch is a `Record<GithubParamKind, ...>` table rather
 * than a switch, so adding a `GithubParamKind` variant without a validator
 * entry is a COMPILE error (the Record type is exhaustive over the union),
 * never a silent pass.
 *
 * @plan PLAN-20260731-GHBROKER.P15
 * @requirement REQ-002
 */
export function validateGithubParamValue(
  key: string,
  value: unknown,
  kind: GithubParamKind,
): string | null {
  if (typeof value === 'string' && value.startsWith('-')) {
    return `Parameter ${key} must not begin with '-'`;
  }
  return KIND_VALIDATORS[kind](key, value);
}

/** Validates a repo-kind value: must be "owner/name". */
function validateRepoValue(key: string, value: unknown): string | null {
  if (!isGithubRepoName(value)) {
    return `Parameter ${key} must be "owner/name"`;
  }
  return null;
}

/** Validates a number-kind value: must be a positive integer. */
function validatePositiveIntValue(key: string, value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return `Parameter ${key} must be a positive integer`;
  }
  return null;
}

/** Validates a boolean-kind value. */
function validateBooleanValue(key: string, value: unknown): string | null {
  if (typeof value !== 'boolean') {
    return `Parameter ${key} must be a boolean`;
  }
  return null;
}

/** Validates a threadId-kind value: must match /^[A-Za-z0-9_=-]+$/. */
function validateThreadIdValue(key: string, value: unknown): string | null {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_=-]+$/.test(value)) {
    return `Parameter ${key} contains invalid characters`;
  }
  return null;
}

/** Validates a limit-kind value: positive integer not exceeding the cap. */
function validateLimitValue(key: string, value: unknown): string | null {
  const intErr = validatePositiveIntValue(key, value);
  if (intErr !== null) return intErr;
  if ((value as number) > GITHUB_LIMIT_MAX) {
    return `Parameter ${key} must not exceed ${GITHUB_LIMIT_MAX}`;
  }
  return null;
}

/** Validates a color-kind value: hex color like #RRGGBB. */
function validateColorValue(key: string, value: unknown): string | null {
  if (typeof value !== 'string') {
    return `Parameter ${key} must be a string`;
  }
  if (!/^#?(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(value)) {
    return `Parameter ${key} must be a hex color like #RRGGBB`;
  }
  return null;
}

/** Validates a generic string-kind value (milestone, project, branch, body, freetext). */
function validateStringValue(key: string, value: unknown): string | null {
  if (typeof value !== 'string') {
    return `Parameter ${key} must be a string`;
  }
  return null;
}

/**
 * Dispatch table mapping every `GithubParamKind` to its validator. The
 * `Record<GithubParamKind, ...>` type makes exhaustiveness a compile-time
 * guarantee: a new kind added to the union without an entry here is an
 * error.
 *
 * @plan PLAN-20260731-GHBROKER.P15
 * @requirement REQ-002
 */
const KIND_VALIDATORS: Readonly<
  Record<GithubParamKind, (key: string, value: unknown) => string | null>
> = {
  repo: validateRepoValue,
  number: validatePositiveIntValue,
  boolean: validateBooleanValue,
  state: (key, value) => validateEnumValue(key, value, STATE_VALUES),
  stateIssue: (key, value) => validateEnumValue(key, value, STATE_ISSUE_VALUES),
  label: validateStringOrArrayValue,
  threadId: validateThreadIdValue,
  limit: validateLimitValue,
  closeReason: (key, value) => validateEnumValue(key, value, CLOSE_REASONS),
  color: validateColorValue,
  assignee: validateStringOrArrayValue,
  milestone: validateStringValue,
  project: validateStringValue,
  branch: validateStringValue,
  body: validateStringValue,
  freetext: validateStringValue,
};
