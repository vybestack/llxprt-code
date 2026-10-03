/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Per-fixture scheduler registry delegate for cli engine tests. Thin
 * adapter over the production SessionSchedulerRegistry: every lifecycle
 * semantic (owner+purpose keying, in-flight creation dedup, acquisition
 * refcount, dispose at zero, generation safety) comes from
 * createSessionSchedulerRegistry, and real schedulers are built through
 * the fixture's own factory. The adapter adds only the per-acquisition
 * callback refresh through handle.setCallbacks (last writer wins),
 * mirroring session scheduler acquisition. Each fixture builds its own
 * delegate, so there is no cross-test shared registry state to clear.
 */

import {
  createSessionSchedulerRegistry,
  type MessageBus,
  type SchedulerCallbacks,
  type SchedulerHandle,
  type SchedulerPurpose,
} from '@vybestack/llxprt-code-core';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { createToolScheduler, type Agent } from '@vybestack/llxprt-code-agents';

/**
 * The setCallbacks payload the acquired scheduler expects. The config field
 * below borrows the payload's config type so this UI-tree helper stays off
 * the core config class surface (#2373).
 */
type SchedulerSetCallbacksPayload = Parameters<
  SchedulerHandle['setCallbacks']
>[0];

export interface SchedulerRegistryDelegateOptions {
  /** The config recorded on the scheduler's setCallbacks payload. */
  config: SchedulerSetCallbacksPayload['config'];
  /** Fallback MessageBus when an acquisition supplies none. */
  messageBus: MessageBus;
  /** Fallback tool registry when an acquisition supplies none. */
  toolRegistry: ToolRegistry;
  createScheduler(options: {
    interactiveMode?: boolean;
    messageBus?: MessageBus;
    toolRegistry?: ToolRegistry;
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
  disposeScheduler(
    owner: object,
    purpose: SchedulerPurpose,
    handle?: object,
  ): void;
}

export function createLoopSchedulerOwnerForTest(
  config: SchedulerRegistryDelegateOptions['config'],
  messageBus: MessageBus,
): Agent['scheduler'] {
  const registry = createSessionSchedulerRegistry({
    createScheduler: async (options) =>
      createToolScheduler({
        config,
        messageBus: options.messageBus ?? messageBus,
        toolRegistry: options.toolRegistry ?? config.getToolRegistry(),
        toolContextInteractiveMode: options.interactiveMode ?? true,
        getPreferredEditor: () => undefined,
        onEditorClose: () => {},
      }),
  });
  return {
    async acquire(owner, purpose, callbacks, options, dependencies) {
      const handle = await registry.getOrCreate(owner, purpose, {
        ...options,
        ...dependencies,
      });
      handle.setCallbacks({ config, ...callbacks });
      return handle;
    },
    release(owner, purpose, handle) {
      registry.release(owner, purpose, handle);
    },
    setInteractiveSubagentSchedulerFactory: () => {},
  };
}

export function createSchedulerRegistryDelegate(
  deps: SchedulerRegistryDelegateOptions,
): SchedulerRegistryDelegate {
  const registry = createSessionSchedulerRegistry({
    createScheduler: (options) => deps.createScheduler(options),
  });
  return {
    async getOrCreateScheduler(
      owner,
      purpose,
      callbacks,
      options,
      dependencies,
    ) {
      // Construction deps flow through the acquisition that starts the
      // entry (same shape as session acquisition); the fallbacks
      // only cover acquisitions that supply none.
      const handle = await registry.getOrCreate(owner, purpose, {
        ...options,
        messageBus: dependencies?.messageBus ?? deps.messageBus,
        toolRegistry: dependencies?.toolRegistry ?? deps.toolRegistry,
      });
      handle.setCallbacks({
        config: deps.config,
        ...callbacks,
      });
      return handle;
    },
    disposeScheduler(owner, purpose, handle) {
      registry.release(owner, purpose, handle);
    },
  };
}
