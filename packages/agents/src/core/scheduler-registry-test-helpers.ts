/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Test-only scheduler registry delegate carrying the delegate semantics of
 * Config.getOrCreateScheduler/disposeScheduler: entries keyed by owner object
 * identity plus purpose, in-flight creation dedup, real schedulers built
 * through the fixture's own factory, callbacks refreshed on every
 * acquisition, and disposal when the acquisition count reaches zero. Agent
 * test fixtures wire this in where the deleted process-global scheduler
 * singleton used to sit; every scheduler handed out is the real scheduler
 * the fixture's factory builds, so loop, scheduler, and disposal behavior
 * stays fully exercised.
 */

import type { SchedulerHandle } from '@vybestack/llxprt-code-core/session/sessionExecutionServices.js';
import type { SchedulerPurpose } from '@vybestack/llxprt-code-core/session/sessionSchedulerRegistry.js';
import type {
  Config,
  SchedulerCallbacks,
} from '@vybestack/llxprt-code-core/config/config.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';

export interface SchedulerRegistryDelegateOptions {
  /** The Config recorded on the scheduler's setCallbacks payload. */
  config: Config;
  /** Fallback MessageBus when an acquisition supplies none. */
  messageBus: MessageBus;
  /** Fallback tool registry when an acquisition supplies none. */
  toolRegistry: ToolRegistry;
  createScheduler(options: {
    interactiveMode?: boolean;
  }): Promise<SchedulerHandle>;
}

export interface SchedulerRegistryDelegate {
  getOrCreateScheduler(
    owner: object,
    purpose: SchedulerPurpose,
    callbacks: SchedulerCallbacks,
    options?: { interactiveMode?: boolean },
    dependencies?: {
      messageBus?: MessageBus;
      toolRegistry?: ToolRegistry;
    },
  ): Promise<SchedulerHandle>;
  disposeScheduler(owner: object, purpose: SchedulerPurpose): void;
}

/**
 * Mirrors the production registry's entry lifecycle: an in-flight creation
 * is tracked under its key before construction is awaited, joins bump its
 * refCount, releases during the await decrement it, and completion
 * finalizes that same entry (carrying the live refCount) instead of
 * overwriting state a concurrent join or release already applied.
 */
type DelegateEntry =
  | {
      phase: 'creating';
      promise: Promise<SchedulerHandle>;
      refCount: number;
      /** Identity of this creation attempt, matching the registry impl. */
      generation: number;
    }
  | { phase: 'ready'; handle: SchedulerHandle; refCount: number };

/**
 * Dispose errors are swallowed at cleanup, matching the production
 * registry: a failing dispose must not break the release that triggered it.
 */
const disposeQuietly = (handle: SchedulerHandle): void => {
  try {
    handle.dispose();
  } catch {
    // Dispose failures during cleanup are ignored.
  }
};

/**
 * Callbacks are refreshed on every acquisition, including joins of an
 * in-flight creation, with per-call dependencies falling back to the
 * delegate's own.
 */
const applyCallbacks = (
  deps: SchedulerRegistryDelegateOptions,
  handle: SchedulerHandle,
  callbacks: SchedulerCallbacks,
  dependencies?: {
    messageBus?: MessageBus;
    toolRegistry?: ToolRegistry;
  },
): void => {
  handle.setCallbacks({
    config: deps.config,
    messageBus: dependencies?.messageBus ?? deps.messageBus,
    toolRegistry: dependencies?.toolRegistry ?? deps.toolRegistry,
    ...callbacks,
  });
};

/**
 * Registry core carrying the delegate's entry lifecycle. Structured like
 * the production registry implementation: map operations and the creation
 * race live in small private methods so each stays reviewable.
 */
class DelegateSchedulerRegistry {
  private readonly entries = new Map<
    object,
    Map<SchedulerPurpose, DelegateEntry>
  >();

  /** Monotonic token stamping each creation attempt with its identity. */
  private generation = 0;

