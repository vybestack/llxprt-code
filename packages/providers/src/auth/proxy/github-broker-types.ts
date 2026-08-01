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
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines 16-24
 */
export type ParamKind =
  | 'repo'
  | 'number'
  | 'boolean'
  | 'state'
  | 'label'
  | 'threadId'
  | 'body'
  | 'freetext';

/**
 * Descriptor for a single GitHub broker operation.
 *
 * - `name`: the operation name, e.g. "issue.view".
 * - `mutating`: whether the op writes (drives confirmation in later phases).
 * - `params`: the accepted parameter specifications.
 * - `buildArgv`: pure function that constructs the `gh` argv array.
 * - `shape`: pure function that transforms raw gh JSON into the shaped
 *   contract.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002, REQ-004
 * @pseudocode 003-github-broker.md lines 38-44
 */
export interface OpDescriptor {
  readonly name: string;
  readonly mutating: boolean;
  readonly params: Readonly<Record<string, ParamKind>>;
  readonly buildArgv: (params: Record<string, unknown>) => string[];
  readonly shape: (rawJson: unknown) => unknown;
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
