/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Thin adapter over the production SessionSchedulerRegistry: every
 * lifecycle semantic (owner+purpose keying, in-flight creation dedup,
 * acquisition refcount, dispose at zero, generation safety) comes from
 * createSessionSchedulerRegistry, and real schedulers are built through
 * the fixture's own factory. The adapter adds only the per-acquisition
 * callback refresh through handle.setCallbacks (last writer wins),
 * mirroring session scheduler acquisition. Agent test fixtures wire this in
 * where the deleted process-global scheduler singleton used to sit.
 */

import { createSessionSchedulerRegistry } from '@vybestack/llxprt-code-core';
import { createSessionSchedulerOwner } from '../../api/agentRuntimeAssembly.js';
import type { ToolExecutionConfig } from '../nonInteractiveToolExecutor.js';
import type { ToolSchedulerFactory } from '@vybestack/llxprt-code-core/core/toolSchedulerContract.js';
import type { SchedulerHandle } from '@vybestack/llxprt-code-core/session/sessionExecutionServices.js';
import type {
  SchedulerCallbacks,
  SchedulerPurpose,
} from '@vybestack/llxprt-code-core/session/sessionSchedulerRegistry.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
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

export function createToolExecutionPort(
  config: Config,
  factory: ToolSchedulerFactory,
  messageBus: MessageBus,
  toolRegistry: ToolRegistry,
): Pick<ToolExecutionConfig, 'acquireScheduler' | 'releaseScheduler'> {
  const owner = createSessionSchedulerOwner(config, factory);
  return {
    acquireScheduler: (identity, purpose, callbacks, options, dependencies) =>
      owner.acquire(identity, purpose, callbacks, options, {
        messageBus: dependencies?.messageBus ?? messageBus,
        toolRegistry: dependencies?.toolRegistry ?? toolRegistry,
      }),
    releaseScheduler: (identity, purpose, handle) =>
      owner.release(identity, purpose, handle),
  };
}