  constructor(private readonly deps: SchedulerRegistryDelegateOptions) {}

  async acquire(
    owner: object,
    purpose: SchedulerPurpose,
    options?: { interactiveMode?: boolean },
  ): Promise<SchedulerHandle> {
    const interactiveMode = options?.interactiveMode ?? true;
    const existing = this.lookup(owner, purpose);
    if (existing?.phase === 'ready') {
      existing.refCount += 1;
      return existing.handle;
    }
    if (existing?.phase === 'creating') {
      // Join the in-flight creation instead of building a duplicate
      // scheduler; the join's refCount keeps the entry alive across
      // the await.
      existing.refCount += 1;
      return existing.promise;
    }
    // Track the in-flight entry BEFORE awaiting construction so
    // concurrent same-key acquisitions join it and releases during the
    // await decrement a refCount that is actually tracked.
    const creation = (this.generation += 1);
    const promise = this.runCreation(owner, purpose, interactiveMode, creation);
    promise.catch(() => {
      // Drop the failed creation so a later attempt starts fresh, and
      // only when this attempt's entry still sits under the key.
      const current = this.lookup(owner, purpose);
      if (current?.phase === 'creating' && current.generation === creation) {
        this.remove(owner, purpose);
      }
    });
    this.put(owner, purpose, {
      phase: 'creating',
      promise,
      refCount: 1,
      generation: creation,
    });
    return promise;
  }

  release(owner: object, purpose: SchedulerPurpose): void {
    const entry = this.lookup(owner, purpose);
    // Unknown keys have nothing to release, matching the registry.
    if (!entry) {
      return;
    }
    entry.refCount -= 1;
    if (entry.refCount > 0) {
      return;
    }
    if (entry.phase === 'creating') {
      // Creation still running; its resolution path disposes the
      // unowned handle and drops the entry, matching the registry.
      return;
    }
    this.remove(owner, purpose);
    disposeQuietly(entry.handle);
  }

  private async runCreation(
    owner: object,
    purpose: SchedulerPurpose,
    interactiveMode: boolean,
    creation: number,
  ): Promise<SchedulerHandle> {
    const handle = await this.deps.createScheduler({ interactiveMode });
    const current = this.lookup(owner, purpose);
    if (current?.phase !== 'creating' || current.generation !== creation) {
      // The entry under this key is not this attempt's; leave it alone.
      return handle;
    }
    if (current.refCount > 0) {
      // Finalize the same entry: refCount may have moved through joins
      // and releases while construction ran, so carry the live value.
      this.put(owner, purpose, {
        phase: 'ready',
        handle,
        refCount: current.refCount,
      });
    } else {
      // Every acquirer released during construction; nobody owns the
      // handle, so the at-zero rule disposes it here.
      this.remove(owner, purpose);
      disposeQuietly(handle);
    }
    return handle;
  }

  private lookup(
    owner: object,
    purpose: SchedulerPurpose,
  ): DelegateEntry | undefined {
    return this.entries.get(owner)?.get(purpose);
  }

  private put(
    owner: object,
    purpose: SchedulerPurpose,
    entry: DelegateEntry,
  ): void {
    let byPurpose = this.entries.get(owner);
    if (!byPurpose) {
      byPurpose = new Map<SchedulerPurpose, DelegateEntry>();
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

export function createSchedulerRegistryDelegate(
  deps: SchedulerRegistryDelegateOptions,
): SchedulerRegistryDelegate {
  const registry = new DelegateSchedulerRegistry(deps);
  return {
    async getOrCreateScheduler(
      owner,
      purpose,
      callbacks,
      options,
      dependencies,
    ) {
      const handle = await registry.acquire(owner, purpose, options);
      applyCallbacks(deps, handle, callbacks, dependencies);
      return handle;
    },
    disposeScheduler(owner, purpose) {
      registry.release(owner, purpose);
    },
  };
}
