/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SessionSchedulerRegistry implementation (#2615 slice E, PR 2). Carries the
 * semantics of the deleted process-global scheduler singleton module:
 * refcount per entry, in-flight creation dedup, dispose at zero with
 * swallowed cleanup errors, and first-acquisition-wins interactiveMode.
 * Keys are owner objects, never strings, so two consumers with colliding
 * labels never share a scheduler.
 */

import { DebugLogger } from '../debug/DebugLogger.js';
import type { SchedulerHandle } from './sessionExecutionServices.js';
import type { SessionSchedulerRegistry } from './sessionSchedulerRegistry.js';
import type { SchedulerPurpose } from './sessionSchedulerRegistry.js';

const debugLog = new DebugLogger('llxprt:session-scheduler-registry');

type InFlightEntry = {
  phase: 'creating';
  promise: Promise<SchedulerHandle>;
  refCount: number;
  interactiveMode: boolean;
};

type ReadyEntry = {
  phase: 'ready';
  handle: SchedulerHandle;
  refCount: number;
  interactiveMode: boolean;
};

type SchedulerEntry = InFlightEntry | ReadyEntry;

export interface SessionSchedulerRegistryDeps {
  createScheduler(options: {
    interactiveMode?: boolean;
  }): Promise<SchedulerHandle>;
}

/**
 * Dispose errors are swallowed at cleanup exactly as the deleted scheduler
 * singleton module did: a failing dispose must not mask the release that
 * triggers it. The WeakSet keeps disposeAll's join of an in-flight creation
 * from disposing a handle that an at-zero resolution already disposed.
 */
const createDisposeQuietly = (): ((handle: SchedulerHandle) => void) => {
  const disposed = new WeakSet<SchedulerHandle>();
  return (handle: SchedulerHandle): void => {
    if (disposed.has(handle)) {
      return;
    }
    disposed.add(handle);
    try {
      handle.dispose();
    } catch {
      // Dispose may fail; ignore during cleanup.
    }
  };
};

export class SessionSchedulerRegistryImpl implements SessionSchedulerRegistry {
  /**
   * A plain Map rather than WeakMap: disposeAll must enumerate every entry.
   * Entries die on release-at-zero or disposeAll, so the map never outlives
   * the schedulers it tracks.
   */
  private readonly entries = new Map<
    object,
    Map<SchedulerPurpose, SchedulerEntry>
  >();

  private readonly disposeQuietly = createDisposeQuietly();

  constructor(private readonly deps: SessionSchedulerRegistryDeps) {}

  async getOrCreate(
    owner: object,
    purpose: SchedulerPurpose,
    options?: { interactiveMode?: boolean },
  ): Promise<SchedulerHandle> {
    const interactiveMode = options?.interactiveMode ?? true;
    const existing = this.lookup(owner, purpose);

    if (existing?.phase === 'ready') {
      existing.refCount += 1;
      if (existing.interactiveMode !== interactiveMode) {
        debugLog.debug(
          () =>
            `Scheduler reuse with different interactiveMode ` +
            `(existing=${existing.interactiveMode}, requested=${interactiveMode}). ` +
            `Using existing scheduler mode.`,
        );
      }
      return existing.handle;
    }

    if (existing?.phase === 'creating') {
      existing.refCount += 1;
      if (existing.interactiveMode !== interactiveMode) {
        debugLog.debug(
          () =>
            `Scheduler init-in-progress with different interactiveMode ` +
            `(existing=${existing.interactiveMode}, requested=${interactiveMode}). ` +
            `Using existing scheduler mode.`,
        );
      }
      return existing.promise;
    }

    // At most one creation per key can be in flight, so any 'creating'
    // entry the resolution path finds later under this key is this one;
    // the closure never needs to capture the entry itself.
    const promise = this.runCreation(owner, purpose, interactiveMode);
    promise.catch(() => {
      // Drop the failed creation so a later attempt starts fresh rather
      // than awaiting a permanently rejected promise.
      const current = this.lookup(owner, purpose);
      if (current?.phase === 'creating') {
        this.remove(owner, purpose);
      }
    });
    this.put(owner, purpose, {
      phase: 'creating',
      promise,
      refCount: 1,
      interactiveMode,
    });
    return promise;
  }

  private async runCreation(
    owner: object,
    purpose: SchedulerPurpose,
    interactiveMode: boolean,
  ): Promise<SchedulerHandle> {
    const handle = await this.deps.createScheduler({ interactiveMode });
    const current = this.lookup(owner, purpose);
    if (current?.phase !== 'creating') {
      // disposeAll swept the map mid-flight and owns the dispose.
      return handle;
    }
    if (current.refCount > 0) {
      this.put(owner, purpose, {
        phase: 'ready',
        handle,
        refCount: current.refCount,
        interactiveMode: current.interactiveMode,
      });
    } else {
      // Every acquirer released while creation ran; nobody owns the
      // handle, so the at-zero rule disposes it here.
      this.remove(owner, purpose);
      this.disposeQuietly(handle);
    }
    return handle;
  }

  release(owner: object, purpose: SchedulerPurpose): void {
    const entry = this.lookup(owner, purpose);
    // Unknown keys (or already-swept ones) have nothing to release.
    if (!entry) {
      return;
    }
    entry.refCount -= 1;
    if (entry.refCount > 0) {
      return;
    }
    if (entry.phase === 'creating') {
      // Creation still running; its resolution path disposes the unowned
      // handle and drops the entry.
      return;
    }
    this.remove(owner, purpose);
    this.disposeQuietly(entry.handle);
  }

  async disposeAll(): Promise<void> {
    const snapshots: SchedulerEntry[] = [];
    for (const byPurpose of this.entries.values()) {
      for (const entry of byPurpose.values()) {
        snapshots.push(entry);
      }
    }
    this.entries.clear();

    // Join in-flight creations first so their handles land in the dispose
    // sweep below instead of resolving into a cleared registry as orphans.
    const handles = await Promise.all(
      snapshots.map((entry) =>
        entry.phase === 'creating'
          ? entry.promise.catch(() => undefined)
          : Promise.resolve(entry.handle),
      ),
    );
    for (const handle of handles) {
      if (handle !== undefined) {
        this.disposeQuietly(handle);
      }
    }
  }

  private lookup(
    owner: object,
    purpose: SchedulerPurpose,
  ): SchedulerEntry | undefined {
    return this.entries.get(owner)?.get(purpose);
  }

  private put(
    owner: object,
    purpose: SchedulerPurpose,
    entry: SchedulerEntry,
  ): void {
    let byPurpose = this.entries.get(owner);
    if (!byPurpose) {
      byPurpose = new Map<SchedulerPurpose, SchedulerEntry>();
      this.entries.set(owner, byPurpose);
    }
    byPurpose.set(purpose, entry);
  }

  private remove(owner: object, purpose: SchedulerPurpose): void {
    const byPurpose = this.entries.get(owner);
    if (!byPurpose) {
      return;
    }
    byPurpose.delete(purpose);
    if (byPurpose.size === 0) {
      this.entries.delete(owner);
    }
  }
}

export function createSessionSchedulerRegistry(
  deps: SessionSchedulerRegistryDeps,
): SessionSchedulerRegistry {
  return new SessionSchedulerRegistryImpl(deps);
}
