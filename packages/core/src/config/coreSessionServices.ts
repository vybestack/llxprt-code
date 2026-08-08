/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ShellJobManager } from '../services/shellJobManager.js';

/**
 * Narrow BORROWED contract carrying already-built session services that
 * {@link Config.initialize} consumes while assembling tools. The caller
 * (agents-layer SessionRuntime) constructs these services and LENDS them in;
 * Config never receives a factory to invoke and never retains them beyond
 * tool assembly.
 *
 * @plan PLAN-20260808-ISSUE2615
 */
export interface CoreSessionServices {
  /**
   * The session-owned ShellJobManager, constructed from the exact
   * session-scoped SettingsService. Config threads it straight into tool
   * assembly (CoreShellToolHostAdapter, AsyncWorkFacade) and does NOT store
   * it in a field.
   */
  readonly shellJobManager: ShellJobManager;
}

/**
 * Explicit ordered mandatory port for shell-admission settings reactions.
 *
 * The SessionRuntime constructs this reactor wrapping its ShellJobManager and
 * registers it with Config for the runtime's lifetime. When
 * `shell-max-background-jobs` is written, Config calls every registered
 * reactor's {@link applyMaxBackgroundJobs} BEFORE the write returns so
 * admission changes synchronously.
 *
 * This is NOT an EventEmitter: a throwing reactor is caught and aggregated so
 * it cannot starve later reactors.
 *
 * @plan PLAN-20260808-ISSUE2615
 */
export interface ShellAdmissionSettingsReactor {
  applyMaxBackgroundJobs(limit: number): void;
}
