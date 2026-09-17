/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SchedulerHandle } from './sessionExecutionServices.js';

/**
 * Purpose a scheduler entry is created for. Replaces the string key
 * suffixes the process-global scheduler singleton assembled from session
 * id strings today.
 */
export type SchedulerPurpose = 'session' | 'agentic-loop' | 'subagent';

/**
 * Session-owned scheduler registry carrying the semantics
 * schedulerSingleton.ts implements today: get-or-create with in-flight
 * deduplication and acquire counting. Binding constraint: keys are owner
 * objects, never strings; two sessions with the same label string never
 * share an entry.
 */
export interface SessionSchedulerRegistry {
  /**
   * Get-or-create the scheduler for one owner and purpose. Concurrent
   * calls with the same key await the same creation rather than building
   * a duplicate.
   */
  getOrCreate(
    owner: object,
    purpose: SchedulerPurpose,
  ): Promise<SchedulerHandle>;
  /**
   * Release one acquisition of the entry; dispose its scheduler when the
   * count reaches zero. Releasing an unknown key is a no-op.
   */
  release(owner: object, purpose: SchedulerPurpose): void;
  /** Dispose every entry, joining in-flight creations first. */
  disposeAll(): Promise<void>;
}
