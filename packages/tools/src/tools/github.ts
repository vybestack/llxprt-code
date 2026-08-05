/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The `github` tool: typed GitHub operations brokered on the host.
 *
 * The agent never receives a GitHub credential. It names an operation and
 * supplies arguments; the host runs `gh` and returns shaped data. Inside a
 * sandbox this is the only path to GitHub, because no credential exists in
 * the container.
 *
 * Operation names mirror `gh` subcommands and parameters mirror `gh` long
 * flags with the dashes dropped, so existing `gh` knowledge transfers
 * directly. There is no --json or --jq: responses are already shaped.
 *
 * @plan PLAN-20260731-GHBROKER.P15
 * @requirement REQ-008, REQ-012, REQ-013
 * @pseudocode 003-github-broker.md lines 38-55
 */

import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolConfirmationOutcome,
  type ToolCallConfirmationDetails,
  type ToolInvocation,
  type ToolResult,
  type LiveOutputUpdate,
} from './tools.js';
import type { IToolMessageBus } from '../interfaces/IToolMessageBus.js';
import {
  GITHUB_OP_SPECS,
  GITHUB_SUPPORTED_OPS,
  GITHUB_MUTATING_OPS,
  describeGithubOp,
  validateGithubOpParams,
} from './github-ops.js';
import { renderGithubResult } from './github-display.js';

/**
 * Transport for GitHub operations. Implemented outside this package and
 * injected, so `packages/tools` never depends on the auth or proxy stack.
 *
 * @plan PLAN-20260731-GHBROKER.P15
 * @requirement REQ-003, REQ-004
 */
