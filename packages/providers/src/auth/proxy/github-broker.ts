/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Host-side GitHub broker component.
 *
 * The broker dispatches typed GitHub operations to the `gh` CLI, multiplexing
 * on the EXISTING authenticated credential-proxy socket (REQ-003). It is a
 * distinct component from the credential proxy (REQ-004): it shares transport
 * only, never importing or touching the credential-storage layer.
 *
 * Security invariants:
 * - `gh` is invoked via execFile with `shell: false`; never exec, never
 *   spawn with shell true, never string concatenation (REQ-002).
 * - GH_TOKEN and GITHUB_TOKEN are NEVER set; gh resolves its own keyring
 *   credential (REQ-001).
 * - All outbound messages are redacted for token-shaped substrings because
 *   stderr originates from an external process we do not control.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002, REQ-003, REQ-004
 * @pseudocode 003-github-broker.md lines 01-95
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type {
  RequestHandler,
  ValidationError,
  GitHubBrokerHandler,
} from './github-broker-types.js';
import { OP_REGISTRY, validateParams } from './github-broker-ops.js';
import {
  classifyStderr,
  mapGraphQLErrorType,
  redactTokenShaped,
  makeBrokerError,
  type BrokerError,
} from './github-broker-errors.js';

const execFileAsync = promisify(execFile);

/** maxBuffer: 8 MiB, deliberately larger than the 4 MiB frame cap. */
const MAX_BUFFER = 8 * 1024 * 1024;

// ─── Environment for the child process (pseudocode lines 32-37) ──────────────

/**
 * Builds the minimal environment for the gh child process. Does NOT set
 * GH_TOKEN or GITHUB_TOKEN — gh must resolve its own keyring credential.
 *
 * Sets GH_PROMPT_DISABLED=1 and GH_NO_UPDATE_NOTIFIER=1 so a child can
 * never block waiting on a TTY that does not exist.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-001
 * @pseudocode 003-github-broker.md lines 32-37
 */
function buildMinimalEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  // Carry PATH and HOME so gh can find its binary and config.
  if (process.env.PATH !== undefined) env.PATH = process.env.PATH;
  if (process.env.HOME !== undefined) env.HOME = process.env.HOME;
  // Prevent gh from blocking on a TTY or prompting for updates.
  env.GH_PROMPT_DISABLED = '1';
  env.GH_NO_UPDATE_NOTIFIER = '1';
  return env;
}

// ─── runGh (pseudocode lines 56-66) ──────────────────────────────────────────

/**
 * The successful result of runGh: parsed JSON from stdout.
 */
interface GhSuccess {
  kind: 'success';
  json: unknown;
}

/**
 * The failure result of runGh: a structured broker error.
 */
interface GhFailure {
  kind: 'failure';
  error: BrokerError;
}

type GhResult = GhSuccess | GhFailure;

/**
 * Runs `gh` with the given argv via execFile (shell: false), parsing stdout
 * as JSON. Classifies failures into structured broker errors.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-001, REQ-002
 * @pseudocode 003-github-broker.md lines 56-66
 */
async function runGh(
  argv: readonly string[],
  signal: AbortSignal,
): Promise<GhResult> {
  const env = buildMinimalEnv();
  try {
    const { stdout } = await execFileAsync('gh', [...argv], {
      shell: false,
      signal,
      maxBuffer: MAX_BUFFER,
      env,
    });
    const json = parseJsonSafe(stdout);
    return { kind: 'success', json };
  } catch (err) {
    return classifyExecError(err);
  }
}

/**
 * Parses stdout as JSON, throwing a structured error on failure.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-004
 * @pseudocode 003-github-broker.md line 61
 */
function parseJsonSafe(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error('GITHUB_ERROR: gh produced non-JSON output');
  }
}

/**
 * Classifies an execFile error into a structured broker error. Handles all
 * three failure shapes: ENOENT (gh missing), non-zero exit (stderr), and
 * GraphQL errors (HTTP 200 with errors[]).
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-001, REQ-004
 * @pseudocode 003-github-broker.md lines 67-95
 */
function classifyExecError(err: unknown): GhFailure {
  const error = err as NodeJS.ErrnoException & {
    stdout?: string;
    stderr?: string;
    code?: string | number;
    signal?: string;
  };

  // ENOENT or ENOTDIR: gh binary missing from PATH (PATH points to a
  // non-directory or no PATH entry resolves to a gh binary)
  if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
    return {
      kind: 'failure',
      error: makeBrokerError('HOST_GH_UNAVAILABLE', 'gh binary not found'),
    };
  }

  // Aborted via signal
  if (error.code === 'ABORT_ERR' || error.signal === 'SIGTERM') {
    return {
      kind: 'failure',
      error: makeBrokerError('GITHUB_ERROR', 'Operation cancelled'),
    };
  }

  // Check if stdout has a GraphQL errors array (HTTP 200 with errors)
  const stdout = typeof error.stdout === 'string' ? error.stdout : '';
  const graphqlError = tryGraphQLError(stdout);
  if (graphqlError) {
    return { kind: 'failure', error: graphqlError };
  }

  // Non-zero CLI exit: classify from stderr
  const stderr = typeof error.stderr === 'string' ? error.stderr : '';
  const msg = stderr !== '' ? stderr : error.message;
  const code = classifyStderr(msg);
  return {
    kind: 'failure',
    error: makeBrokerError(code, msg),
  };
}

