/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';

type Close = () => void | Promise<void>;
type Phase = 'files' | 'manager' | 'oauth' | 'tokens' | 'settings';

export class AdoptionRelease {
  private readonly actions: Array<{ phase: Phase; close: Close }> = [];
  private closing: Promise<void> | undefined;

  acquire(phase: Phase, close: Close): void {
    if (this.closing !== undefined) throw new Error('Adoption root is closed');
    this.actions.push({ phase, close });
  }

  close(): Promise<void> {
    this.closing ??= Promise.resolve().then(() => this.release(false));
    return this.closing;
  }

  rollback(): Promise<void> {
    this.closing ??= Promise.resolve().then(() => this.release(true));
    return this.closing;
  }

  private async release(reverse: boolean): Promise<void> {
    const phases: readonly Phase[] = [
      'files',
      'manager',
      'oauth',
      'tokens',
      'settings',
    ];
    const actions = reverse
      ? [...this.actions].reverse()
      : phases.flatMap((phase) =>
          this.actions.filter((action) => action.phase === phase),
        );
    const failures: unknown[] = [];
    for (const action of actions) {
      try {
        await action.close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(failures, 'Adoption root cleanup failed');
  }
}

export async function releaseAdoptedFileScope(
  lifecycle: ProviderFileLifecycle,
  scope: string,
): Promise<void> {
  const result = await lifecycle.cleanupScope('session', scope);
  if (result.failed > 0) {
    const snapshot = lifecycle.snapshot();
    const ids = [
      ...new Set([
        ...snapshot.pendingDeletionFileIds,
        ...snapshot.deletionFailures.map((failure) => failure.fileId),
      ]),
    ];
    throw new Error(
      `Provider file cleanup incomplete for runtime ${scope}; files=${ids.join(',') || 'unknown'}; failed=${result.failed}; deferred=${result.deferred}`,
    );
  }
  if (result.deferred > 0)
    await lifecycle.waitForScopeCleanup('session', scope);
}