export interface GitHubBrokerClient {
  /**
   * Runs one operation. Resolves with shaped data; rejects with a message
   * safe to surface (the broker redacts token-shaped substrings).
   */
  runOperation(
    op: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>>;
}

/**
 * Operations that change state and therefore require confirmation. Derived
 * from the catalog so it cannot drift from the broker's notion of a write.
 */
export const MUTATING_OPS: ReadonlySet<string> = GITHUB_MUTATING_OPS;

/** Every operation the tool accepts, in canonical order. */
export const SUPPORTED_OPS: readonly string[] = GITHUB_SUPPORTED_OPS;

/** Re-export so existing importers and tests keep working after the move. */
export { renderChecks } from './github-display.js';

/** How often to report elapsed time while a watch blocks. */
const PROGRESS_INTERVAL_MS = 15_000;

/**
 * Worked examples matter more than prose here: models do not one-shot
 * unfamiliar tool schemas, and the closer this reads to `gh`, the more of
 * their existing knowledge transfers.
 *
 * The per-operation reference block (one line per op naming its required and
 * optional parameters) is generated from the catalog, so a model reading the
 * declaration can tell what a given op needs without a failed round trip.
 */
const DESCRIPTION = `Interact with GitHub issues, pull requests, checks and labels.

Operation names mirror \`gh\` subcommands and parameters mirror \`gh\` long flags
with the dashes removed (--repo becomes repo, --limit becomes limit). Responses
are already shaped, so there is no --json or --jq and no need to parse output.

Every operation accepts an optional "repo" as "owner/name"; omit it to use the
current repository. Cross-repository access is supported.

Examples:
  { "op": "issue.view", "number": 1663, "comments": true }
  { "op": "issue.view", "number": 42, "repo": "acoliver/otherproject" }
  { "op": "issue.list", "search": "sandbox", "state": "open", "limit": 20 }
  { "op": "issue.edit", "number": 1663, "addLabel": ["security"], "type": "Feature" }
  { "op": "pr.reviews", "number": 2317, "actionable": true }
  { "op": "pr.resolve-thread", "threadId": "PRRT_kwDO..." }
  { "op": "pr.checks", "number": 2317, "watch": true }

Notes:
- pr.reviews with actionable:true omits resolved and outdated threads, leaving
  only review comments that still need action. The returned thread id is what
  pr.resolve-thread takes, so the two compose.
- pr.checks with watch:true BLOCKS until CI finishes and then returns the
  result. Do not poll it yourself.
- issue.edit sets issue type, labels, assignees, projects and milestone in one
  call, including fields the gh CLI cannot set directly.

Operations:
${buildOpReferenceBlock()}`;

/**
 * Builds the per-operation reference block for the description, one line per
 * op. Kept as a function so the block is visibly generated from the catalog
 * rather than a second hand-maintained list.
 */
function buildOpReferenceBlock(): string {
  return GITHUB_SUPPORTED_OPS.map((op) => describeGithubOp(op)).join('\n');
}

/**
 * Array-of-strings parameters (labels, assignees).
 *
 * The tool schema declares these as `{ type: 'array', items: { type: 'string' } }`
 * rather than a `type: ['string', 'array']` union. A union type is
 * unprojectable: every provider's `normalizeType` collapses a non-string,
 * non-enum `type` to `'string'`, so a union would silently tell the model
 * that arrays are invalid. The stricter array-only contract is the general
 * form the model should use. The broker validation deliberately still
 * accepts a bare string OR an array for these kinds, because the sandbox
 * socket path and existing callers rely on it — the tool schema is the
 * stricter, unambiguous published contract, not a mirror of the broker's
 * permissive input.
 */
const ARRAY_PARAMS: Readonly<Record<string, string>> = {
  label:
    'Label names, as an array (use a single-element array for one label). Accepted by issue.list, issue.create.',
  addLabel:
    'Label names to add, as an array (use a single-element array for one label). Accepted by issue.edit, pr.edit.',
  removeLabel:
    'Label names to remove, as an array (use a single-element array for one label). Accepted by issue.edit, pr.edit.',
  assignee:
    'Logins, as an array (use a single-element array for one assignee). Accepted by issue.create.',
  addAssignee:
    'Logins to add as assignee, as an array (use a single-element array for one). Accepted by issue.edit, pr.edit.',
  removeAssignee:
    'Logins to remove as assignee, as an array (use a single-element array for one). Accepted by issue.edit.',
};

/** Schema for boolean-kind parameters (no additional constraints). */
const BOOLEAN_PARAMS: Readonly<Record<string, string>> = {
  comments:
    'Include comment threads in the response. Accepted by issue.view and pr.view.',
  actionable:
    'Omit resolved and outdated review threads. Accepted by pr.reviews.',
  watch:
    'Block until CI finishes instead of returning immediately. Accepted by pr.checks.',
  draft: 'Create the pull request as a draft. Accepted by pr.create.',
  force:
    'Overwrite an existing label of the same name. Accepted by label.create.',
};

/**
 * Schema for bounded integer parameters (number, limit). Declared as
 * 'integer' rather than 'number' so every provider's `normalizeType` maps
 * the field correctly; a 'number' would let a model pass 1.5 through the
 * schema check only to be rejected by value validation.
 */
const BOUNDED_PARAMS: Readonly<
  Record<string, { minimum: number; maximum?: number; description: string }>
> = {
  number: {
    minimum: 1,
    description:
      'Issue or pull request number (positive integer). Required by issue.view, issue.comment, issue.edit, issue.close, pr.view, pr.diff, pr.checks, pr.reviews, pr.comment, pr.edit, pr.ready.',
  },
  limit: {
    minimum: 1,
    maximum: 100,
    description:
      'Maximum number of items to return (integer 1–100). Accepted by issue.list, pr.list, search.issues, search.prs, run.list, label.list.',
  },
};

/** Schema for enum-valued parameters. */
const ENUM_PARAMS: Readonly<
  Record<string, { enum: readonly string[]; description: string }>
> = {
  // The schema enum is deliberately the UNION of values across operations:
  // pr.list accepts 'merged', issue.list does not. A single JSON schema is
  // shared by every operation (it cannot vary an enum by `op`), so the
  // superset is published here for discoverability and validateGithubOpParams
  // narrows it per operation (via the per-kind `state` vs `stateIssue`
  // validators) before the call is made. issue.list uses the `stateIssue`
  // kind, which rejects 'merged' at the tool boundary.
  state: {
    enum: ['open', 'closed', 'merged', 'all'],
    description:
      'Filter by state. Accepted by issue.list (open, closed, all) and pr.list (open, closed, merged, all); "merged" is rejected for issue.list.',
  },
  reason: {
    enum: ['completed', 'not planned'],
    description: 'Close reason. Accepted by issue.close.',
  },
};

/**
 * Builds the JSON-schema property descriptor for a parameter name. Numeric
 * bounds, enums and array kinds are table-driven; the body and default cases
 * are inline because their descriptions are unique.
 */
function paramSchemaFor(name: string): Record<string, unknown> {
  if (name in BOOLEAN_PARAMS) {
    return { type: 'boolean', description: BOOLEAN_PARAMS[name] };
  }
  if (name in BOUNDED_PARAMS) {
    return { type: 'integer', ...BOUNDED_PARAMS[name] };
  }
  if (name in ENUM_PARAMS) {
    return { type: 'string', ...ENUM_PARAMS[name] };
  }
  if (name in ARRAY_PARAMS) {
    return {
      type: 'array',
      items: { type: 'string' },
      description: ARRAY_PARAMS[name],
    };
  }
  if (name === 'body') {
    return {
      type: 'string',
      description:
        'Comment or issue/PR body (markdown). Required by issue.comment and pr.comment; optional for issue.create, issue.edit, pr.create, pr.edit.',
    };
  }
  return { type: 'string', description: textHintFor(name) };
}

/** Short text hint for the remaining string-kind parameters. */
function textHintFor(name: string): string {
  const hints: Readonly<Record<string, string>> = {
    repo: 'Repository as "owner/name". Omit to use the current repository.',
    title:
      'Issue or pull request title. Required by issue.create and pr.create; optional for issue.edit, pr.edit.',
    search: 'Free-text search query. Accepted by issue.list.',
    milestone:
      'Milestone name or number. Accepted by issue.create, issue.edit.',
    project: 'Project name. Accepted by issue.create.',
    addProject: 'Project to add the item to. Accepted by issue.edit.',
    removeProject: 'Project to remove the item from. Accepted by issue.edit.',
    type: 'Issue type (e.g. Bug, Feature). Accepted by issue.edit.',
    base: 'Base branch for the pull request. Accepted by pr.create.',
    head: 'Head branch for the pull request. Accepted by pr.create.',
    threadId:
      'Review thread id (returned by pr.reviews). Required by pr.resolve-thread.',
    query: 'GitHub search query. Required by search.issues and search.prs.',
    branch: 'Branch name to filter runs by. Accepted by run.list.',
    name: 'Label name. Required by label.create.',
    color:
      'Label color as a hex string like #RRGGBB. Accepted by label.create.',
    description: 'Label description. Accepted by label.create.',
  };
  return hints[name] ?? '';
}

/**
 * The union of every parameter name any operation accepts. Generated from
 * the catalog so adding a parameter to an op makes it visible here without a
 * second edit.
 */
const ALL_PARAM_NAMES: readonly string[] = collectParamNames();

/** Collects the unique parameter names across all op specs, catalog order. */
function collectParamNames(): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const op of GITHUB_SUPPORTED_OPS) {
    for (const name of Object.keys(GITHUB_OP_SPECS[op].params)) {
      if (!seen.has(name)) {
        seen.add(name);
        ordered.push(name);
      }
    }
  }
  return ordered;
}

