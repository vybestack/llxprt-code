/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Transport selection for brokered GitHub operations.
 *
 * Both environments run the SAME dispatch (executeGitHubOp); only the way
 * the call reaches it differs:
 *
 * - Sandboxed: over the existing authenticated credential socket, so the
 *   container never holds a GitHub credential.
 * - On the host: in-process, because the CLI already is the host.
 *
 * @plan PLAN-20260731-GHBROKER.P15
 * @requirement REQ-001, REQ-003, REQ-004
 * @pseudocode 003-github-broker.md lines 01-11
 */

import type { GitHubBrokerClient } from '@vybestack/llxprt-code-tools';
import type { ProxySocketClient } from '@vybestack/llxprt-code-auth';
import {
  createGitHubBrokerSocketClient,
  executeGitHubOp,
} from '@vybestack/llxprt-code-providers/auth.js';

/**
 * A watch can block for the length of a CI run, far beyond the default
 * 30s request timeout, so brokered operations get a generous per-op
 * timeout. The broker bounds the watch itself.
 */
const GITHUB_OP_TIMEOUT_MS = 3_600_000;

/**
 * Routes an operation over the credential socket. Used only in a sandbox,
 * where no GitHub credential exists in the container.
 *
 * @plan PLAN-20260731-GHBROKER.P15
 * @requirement REQ-001, REQ-003
 */
class ProxyGitHubBrokerClient implements GitHubBrokerClient {
  constructor(private readonly client: ProxySocketClient) {}

  async runOperation(
    op: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const response = await this.client.request(
      'github',
      { op, ...params },
      { timeoutMs: GITHUB_OP_TIMEOUT_MS, signal },
    );
    if (response.ok !== true) {
      throw new Error(
        `${response.code ?? 'GITHUB_ERROR'}: ${response.error ?? 'Operation failed'}`,
      );
    }
    return response.data ?? {};
  }
}

/**
 * Runs an operation in the current process. Used when not sandboxed.
 *
 * @plan PLAN-20260731-GHBROKER.P15
 * @requirement REQ-004
 */
class HostGitHubBrokerClient implements GitHubBrokerClient {
  async runOperation(
    op: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    return executeGitHubOp(op, params, signal);
  }
}

/**
 * Selects the transport for brokered GitHub operations.
 *
 * The sandbox decision and the capability token both come from the
 * credential-store factory, which is where #2784 confines the token. This
 * module never sees it.
 *
 * @plan PLAN-20260731-GHBROKER.P15
 * @requirement REQ-001, REQ-003, REQ-015
 */
export function createGitHubBrokerClient(): GitHubBrokerClient {
  const socketClient = createGitHubBrokerSocketClient();
  return socketClient === null
    ? new HostGitHubBrokerClient()
    : new ProxyGitHubBrokerClient(socketClient);
}
