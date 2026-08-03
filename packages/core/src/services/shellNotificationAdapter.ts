/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ShellNotificationSource } from './shellNotificationSource.js';
import type { ShellJobManager } from './shellJobManager.js';
import type { ShellJob, ShellJobTailResult } from './shellJobTypes.js';

/**
 * Adapts a {@link ShellJobManager} to the {@link ShellNotificationSource}
 * interface consumed by the reminder/auto-trigger pipeline. The manager's own
 * `markNotified` accepts `string[]`; this adapter bridges the `readonly
 * string[]` from the interface to the manager's mutable array.
 */
export class ShellNotificationAdapter implements ShellNotificationSource {
  constructor(private readonly manager: ShellJobManager) {}

  getPendingNotifications(): readonly ShellJob[] {
    return this.manager.getPendingNotifications();
  }

  getRunningJobs(): readonly ShellJob[] {
    return this.manager.getRunningJobs();
  }

  tailOutput(id: string): ShellJobTailResult {
    return this.manager.tailOutput(id);
  }

  markNotified(ids: readonly string[]): void {
    this.manager.markNotified([...ids]);
  }

  onJobCompleted(handler: (job: ShellJob) => void): () => void {
    return this.manager.onJobCompleted(handler);
  }

  onJobFailed(handler: (job: ShellJob) => void): () => void {
    return this.manager.onJobFailed(handler);
  }

  onJobCancelled(handler: (job: ShellJob) => void): () => void {
    return this.manager.onJobCancelled(handler);
  }
}
