/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolSchedulerContract } from '@vybestack/llxprt-code-core/core/toolSchedulerContract.js';

export type OwnedScheduler = Pick<
  ToolSchedulerContract,
  'schedule' | 'cancelAll'
> & {
  dispose(): void | Promise<void>;
};

export interface SchedulerLease {
  readonly ready: Promise<void>;
  schedule(
    request: Parameters<ToolSchedulerContract['schedule']>[0],
    signal?: AbortSignal,
    hookOwner?: Parameters<ToolSchedulerContract['schedule']>[2],
  ): Promise<void>;
  release(): Promise<void>;
}

interface Lifetime {
  readonly controller: AbortController;
  readonly leases: Set<object>;
  readonly executions: Set<Promise<void>>;
  readonly creation: Promise<OwnedScheduler>;
  closing?: Promise<void>;
  failed: boolean;
}

/**
 * One execution owner, independent of its diagnostic label. Construction must
 * be failure-atomic and capture fixed config, registry, bus and callbacks.
 * joinExecutions must join the actual tool work, including work detached by
 * CoreToolScheduler's abort race, not merely its scheduling/completion callback.
 * Neither callback may dispose borrowed config, registry or bus resources.
 */
export class SessionSchedulerOwner {
  private lifetime?: Lifetime;
  private disposal?: Promise<void>;
  private disposed = false;

  constructor(
    readonly label: string,
    private readonly createScheduler: () =>
      | OwnedScheduler
      | Promise<OwnedScheduler>,
    private readonly joinExecutions: () => Promise<void>,
  ) {}

  acquire(): SchedulerLease {
    if (this.disposed)
      throw new Error(`Scheduler owner ${this.label} disposed`);
    if (this.lifetime?.closing)
      throw new Error(`Scheduler owner ${this.label} closing`);
    const lifetime = this.lifetime ?? this.createLifetime();
    const token = {};
    lifetime.leases.add(token);
    let released: Promise<void> | undefined;
    const assertActive = (): void => {
      if (this.disposed)
        throw new Error(`Scheduler owner ${this.label} disposed`);
      if (!lifetime.leases.has(token))
        throw new Error('Scheduler lease released');
    };
    const ready = lifetime.creation.then(() => {
      assertActive();
    });
    return {
      ready,
      schedule: async (request, signal, hookOwner) => {
        assertActive();
        await ready;
        assertActive();
        const scheduler = await lifetime.creation;
        assertActive();
        const executionSignal = signal
          ? AbortSignal.any([signal, lifetime.controller.signal])
          : lifetime.controller.signal;
        executionSignal.throwIfAborted();
        const execution = Promise.resolve().then(() => {
          executionSignal.throwIfAborted();
          return scheduler.schedule(request, executionSignal, hookOwner);
        });
        lifetime.executions.add(execution);
        try {
          await execution;
        } finally {
          lifetime.executions.delete(execution);
        }
      },
      release: () => {
        if (released) return released;
        lifetime.leases.delete(token);
        released =
          lifetime.closing ??
          (lifetime.leases.size === 0 && !lifetime.failed
            ? this.close(lifetime)
            : Promise.resolve());
        return released;
      },
    };
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposed = true;
    this.disposal = this.lifetime
      ? this.close(this.lifetime)
      : Promise.resolve();
    return this.disposal;
  }

  private createLifetime(): Lifetime {
    const lifetime: Lifetime = {
      controller: new AbortController(),
      leases: new Set(),
      executions: new Set(),
      failed: false,
      creation: Promise.resolve().then(() => this.createScheduler()),
    };
    this.lifetime = lifetime;
    void lifetime.creation.catch(() => {
      lifetime.failed = true;
      if (this.lifetime === lifetime && !lifetime.closing)
        this.lifetime = undefined;
    });
    return lifetime;
  }

  private close(lifetime: Lifetime): Promise<void> {
    if (lifetime.closing) return lifetime.closing;
    lifetime.closing = Promise.resolve().then(async () => {
      const errors: unknown[] = [];
      const executions = Promise.allSettled(lifetime.executions);
      lifetime.controller.abort();
      let scheduler: OwnedScheduler | undefined;
      try {
        scheduler = await lifetime.creation;
      } catch (error) {
        errors.push(error);
      }
      try {
        scheduler?.cancelAll();
      } catch (error) {
        errors.push(error);
      }
      for (const result of await executions) {
        if (result.status === 'rejected') errors.push(result.reason);
      }
      try {
        await this.joinExecutions();
      } catch (error) {
        errors.push(error);
      }
      try {
        await scheduler?.dispose();
      } catch (error) {
        errors.push(error);
      }
      if (this.lifetime === lifetime) this.lifetime = undefined;
      if (errors.length > 0)
        throw new AggregateError(
          errors,
          `Scheduler owner ${this.label} cleanup failed`,
        );
    });
    return lifetime.closing;
  }
}
