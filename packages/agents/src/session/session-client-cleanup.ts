/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';

export async function disposeClientAndFiles(
  client: Pick<AgentClientContract, 'dispose'>,
  releaseFiles: () => Promise<void>,
): Promise<void> {
  const clientCleanup = await Promise.allSettled([
    Promise.resolve().then(() => client.dispose()),
  ]);
  const fileCleanup = await Promise.allSettled([
    Promise.resolve().then(releaseFiles),
  ]);
  const failures = [...clientCleanup, ...fileCleanup].flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(
      failures,
      'Client and provider file cleanup failed',
    );
}

/**
 * Runs cleanup for an operation that already failed and then rethrows the
 * original failure. A cleanup failure is joined to it, never substituted.
 */
async function rethrowAfterCleanup(
  error: unknown,
  cleanup: () => Promise<void>,
  message: string,
): Promise<never> {
  try {
    await cleanup();
  } catch (cleanupError) {
    throw new AggregateError([error, cleanupError], message);
  }
  throw error;
}

/**
 * Tracks the clients a session owns with the provider-file scope each one
 * belongs to. A scope's files are released when its last client is released.
 */
export class OwnedClientLedger {
  private readonly scopes = new Map<AgentClientContract, string>();

  constructor(
    private readonly releaseScope: (scope: string) => Promise<void>,
  ) {}

  register(client: AgentClientContract, scope: string): void {
    this.scopes.set(client, scope);
  }

  /** Stops tracking a client whose disposal is handled elsewhere. */
  forget(client: AgentClientContract): void {
    this.scopes.delete(client);
  }

  clients(): AgentClientContract[] {
    return [...this.scopes.keys()];
  }

  async dispose(client: AgentClientContract): Promise<void> {
    const scope = this.scopes.get(client);
    if (scope === undefined) return;
    await disposeClientAndFiles(client, () => this.release(client, scope));
  }

  /**
   * Disposes a client whose binding failed and then propagates the binding
   * error; a disposal failure is joined to it, never substituted.
   */
  disposeAfterFailure(
    client: AgentClientContract,
    error: unknown,
  ): Promise<never> {
    return rethrowAfterCleanup(
      error,
      () => this.dispose(client),
      'Session client binding failed and client cleanup was incomplete',
    );
  }

  /**
   * For a replacement that prepareAgentClientReplacement already disposed:
   * releases the record and scope, then propagates the original failure.
   */
  releaseFailedReplacement(
    client: AgentClientContract,
    error: unknown,
  ): Promise<never> {
    const scope = this.scopes.get(client);
    return rethrowAfterCleanup(
      error,
      async () => {
        if (scope !== undefined) await this.release(client, scope);
      },
      'Client replacement failed and provider file cleanup was incomplete',
    );
  }

  private async release(
    client: AgentClientContract,
    scope: string,
  ): Promise<void> {
    this.scopes.delete(client);
    if (![...this.scopes.values()].includes(scope))
      await this.releaseScope(scope);
  }
}
