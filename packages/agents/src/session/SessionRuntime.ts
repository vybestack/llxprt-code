/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260808-ISSUE2615
 *
 * Session-owned runtime that constructs, owns, and disposes the
 * ShellJobManager. Construction moved here from Config; Config now borrows the
 * already-built manager via CoreSessionServices and never retains it.
 */

import {
  ShellJobManager,
  resolveShellJobSettings,
  type CoreSessionServices,
  type ShellAdmissionSettingsReactor,
} from '@vybestack/llxprt-code-core';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';

/**
 * Owns the session-scoped ShellJobManager lifecycle.
 *
 * Construction happens BEFORE Config.initialize so Config can borrow the
 * already-built manager during tool assembly. The runtime registers a
 * {@link ShellAdmissionSettingsReactor} with Config so writes to
 * `shell-max-background-jobs` propagate synchronously. The reactor is detached
 * BEFORE disposal so a caller-owned Config cannot retain a dead runtime.
 *
 * @plan PLAN-20260808-ISSUE2615
 */
export class SessionRuntime implements ShellAdmissionSettingsReactor {
  readonly shellJobManager: ShellJobManager;
  private detachReactor: (() => void) | undefined;
  private disposed = false;

  /**
   * Constructs the ShellJobManager from the EXACT session-scoped
   * SettingsService. A pre-initialization write to
   * `shell-max-background-jobs` therefore determines the initial limit.
   */
  constructor(settingsService: SettingsService) {
    const { maxBackgroundJobs, logMaxBytes } =
      resolveShellJobSettings(settingsService);
    this.shellJobManager = new ShellJobManager({
      maxBackgroundJobs,
      logMaxBytes,
    });
  }

  applyMaxBackgroundJobs(limit: number): void {
    this.shellJobManager.setMaxBackgroundJobs(limit);
  }

  /**
   * Registers the shell-admission reactor with Config so settings writes
   * propagate synchronously. Returns nothing; call {@link dispose} to detach.
   */
  attachToConfig(config: Config): void {
    this.detachReactor = config.registerShellAdmissionReactor(this);
  }

  /**
   * The borrowed contract Config consumes during initialize/performInitialization.
   */
  get coreSessionServices(): CoreSessionServices {
    return { shellJobManager: this.shellJobManager };
  }

  /**
   * Disposes the ShellJobManager (terminating real running processes) and
   * detaches the reactor from Config. Idempotent. A disposal failure is thrown
   * so the caller (AgentImpl.dispose) can aggregate it with other teardown
   * errors.
   */
  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.detachReactor?.();
    this.detachReactor = undefined;
    await this.shellJobManager.dispose();
  }
}
