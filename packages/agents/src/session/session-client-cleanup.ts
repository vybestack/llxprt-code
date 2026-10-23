import type { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
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
export async function rethrowAfterCleanup(
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

export function rethrowAfterClientCleanup(
  error: unknown,
  dispose: () => Promise<void>,
  release: () => Promise<void>,
): Promise<never> {
  return rethrowAfterCleanup(
    error,
    () => disposeClientAndFiles({ dispose }, release),
    'Session client binding cleanup failed',
  );
}

/**
 * Tracks the clients a session owns with the provider-file scope each one
 * belongs to. A scope's files are released when its last client is released.
 */
export class OwnedClientLedger {
  private readonly scopes = new Map<AgentClientContract, string>();
  private readonly uses = new Map<AgentClientContract, Set<Promise<void>>>();

  retain(client: AgentClientContract): () => void {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const accepted = this.uses.get(client) ?? new Set<Promise<void>>();
    accepted.add(pending);
    this.uses.set(client, accepted);
    return () => {
      accepted.delete(pending);
      if (accepted.size === 0) this.uses.delete(client);
      release();
    };
  }

  async join(client: AgentClientContract): Promise<void> {
    await Promise.all(this.uses.get(client) ?? []);
  }

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

  settleOwnedClients(): Promise<Array<PromiseSettledResult<void>>> {
    return Promise.allSettled(
      [...this.scopes.keys()].map((client) => this.dispose(client)),
    );
  }

  async dispose(client: AgentClientContract): Promise<void> {
    await this.join(client);
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

export function finishCleanup(
  ...groups: Array<ReadonlyArray<PromiseSettledResult<unknown>>>
): void {
  const failures = groups
    .flat()
    .flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
  if (failures.length > 0)
    throw new AggregateError(failures, 'Session client cleanup failed');
}

export async function cleanupProviderScope(
  files: ProviderFileLifecycle,
  scope: string,
): Promise<void> {
  const result = await files.cleanupScope('session', scope);
  if (result.failed > 0)
    throw new Error(
      `Provider file cleanup incomplete for scope ${scope}: ${JSON.stringify(files.snapshot().deletionFailures)}`,
    );
  if (result.deferred > 0) await files.waitForScopeCleanup('session', scope);
}

export class SessionClientWorkQueue {
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly assertAdmission: () => void) {}
  enqueue<T>(operation: () => Promise<T>): Promise<T> {
    this.assertAdmission();
    return this.enqueueAccepted(operation);
  }
  enqueueAccepted<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(operation);
    this.tail = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }
  join(): Promise<void> {
    return this.tail;
  }
}

export async function initializeClientBinding(
  bind: () => void,
  dispose: () => Promise<void>,
  release: () => Promise<void>,
): Promise<void> {
  try {
    bind();
  } catch (primary) {
    await rethrowAfterClientCleanup(primary, dispose, release);
  }
}
