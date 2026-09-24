/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SchedulerHandle } from './sessionExecutionServices.js';
import type { ToolSchedulerCallbackPayload } from '../core/toolSchedulerContract.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';

export type SchedulerCallbacks = Omit<ToolSchedulerCallbackPayload, 'config'>;

export interface SchedulerOptions {
  interactiveMode?: boolean;
}

/**
 * Purpose a scheduler entry is created for. Replaces the string key
 * suffixes the process-global scheduler singleton assembled from session
 * id strings today.
 */
export type SchedulerPurpose = 'session' | 'agentic-loop' | 'subagent';

/**
 * Session-owned scheduler registry carrying the semantics the deleted
 * process-global scheduler singleton implements today: get-or-create with
 * in-flight deduplication and acquire counting. Binding constraint: keys
 * are owner objects, never strings; two sessions with the same label
 * string never share an entry.
 */
export interface SessionSchedulerRegistry {
  /**
   * Get-or-create the scheduler for one owner and purpose. Concurrent
   * calls with the same key await the same creation rather than building
   * a duplicate.
   *
   * `options.interactiveMode` is a creation argument, not a purpose-derived
   * one: it feeds `toolContextInteractiveMode` at scheduler construction.
   * Consumer trace: interactiveToolScheduler passes true, nonInteractiveToolExecutor
   * passes false, subagentExecution passes nothing (defaults true). The first
   * acquisition of a key fixes the mode; later acquisitions with a different
   * mode reuse the existing scheduler unchanged.
   *
   * `options.messageBus` and `options.toolRegistry` are construction
   * dependencies, so they belong to the acquisition that starts the entry:
   * the scheduler that entry builds is wired to exactly that bus and
   * registry. Later acquisitions reusing the entry keep its construction
   * deps unchanged (first-wins per entry, like interactiveMode).
   */
  getOrCreate(
    owner: object,
    purpose: SchedulerPurpose,
    options?: {
      interactiveMode?: boolean;
      messageBus?: MessageBus;
      toolRegistry?: ToolRegistry;
    },
  ): Promise<SchedulerHandle>;
  /**
   * Release one acquisition of the entry; dispose its scheduler when the
   * count reaches zero. Releasing an unknown key is a no-op.
   *
   * Callers holding their acquired scheduler should pass it as `handle`
   * so a stale release (typically after disposeAll swept the entry and the
   * same key reacquired a replacement) cannot dispose a scheduler the
   * caller no longer owns. A handle that does not match the current entry
   * is ignored.
   */
  release(owner: object, purpose: SchedulerPurpose, handle?: object): void;
  /** Cancel work and pending waits without releasing scheduler listeners. */
  cancelAll(): Promise<void>;
  /** Dispose every entry, joining in-flight creations first. */
  disposeAll(): Promise<void>;
}
