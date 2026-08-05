/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ShellJob, ShellJobTailResult } from './shellJobTypes.js';

/**
 * Abstraction over the source of shell job events and state for the
 * notification pipeline. The reminder service and auto-trigger consume this
 * instead of a concrete ShellJobManager, so they stay decoupled from the
 * manager lifecycle while gaining shell job visibility (#1995 slice 7).
 *
 * The AsyncWorkFacade (or any equivalent adapter) implements this interface.
 */
export interface ShellNotificationSource {
  /** Terminal, unnotified shell jobs that should be surfaced. */
  getPendingNotifications(): readonly ShellJob[];
  /** Running shell jobs, for the status summary count. */
  getRunningJobs(): readonly ShellJob[];
  /** Read a bounded output tail by job id. */
  tailOutput(id: string): ShellJobTailResult;
  /** Mark the given job ids as notified. */
  markNotified(ids: readonly string[]): void;
  /** Subscribe to a terminal completion event. Returns unsubscribe. */
  onJobCompleted(handler: (job: ShellJob) => void): () => void;
  /** Subscribe to a terminal failure event. Returns unsubscribe. */
  onJobFailed(handler: (job: ShellJob) => void): () => void;
  /** Subscribe to a terminal cancellation event. Returns unsubscribe. */
  onJobCancelled(handler: (job: ShellJob) => void): () => void;
}
