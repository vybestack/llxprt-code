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

/** Operations that change state and therefore require confirmation. */
export const MUTATING_OPS: ReadonlySet<string> = new Set([
  'issue.create',
  'issue.comment',
  'issue.edit',
  'issue.close',
  'pr.create',
  'pr.comment',
  'pr.edit',
  'pr.ready',
  'pr.resolve-thread',
  'label.create',
]);

/** Every operation the tool accepts. */
export const SUPPORTED_OPS: readonly string[] = [
  'issue.view',
  'issue.list',
  'issue.create',
  'issue.comment',
  'issue.edit',
  'issue.close',
  'pr.view',
  'pr.list',
  'pr.diff',
  'pr.checks',
  'pr.reviews',
  'pr.create',
  'pr.comment',
  'pr.edit',
  'pr.ready',
  'pr.resolve-thread',
  'search.issues',
  'search.prs',
  'run.list',
  'label.list',
  'label.create',
];

/** How often to report elapsed time while a watch blocks. */
const PROGRESS_INTERVAL_MS = 15_000;

/** Marks a check's bucket for display. */
function bucketMark(bucket: string): string {
  if (bucket === 'pass') return 'pass';
  if (bucket === 'fail') return 'FAIL';
  if (bucket === 'skipping') return 'skip';
  return bucket || '?';
}

/**
 * Renders a completed watch as a readable check list rather than raw JSON.
 *
 * Failures are listed first: after waiting minutes for CI, what you need is
 * the thing that broke, not an alphabetical roster.
 *
 * @plan PLAN-20260731-GHBROKER.P14
 * @requirement REQ-011
 */
export function renderChecks(data: Record<string, unknown>): string {
  const checks = Array.isArray(data.checks)
    ? (data.checks as Array<Record<string, unknown>>)
    : [];
  if (checks.length === 0) return 'No checks reported.';

  const summary = (data.summary ?? {}) as Record<string, number>;
  const rank = (c: Record<string, unknown>): number => {
    if (c.bucket === 'fail') return 0;
    if (c.bucket === 'pending') return 1;
    return 2;
  };
  const ordered = [...checks].sort((a, b) => rank(a) - rank(b));

  const lines = ordered.map((c) => {
    const name = typeof c.name === 'string' ? c.name : '';
    return `  ${bucketMark(String(c.bucket ?? ''))}  ${name}`;
  });

  const counts = ['pass', 'fail', 'pending', 'skipping']
    .filter((k) => (summary[k] ?? 0) > 0)
    .map((k) => `${summary[k]} ${k}`)
    .join(', ');
  let status = 'timed out';
  if (data.cancelled === true) status = 'cancelled';
  else if (data.concluded === true) status = 'complete';

  const header = `Checks ${status}${counts ? ` — ${counts}` : ''}`;
  return [header, ...lines].join('\n');
}

/** Parameters accepted by the tool. */
export interface GithubToolParams {
  op: string;
  repo?: string;
  number?: number;
  [key: string]: unknown;
}

/**
 * Worked examples matter more than prose here: models do not one-shot
 * unfamiliar tool schemas, and the closer this reads to `gh`, the more of
 * their existing knowledge transfers.
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

Operations: ${SUPPORTED_OPS.join(', ')}.`;

const PARAMETER_SCHEMA = {
  type: 'object',
  properties: {
    op: {
      type: 'string',
      enum: SUPPORTED_OPS,
      description: 'The operation to perform, e.g. "issue.view".',
    },
    repo: {
      type: 'string',
      description:
        'Target repository as "owner/name". Omit to use the current repository.',
    },
    number: {
      type: 'number',
      description:
        'Issue or pull request number, for operations that take one.',
    },
  },
  required: ['op'],
  additionalProperties: true,
} as const;

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
        returnDisplay: this.isWatching()
          ? renderChecks(data)
          : `${this.getDescription()}\n\n\`\`\`json\n${json}\n\`\`\``,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        llmContent: `GitHub operation failed: ${message}`,
        returnDisplay: `GitHub operation failed: ${message}`,
        error: { message },
      };
    } finally {
      stopProgress?.();
    }
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

  protected createInvocation(
    params: GithubToolParams,
    messageBus?: IToolMessageBus,
  ): ToolInvocation<GithubToolParams, ToolResult> {
    return new GithubToolInvocation(this.client, params, messageBus);
  }
}
