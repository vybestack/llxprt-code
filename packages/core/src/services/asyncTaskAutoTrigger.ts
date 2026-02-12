/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260130-ASYNCTASK.P18
 * @plan PLAN-20260130-ASYNCTASK.P20
 * @requirement REQ-ASYNC-010, REQ-ASYNC-011
 */

import type { AsyncTaskManager, AsyncTaskInfo } from './asyncTaskManager.js';
import type { AsyncTaskReminderService } from './asyncTaskReminderService.js';

/**
 * Auto-triggers agent turns when async tasks complete and the agent is idle.
 * Subscribes to task completion/failure events from AsyncTaskManager.
 * @pseudocode auto-trigger.md
 */
export class AsyncTaskAutoTrigger {
  private isTriggering = false;
  private isAgentBusy: () => boolean;
  private triggerAgentTurn: (message: string) => Promise<void>;

  constructor(
    private readonly taskManager: AsyncTaskManager,
    private readonly reminderService: AsyncTaskReminderService,
    isAgentBusy: () => boolean,
    triggerAgentTurn: (message: string) => Promise<void>,
  ) {
    this.isAgentBusy = isAgentBusy;
    this.triggerAgentTurn = triggerAgentTurn;
  }

  /**
   * Replace the callbacks with fresh closures (called on React re-renders).
   */
  updateCallbacks(
    isAgentBusy: () => boolean,
    triggerAgentTurn: (message: string) => Promise<void>,
  ): void {
    this.isAgentBusy = isAgentBusy;
    this.triggerAgentTurn = triggerAgentTurn;
  }

  /**
   * Called when an async task completes.
   * Schedules an auto-trigger check.
   */
  onTaskCompleted(_task: AsyncTaskInfo): void {
    // Schedule check (don't block the event handler)
    setImmediate(() => this.maybeAutoTrigger());
  }

  /**
   * Called when an async task fails.
   * Schedules an auto-trigger check (same logic as completion).
   */
  onTaskFailed(_task: AsyncTaskInfo): void {
    // Same logic as completion
    setImmediate(() => this.maybeAutoTrigger());
  }

  /**
   * Set up subscriptions to AsyncTaskManager events.
   * Returns an unsubscribe function.
   */
  subscribe(): () => void {
    const unsubComplete = this.taskManager.onTaskCompleted((task) =>
      this.onTaskCompleted(task),
    );
    const unsubFailed = this.taskManager.onTaskFailed((task) =>
      this.onTaskFailed(task),
    );

    const localUnsubscribeFunctions = [unsubComplete, unsubFailed];

    return () => {
      for (const unsub of localUnsubscribeFunctions) {
        unsub();
      }
    };
  }

  /**
   * Check if auto-trigger should run and execute if so.
   * Serializes triggers: only one in flight at a time.
   * @requirement REQ-ASYNC-010, REQ-ASYNC-011
   */
  private async maybeAutoTrigger(): Promise<void> {
    // Serialize: only one trigger in flight
    if (this.isTriggering) {
      return;
    }

    // Check if agent is busy
    if (this.isAgentBusy()) {
      // Will be picked up by next-turn reminder instead
      return;
    }

    // Check if there are pending notifications
    if (!this.reminderService.hasPendingNotifications()) {
      return;
    }

    this.isTriggering = true;

    try {
      // Generate the notification message — captures the exact task IDs
      // included so we only mark those as notified (not tasks that complete
      // between now and delivery).
      const result = this.reminderService.generateReminder();

      if (!result) {
        // Nothing to notify (race condition - already delivered)
        return;
      }

      // Attempt delivery
      await this.triggerAgentTurn(result.text);

      // SUCCESS: Mark only the tasks whose content was delivered
      // @requirement REQ-ASYNC-011
      this.reminderService.markNotified(result.notifiedTaskIds);
    } catch (error) {
      // FAILURE: Do NOT mark as notified
      // @requirement REQ-ASYNC-011
      // The notification will be included in the next turn's reminder
      console.error('[AsyncTaskAutoTrigger] Failed to auto-trigger:', error);
    } finally {
      this.isTriggering = false;
    }
  }
}