const PARAMETER_SCHEMA = {
  type: 'object',
  properties: {
    op: {
      type: 'string',
      enum: SUPPORTED_OPS,
      description: 'The operation to perform, e.g. "issue.view".',
    },
    ...buildParameterProperties(),
  },
  required: ['op'],
  additionalProperties: false,
} as const;

/** Builds the per-parameter schema properties from the catalog union. */
function buildParameterProperties(): Record<string, Record<string, unknown>> {
  const props: Record<string, Record<string, unknown>> = {};
  for (const name of ALL_PARAM_NAMES) {
    props[name] = paramSchemaFor(name);
  }
  return props;
}

/** Parameters accepted by the tool. */
export interface GithubToolParams {
  op: string;
  repo?: string;
  number?: number;
  [key: string]: unknown;
}

/**
 * A single `github` tool invocation.
 *
 * @plan PLAN-20260731-GHBROKER.P15
 * @requirement REQ-008, REQ-012
 */
export class GithubToolInvocation extends BaseToolInvocation<
  GithubToolParams,
  ToolResult
> {
  constructor(
    private readonly client: GitHubBrokerClient,
    params: GithubToolParams,
    messageBus?: IToolMessageBus,
  ) {
    super(params, messageBus, GithubTool.Name, 'GitHub');
  }

  getDescription(): string {
    const target =
      typeof this.params.number === 'number' ? ` #${this.params.number}` : '';
    const where =
      typeof this.params.repo === 'string' ? ` in ${this.params.repo}` : '';
    return `${this.params.op}${target}${where}`;
  }

  /**
   * Mutating operations route through the standard confirmation path, so
   * normal allowlisting and "always allow" apply. Reads never prompt.
   *
   * Per the threat model, misuse of a capability we deliberately grant is
   * out of scope, so writes get no gating beyond this.
   *
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-012
   */
  override async shouldConfirmExecute(
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    if (!MUTATING_OPS.has(this.params.op)) return false;
    return {
      type: 'info',
      title: `Confirm GitHub write: ${this.params.op}`,
      prompt: this.getDescription(),
      onConfirm: async (outcome: ToolConfirmationOutcome) => {
        await this.publishPolicyUpdate(outcome);
      },
    };
  }

  /**
   * True when this call will block on CI rather than returning promptly.
   *
   * @plan PLAN-20260731-GHBROKER.P14
   * @requirement REQ-011
   */
  private isWatching(): boolean {
    return this.params.op === 'pr.checks' && this.params.watch === true;
  }

  /**
   * Reports elapsed time while a watch blocks.
   *
   * The host owns the polling loop, so per-check transitions are not visible
   * here without protocol progress frames, which are deliberately deferred.
   * Elapsed time is still worth showing: a multi-minute silent block is
   * otherwise indistinguishable from a hang.
   *
   * @plan PLAN-20260731-GHBROKER.P14
   * @requirement REQ-011
   */
  private startProgress(
    updateOutput: (update: LiveOutputUpdate) => void,
  ): () => void {
    const started = Date.now();
    const emit = (): void => {
      const seconds = Math.round((Date.now() - started) / 1000);
      const mins = Math.floor(seconds / 60);
      const elapsed = mins > 0 ? `${mins}m${seconds % 60}s` : `${seconds}s`;
      updateOutput({
        mode: 'append',
        data: `Waiting for checks on #${this.params.number} — ${elapsed}\n`,
      });
    };
    emit();
    const timer = setInterval(emit, PROGRESS_INTERVAL_MS);
    if (typeof timer.unref === 'function') timer.unref();
    return () => clearInterval(timer);
  }

  async execute(
    signal: AbortSignal,
    updateOutput?: (update: LiveOutputUpdate) => void,
  ): Promise<ToolResult> {
    const { op, ...rest } = this.params;
    const stopProgress =
      this.isWatching() && updateOutput !== undefined
        ? this.startProgress(updateOutput)
        : undefined;
    try {
      const data = await this.client.runOperation(op, rest, signal);
      const json = JSON.stringify(data, null, 2);
      return {
        llmContent: json,
        returnDisplay: this.render(data),
      };
    } catch (err) {
      // Every other tool in this package prefixes its error so the model can
      // tell where a bare message like "404 Not Found" came from.
      // `validateBuildAndExecute` only re-wraps exceptions that escape
      // `execute()`, so a returned result must carry its own prefix. Guard the
      // empty-message case so the display is never blanked entirely.
      const message = err instanceof Error ? err.message : String(err);
      const detail = message === '' ? 'Unknown error' : message;
      const prefixed = `GitHub operation failed: ${detail}`;
      return {
        llmContent: prefixed,
        returnDisplay: prefixed,
        error: { message: prefixed },
      };
    } finally {
      stopProgress?.();
    }
  }

  /**
   * Produces the human-readable transcript summary. Every op — including a
   * watched `pr.checks` — renders through the per-op display table, which
   * appends the `repo` suffix and (for pr.checks) reads `watch` from the
   * params to choose the right header. The full shaped JSON stays in
   * `llmContent`.
   */
  private render(data: Record<string, unknown>): string {
    return renderGithubResult(this.params.op, this.params, data);
  }
}

/**
 * The `github` tool.
 *
 * @plan PLAN-20260731-GHBROKER.P15
 * @requirement REQ-008
 */
export class GithubTool extends BaseDeclarativeTool<
  GithubToolParams,
  ToolResult
> {
  static readonly Name = 'github';

  constructor(
    private readonly client: GitHubBrokerClient,
    messageBus?: IToolMessageBus,
  ) {
    super(
      GithubTool.Name,
      'GitHub',
      DESCRIPTION,
      Kind.Other,
      PARAMETER_SCHEMA,
      true,
      false,
      messageBus,
    );
  }

  /**
   * Op-specific structural validation: an unknown parameter or a missing
   * required one is rejected before any broker call, with a message that
   * names the op and lists what it accepts. Runs after the JSON-schema
   * check in `BaseDeclarativeTool.validateToolParams`.
   *
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-008
   */
  protected override validateToolParamValues(
    params: GithubToolParams,
  ): string | null {
    const { op, ...rest } = params;
    return validateGithubOpParams(op, rest);
  }

  protected createInvocation(
    params: GithubToolParams,
    messageBus?: IToolMessageBus,
  ): ToolInvocation<GithubToolParams, ToolResult> {
    return new GithubToolInvocation(this.client, params, messageBus);
  }
}
