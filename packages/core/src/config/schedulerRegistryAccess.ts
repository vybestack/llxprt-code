/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Scheduler registry acquisition extracted from Config to keep config.ts
 * under size/complexity limits. Config.getOrCreateScheduler delegates here;
 * the registry backing, its lazy construction, and the acquisition types
 * live in this module.
 */

import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import type { Config } from './config.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import { type SchedulerHandle } from '../session/sessionExecutionServices.js';
import type {
  SchedulerPurpose,
  SessionSchedulerRegistry,
} from '../session/sessionSchedulerRegistry.js';
import { createSessionSchedulerRegistry } from '../session/sessionSchedulerRegistryImpl.js';
import type { LiveOutputUpdate } from '../utils/terminalSerializer.js';
import type {
  CompletedToolCall,
  ToolCall,
} from '../core/toolSchedulerContract.js';
import type { EditorType } from '../utils/editor.js';

/**
 * Callbacks the scheduler consumers hand to Config.getOrCreateScheduler.
 * Moved here from the deleted process-global scheduler singleton module;
 * consumers import them from config.js (or the package barrel) directly.
 */
export interface SchedulerCallbacks {
  outputUpdateHandler?: (toolCallId: string, update: LiveOutputUpdate) => void;
  onAllToolCallsComplete?: (
    completedToolCalls: CompletedToolCall[],
  ) => Promise<void>;
  onToolCallsUpdate?: (toolCalls: ToolCall[]) => void;
  getPreferredEditor: () => EditorType | undefined;
  onEditorClose: () => void;
  onEditorOpen?: () => void;
}

/**
 * Options for scheduler acquisition through Config.getOrCreateScheduler.
 */
export interface SchedulerOptions {
  /**
   * Whether the scheduler operates in interactive mode.
   * When false, the scheduler is configured for non-interactive/subagent contexts
   * (e.g., no live progress display, no editor support).
   * Defaults to true for backward compatibility.
   */
  interactiveMode?: boolean;
}

/**
 * Structural view of Config for the protected ConfigBase.schedulerRegistry
 * field, same cast-through pattern as configConstructor's target type.
 */
type SchedulerRegistryHost = {
  schedulerRegistry: SessionSchedulerRegistry | undefined;
};

/**
 * TEMPORARY with the schedulerRegistry field on ConfigBase (deletion
 * criterion in that field's comment): both die when SessionRuntime takes
 * registry ownership. The createScheduler closure captures only the tool
 * scheduler factory; the messageBus and toolRegistry construction deps
 * arrive through the createScheduler options from the acquisition that
 * starts each entry, so every entry binds the deps of its own first
 * acquirer, not the first acquirer of the whole registry.
 */
function getSchedulerRegistry(config: Config): SessionSchedulerRegistry {
  const host = config as unknown as SchedulerRegistryHost;
  host.schedulerRegistry ??= createSessionSchedulerRegistry({
    createScheduler: async (options) => {
      const factory = config.getToolSchedulerFactory();
      if (!factory) {
        throw new Error(
          'toolSchedulerFactory is required before Config.getOrCreateScheduler() can create a CoreToolScheduler',
        );
      }
      const { messageBus, toolRegistry } = options;
      if (!messageBus || !toolRegistry) {
        throw new Error(
          'Config-mediated scheduler acquisition requires messageBus and toolRegistry construction deps',
        );
      }
      return factory({
        config,
        messageBus,
        toolRegistry,
        toolContextInteractiveMode: options.interactiveMode ?? true,
        // Creation-time callback stubs: the delegate always applies the
        // acquiring call's real callbacks via setCallbacks before the
        // scheduler can run anything.
        getPreferredEditor: () => undefined,
        onEditorClose: () => {},
      });
    },
  });
  return host.schedulerRegistry;
}

/**
 * Acquisition path for Config.getOrCreateScheduler (#2615 slice E, see
 * ConfigBase.schedulerRegistry). Owner is an object whose identity keys the
 * scheduler entry (never a string): two consumers with colliding labels get
 * distinct schedulers. Each acquisition supplies its own messageBus and
 * toolRegistry construction deps: the acquisition that starts an entry
 * fixes them at construction time, and later acquisitions reuse the entry
 * as built while still refreshing the five UI callbacks through
 * handle.setCallbacks (construction deps are readonly on the scheduler and
 * cannot be swapped after creation).
 */
export async function acquireScheduler(
  config: Config,
  owner: object,
  purpose: SchedulerPurpose,
  callbacks: SchedulerCallbacks,
  options?: SchedulerOptions,
  dependencies?: {
    messageBus?: MessageBus;
    toolRegistry?: ToolRegistry;
  },
): Promise<SchedulerHandle> {
  const schedulerMessageBus = dependencies?.messageBus;
  if (!schedulerMessageBus) {
    throw new Error(
      'Config.getOrCreateScheduler requires an explicit session/runtime MessageBus dependency.',
    );
  }
  const toolRegistry = dependencies.toolRegistry ?? config.getToolRegistry();
  const registry = getSchedulerRegistry(config);
  const handle = await registry.getOrCreate(owner, purpose, {
    ...options,
    messageBus: schedulerMessageBus,
    toolRegistry,
  });
  handle.setCallbacks({
    config,
    ...callbacks,
  });
  return handle;
}
