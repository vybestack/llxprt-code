/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Per-fixture scheduler registry delegate for cli engine tests. Carries the
 * delegate semantics of Config.getOrCreateScheduler/disposeScheduler for the
 * hand-built Config fixtures these tests assemble: entries keyed by owner
 * object identity plus purpose, real schedulers built through the fixture's
 * own factory, callbacks refreshed on every acquisition, and disposal when
 * the acquisition count reaches zero. Stands in where the deleted
 * process-global scheduler singleton used to sit; every scheduler handed out
 * is the real scheduler the fixture's factory builds, so loop, scheduler,
 * and disposal behavior stays fully exercised. Each fixture builds its own
 * delegate, so there is no cross-test shared registry state to clear.
 */

import type {
  Config,
  MessageBus,
  SchedulerCallbacks,
  SchedulerHandle,
  SchedulerPurpose,
} from '@vybestack/llxprt-code-core';
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

export function createSchedulerRegistryDelegate(
  deps: SchedulerRegistryDelegateOptions,
): SchedulerRegistryDelegate {
  const entries = new Map<
    object,
    Map<SchedulerPurpose, { handle: SchedulerHandle; refCount: number }>
  >();

  return {
    async getOrCreateScheduler(
      owner,
      purpose,
      callbacks,
      options,
      dependencies,
    ) {
      let byPurpose = entries.get(owner);
      const existing = byPurpose?.get(purpose);
      if (existing) {
        existing.refCount += 1;
        existing.handle.setCallbacks({
          config: deps.config,
          messageBus: dependencies?.messageBus ?? deps.messageBus,
          toolRegistry: dependencies?.toolRegistry ?? deps.toolRegistry,
          ...callbacks,
        });
        return existing.handle;
      }
      const handle = await deps.createScheduler({
        interactiveMode: options?.interactiveMode ?? true,
      });
      byPurpose ??= new Map();
      entries.set(owner, byPurpose);
      byPurpose.set(purpose, { handle, refCount: 1 });
      handle.setCallbacks({
        config: deps.config,
        messageBus: dependencies?.messageBus ?? deps.messageBus,
        toolRegistry: dependencies?.toolRegistry ?? deps.toolRegistry,
        ...callbacks,
      });
      return handle;
    },
    disposeScheduler(owner, purpose) {
      const byPurpose = entries.get(owner);
      const entry = byPurpose?.get(purpose);
      // Unknown keys have nothing to release, matching the registry.
      if (!byPurpose || !entry) {
        return;
      }
      entry.refCount -= 1;
      if (entry.refCount > 0) {
        return;
      }
      byPurpose.delete(purpose);
      if (byPurpose.size === 0) {
        entries.delete(owner);
      }
      // A failing dispose must not break the release that triggered it,
      // matching the production registry's cleanup.
      try {
        entry.handle.dispose();
      } catch {
        // Dispose failures during cleanup are ignored.
      }
    },
  };
}
