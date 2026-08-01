/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared types for the GitHub broker component.
 *
 * The broker dispatches typed operations to the `gh` CLI, never accepting or
 * constructing shell strings. It is a distinct component from the credential
 * proxy (REQ-004): it shares transport only, never importing or touching the
 * credential-storage layer.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002, REQ-004
 * @pseudocode 003-github-broker.md lines 38-44
 */

import type { RequestHandler } from './github-broker-request-handler.js';

/**
 * A validation error produced when a request's parameters do not match an
 * operation's descriptor. Carries a structured code so the caller receives
 * a deterministic response rather than a raw exception string.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines 13-31
 */
export interface ValidationError {
  /** Structured error code (INVALID_PARAM, UNKNOWN_OP, etc.). */
  code: string;
  /** Human-readable detail, already redacted. */
  message: string;
}

/**
 * The structured response data for a GitHub broker operation. The `data`
 * field is shaped per the operation descriptor; it is never raw gh JSON.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines Contract/Outputs
 */
export interface GitHubOpResponse {
  data: unknown;
  truncated?: { field: string; originalBytes: number };
}

/**
 * Specification for a single parameter accepted by an operation.
 *
 * @plan PLAN-20260731-GHBROKER.P08, PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines 16-24
 */
export type ParamKind =
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
 * The result of a single `gh` invocation: raw stdout text plus a flag
 * indicating whether the dispatcher should treat it as raw text or parse
 * it as JSON.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines 56-62
 */
export interface GhResult {
  readonly stdout: string;
  readonly rawOutput: boolean;
}

/**
 * A function that runs `gh` with the given argv array and signal. This is
 * the callback that the dispatcher passes to an op's `execute` function,
 * so the op can perform multiple `gh` calls (e.g. issue.edit's hybrid
 * gh-issue-edit + GraphQL mutation) without coupling to the real
 * `execFile` implementation.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines 56-62
 */
export type RunGhFn = (
  argv: readonly string[],
  signal: AbortSignal,
  options?: {
    rawOutput?: boolean;
    tolerateNonZeroExit?: boolean;
  },
) => Promise<GhResult>;

/**
 * The context passed to an op's `execute` function, providing the `runGh`
 * callback and the abort signal.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines 46-55
 */
export interface ExecuteContext {
  readonly runGh: RunGhFn;
  readonly signal: AbortSignal;
}

/**
 * The result returned by an op's `execute` function: the raw gh output
 * (for shaping) plus any additional params to pass through to `shape`.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002
 */
export interface ExecuteResult {
  readonly rawJson: unknown;
  readonly params: Record<string, unknown>;
}

/**
 * Descriptor for a single GitHub broker operation.
 *
 * - `name`: the operation name, e.g. "issue.view".
 * - `mutating`: whether the op writes (drives confirmation in later phases).
 * - `params`: the accepted parameter specifications.
 * - `buildArgv`: pure function that constructs the `gh` argv array.
 * - `shape`: pure function that transforms raw gh JSON into the shaped
 *   contract.
 * - `execute`: optional; for ops that need custom multi-step execution
 *   (e.g. issue.edit's hybrid gh + GraphQL). When present, the dispatcher
 *   calls `execute` instead of `buildArgv` + `runGh`.
 *
 * @plan PLAN-20260731-GHBROKER.P08, PLAN-20260731-GHBROKER.P10, PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002, REQ-004
 * @pseudocode 003-github-broker.md lines 38-44
 */
export interface OpDescriptor {
  readonly name: string;
  readonly mutating: boolean;
  readonly params: Readonly<Record<string, ParamKind>>;
  readonly buildArgv: (params: Record<string, unknown>) => string[];
  readonly shape: (
    rawJson: unknown,
    params: Record<string, unknown>,
  ) => unknown;
  /**
   * When true, stdout is NOT JSON-parsed; the raw text string is passed
   * directly to `shape`. Used by ops like pr.diff that return unified
   * diff text rather than JSON.
   *
   * @plan PLAN-20260731-GHBROKER.P10
   * @requirement REQ-013
   * @pseudocode 003-github-broker.md lines 125-126
   */
  readonly rawOutput?: boolean;
  /**
   * Parameter names whose values are free-form body text. The dispatcher
   * materialises each into a mode-0600 temp file BEFORE calling buildArgv
   * and replaces the parameter value with the file path, so buildArgv can
   * emit `--body-file <path>` while remaining pure. The files are always
   * removed afterwards, including when gh fails.
   *
   * Body text never enters argv directly: newlines, length and leading
   * dashes are then structurally incapable of affecting argument parsing.
   *
   * @plan PLAN-20260731-GHBROKER.P11
   * @requirement REQ-002
   * @pseudocode 003-github-broker.md lines 22-23
   */
  readonly bodyParams?: readonly string[];
  /**
   * When true, a non-zero gh exit code does NOT short-circuit the
   * response as an error. Instead stdout is still passed to `shape` so
   * the caller can classify by content. Used by pr.checks where gh
   * exits non-zero whenever checks are failing or pending.
   *
   * @plan PLAN-20260731-GHBROKER.P10
   * @requirement REQ-013
   * @pseudocode 003-github-broker.md lines 105-109
   */
  readonly tolerateNonZeroExit?: boolean;
  /**
   * When true, the op invokes gh via `gh api graphql` (rather than a
   * subcommand returning --json). The dispatcher uses this to apply
   * GraphQL partial-success validation before shaping.
   *
   * @plan PLAN-20260731-GHBROKER.P10
   * @requirement REQ-013
   * @pseudocode 003-github-broker.md lines 67-76
   */
  readonly usesGraphql?: boolean;
  /**
   * Optional custom execution function for ops that need multi-step
   * execution (e.g. issue.edit: gh issue edit for most fields, then
   * GraphQL updateIssue for issue type). When present, the dispatcher
   * calls this instead of buildArgv + runGh, passing a runGh callback
   * and the abort signal. The function returns raw gh output and any
   * additional params for shaping.
   *
   * @plan PLAN-20260731-GHBROKER.P11
   * @requirement REQ-002
   * @pseudocode 003-github-broker.md lines 46-55
   */
  readonly execute?: (
    params: Record<string, unknown>,
    ctx: ExecuteContext,
  ) => Promise<ExecuteResult>;
}

/**
 * The handler signature the broker exposes for registration on the
 * credential proxy server.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-003
 * @pseudocode 003-github-broker.md lines 01-11
 */
export type { RequestHandler };

/**
 * The object returned by createGitHubBrokerHandler, carrying the handler
 * function to register and references to the internal modules for testing.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-003
 */
export interface GitHubBrokerHandler {
  /** The request handler to register as an extraHandler on the server. */
  handler: RequestHandler;
}
