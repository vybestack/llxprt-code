/**
 * @license
 * Copyright 2025 Vybestack LLC
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

  async execute(signal: AbortSignal): Promise<ToolResult> {
    const { op, ...rest } = this.params;
    try {
      const data = await this.client.runOperation(op, rest, signal);
      const json = JSON.stringify(data, null, 2);
      return {
        llmContent: json,
        returnDisplay: `${this.getDescription()}\n\n\`\`\`json\n${json}\n\`\`\``,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        llmContent: `GitHub operation failed: ${message}`,
        returnDisplay: `GitHub operation failed: ${message}`,
        error: { message },
      };
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
