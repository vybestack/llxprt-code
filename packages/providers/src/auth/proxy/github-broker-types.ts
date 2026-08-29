/**
 * @license
 * Copyright 2026 Vybestack LLC
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
import type { GithubParamKind } from '@vybestack/llxprt-code-tools/tools/github-ops.js';
import type { BrokerError } from './github-broker-errors.js';

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
 * The kind of a single parameter accepted by an operation.
 *
 * This is now an alias for `GithubParamKind` from the shared catalog
 * (`@vybestack/llxprt-code-tools`), so the broker and the tool layer share
 * one source of truth and cannot drift.
 *
 * @plan PLAN-20260731-GHBROKER.P15
 * @requirement REQ-002, REQ-008
 * @pseudocode 003-github-broker.md lines 16-24
 */
export type ParamKind = GithubParamKind;

/**
 * Runs one `gh` invocation on behalf of a multi-step operation.
 *
 * Resolves with the parsed JSON (or raw text when `rawOutput` is set) and
 * THROWS a BrokerErrorException on failure, so an op's `execute` reads as
 * straight-line code and a failed step aborts the sequence instead of being
 * silently skipped. Ops therefore never handle a result union.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines 56-66
 */
export type GhRunner = (
  argv: readonly string[],
  options?: {
    rawOutput?: boolean;
    tolerateNonZeroExit?: boolean;
  },
) => Promise<unknown>;

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
   * Parameters that must be present. Builders interpolate positionals
   * directly, so a missing one would otherwise reach gh as the literal
   * string "undefined" rather than being rejected.
   *
   * @plan PLAN-20260731-GHBROKER.P19
   * @requirement REQ-002
   */
  readonly requiredParams?: readonly string[];
  /**
   * Optional per-op error augmentation. When declared, the dispatcher runs
   * it on the structured broker error before the failure is thrown, so an op
   * can append self-correction guidance (e.g. the search ops telling a caller
   * to use the `repo` parameter instead of a `repo:` term). The generic
   * classifier is op-agnostic; ops that need guided failures opt in here.
   *
   * @plan PLAN-20260731-GHBROKER.P10
   * @requirement REQ-013
   */
  readonly augmentError?: (error: BrokerError) => BrokerError;
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
   * Optional execution function for ops needing more than one `gh` call
   * (e.g. issue.edit: `gh issue edit` for most fields, then a GraphQL
   * updateIssue for issue type). When present the dispatcher calls this
   * INSTEAD of buildArgv + runGh + shape, and its return value is the
   * shaped response, which must be a non-array object like every other op.
   *
   * @plan PLAN-20260731-GHBROKER.P11
   * @requirement REQ-002
   * @pseudocode 003-github-broker.md lines 46-55
   */
  readonly execute?: (
    params: Record<string, unknown>,
    run: GhRunner,
    signal: AbortSignal,
  ) => Promise<unknown>;
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