/**
 * Attempts to detect a GraphQL errors[] payload in stdout. If found, maps
 * it to a structured broker error. Handles partial success (data AND
 * errors) as an error, never partial data.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-004
 * @pseudocode 003-github-broker.md lines 67-76
 */
function tryGraphQLError(stdout: string): BrokerError | null {
  if (stdout.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const errors = obj.errors;
  if (!Array.isArray(errors) || errors.length === 0) return null;
  const first = errors[0] as Record<string, unknown>;
  const type = typeof first.type === 'string' ? first.type : undefined;
  const message =
    typeof first.message === 'string' ? first.message : 'GraphQL error';
  return makeBrokerError(mapGraphQLErrorType(type), message);
}

/**
 * Checks if a parsed JSON result contains both data and errors (GraphQL
 * partial success). If so, throws so the caller surfaces an error rather
 * than returning partial data.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-004
 * @pseudocode 003-github-broker.md lines 75-76
 */
function assertNoPartialSuccess(parsed: unknown): void {
  if (parsed === null || typeof parsed !== 'object') return;
  const obj = parsed as Record<string, unknown>;
  if (
    obj.data !== undefined &&
    Array.isArray(obj.errors) &&
    obj.errors.length > 0
  ) {
    const first = obj.errors[0] as Record<string, unknown>;
    const type = typeof first.type === 'string' ? first.type : undefined;
    const message =
      typeof first.message === 'string' ? first.message : 'GraphQL error';
    throw makeBrokerErrorInstance(mapGraphQLErrorType(type), message);
  }
}

/**
 * Creates an Error that carries a BrokerError, so shaping functions can
 * throw it and the dispatcher can extract the structured code.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-004
 */
class BrokerErrorException extends Error {
  readonly brokerError: BrokerError;
  constructor(brokerError: BrokerError) {
    super(brokerError.message);
    this.name = 'BrokerError';
    this.brokerError = brokerError;
  }
}

/**
 * Throws a BrokerErrorException carrying a BrokerError.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-004
 */
function makeBrokerErrorInstance(
  code: BrokerError['code'],
  message: string,
): BrokerErrorException {
  return new BrokerErrorException(makeBrokerError(code, message));
}

// ─── Handler factory ─────────────────────────────────────────────────────────

/**
 * Creates the GitHub broker handler to register on the credential proxy
 * server as an extraHandler. The handler dispatches a GitHub op request,
 * validates parameters, builds argv, runs gh, shapes the result, and
 * sends the response.
 *
 * The handler signature matches RequestHandler and is registered under the
 * `github` op name. Requests reach it only after the capability-token
 * handshake gate (REQ-003, REQ-015).
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002, REQ-003, REQ-004
 * @pseudocode 003-github-broker.md lines 01-11, 46-50
 */
export function createGitHubBrokerHandler(): GitHubBrokerHandler {
  const handler: RequestHandler = async (
    _socket,
    id,
    payload,
    state,
    signal,
  ): Promise<void> => {
    const op = typeof payload.op === 'string' ? payload.op : '';
    const opParams = extractOpParams(payload);

    // Look up the descriptor; unknown op → UNKNOWN_OP
    if (!Object.prototype.hasOwnProperty.call(OP_REGISTRY, op)) {
      state.writer.sendError(
        id,
        'UNKNOWN_OP',
        redactTokenShaped(`Unknown operation: ${op}`),
      );
      return;
    }
    const descriptor = OP_REGISTRY[op];

    // Validate params against the descriptor
    const validationError: ValidationError | null = validateParams(
      descriptor.params,
      opParams,
    );
    if (validationError !== null) {
      state.writer.sendError(
        id,
        validationError.code,
        redactTokenShaped(validationError.message),
      );
      return;
    }

    // Build argv and run gh
    const argv = descriptor.buildArgv(opParams);
    const result = await runGh(argv, signal);

    if (result.kind === 'failure') {
      state.writer.sendError(id, result.error.code, result.error.message);
      return;
    }

    // Check for GraphQL partial success (data AND errors)
    try {
      assertNoPartialSuccess(result.json);
    } catch (err) {
      if (err instanceof BrokerErrorException) {
        state.writer.sendError(
          id,
          err.brokerError.code,
          err.brokerError.message,
        );
        return;
      }
      throw err;
    }

    // Shape the raw JSON into the contract
    let shaped: unknown;
    try {
      shaped = descriptor.shape(result.json);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to shape response';
      state.writer.sendError(id, 'GITHUB_ERROR', redactTokenShaped(message));
      return;
    }

    // Send the shaped response
    const data = shaped as Record<string, unknown>;
    state.writer.sendOk(id, data);
  };

  return { handler };
}

/**
 * Extracts the operation-specific parameters from the payload, excluding
 * the `op` key.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines Contract/Inputs
 */
function extractOpParams(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key !== 'op') {
      result[key] = value;
    }
  }
  return result;
}
