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
import type { ShellNotificationSource } from './shellNotificationSource.js';
import {
  AsyncNoticeSubscription,
  type AsyncNoticeUnsubscribe,
} from './async-notice-subscription.js';

/**
 * Debounce window for coalescing rapid shell job completions into a single
 * notification. Multiple jobs finishing within this interval produce exactly
 * one auto-trigger turn, preventing notification storms (#1995 slice 7).
 */
const SHELL_COALESCE_DEBOUNCE_MS = 300;

/**
 * Auto-triggers agent turns when async tasks complete and the agent is idle.
 * Subscribes to task completion/failure events from AsyncTaskManager and
 * (optionally) shell job terminal events from a {@link ShellNotificationSource}.
 *
 * Shell completions are debounced/coalesced so several jobs finishing seconds
 * apart produce a single notification. After any delivery completes, pending
 * notifications are re-checked so events arriving during an in-flight trigger
 * are never stranded.
 * @pseudocode auto-trigger.md
 */
export class AsyncTaskAutoTrigger {
  private isTriggering = false;
  private isAgentBusy: () => boolean;
  private triggerAgentTurn: (message: string) => Promise<void>;
  private shellSource: ShellNotificationSource | undefined;
  private readonly subscriptions = new Set<AsyncNoticeSubscription>();

  constructor(
    private readonly taskManager: Pick<
      AsyncTaskManager,
      'onTaskCompleted' | 'onTaskFailed'
    >,
    private readonly reminderService: AsyncTaskReminderService,
    isAgentBusy: () => boolean,
    triggerAgentTurn: (message: string) => Promise<void>,
  ) {
    this.isAgentBusy = isAgentBusy;
    this.triggerAgentTurn = triggerAgentTurn;
  }

  /**
   * Attach (or replace) the shell job notification source. When set, the
   * auto-trigger subscribes to shell job terminal events and coalesces them
   * with subagent completions (#1995 slice 7).
   */
  setShellNotificationSource(
    source: ShellNotificationSource | undefined,
  ): void {
    this.shellSource = source;
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
   * Shared helper for scheduling an auto-trigger check after task events.
   * Used by both onTaskCompleted and onTaskFailed.
   */
  private scheduleAutoTriggerCheck(): void {
    for (const subscription of this.subscriptions) {
      subscription.schedule();
    }
  }

  /**
   * Called when an async task completes.
   * Schedules an auto-trigger check.
   */
  onTaskCompleted(_task: AsyncTaskInfo): void {
    this.scheduleAutoTriggerCheck();
  }

  /**
   * Called when an async task fails.
   * Schedules an auto-trigger check (same logic as completion).
   */
  onTaskFailed(_task: AsyncTaskInfo): void {
    this.scheduleAutoTriggerCheck();
  }

  /**
   * Called when a shell job reaches a terminal state (completed, failed, or
   * cancelled). Coalesces rapid completions via a debounce timer so multiple
   * jobs finishing seconds apart produce a single notification.
   */
  private onShellTerminal(subscription: AsyncNoticeSubscription): void {
    subscription.debounce(SHELL_COALESCE_DEBOUNCE_MS);
  }

  /**
   * Set up subscriptions to AsyncTaskManager events and (if attached) shell
   * job events. Returns an unsubscribe function.
   */
  subscribe(): AsyncNoticeUnsubscribe {
    const subscription: AsyncNoticeSubscription = new AsyncNoticeSubscription(
      (): Promise<void> => this.maybeAutoTrigger(subscription),
    );
    this.subscriptions.add(subscription);
    const unsubComplete = this.taskManager.onTaskCompleted(() =>
      subscription.schedule(),
    );
    const unsubFailed = this.taskManager.onTaskFailed(() =>
      subscription.schedule(),
    );

    const localUnsubscribeFunctions: Array<() => void> = [
      unsubComplete,
      unsubFailed,
    ];

    if (this.shellSource !== undefined) {
      const unsubJobCompleted = this.shellSource.onJobCompleted(() =>
        this.onShellTerminal(subscription),
      );
      const unsubJobFailed = this.shellSource.onJobFailed(() =>
        this.onShellTerminal(subscription),
      );
      const unsubJobCancelled = this.shellSource.onJobCancelled(() =>
        this.onShellTerminal(subscription),
      );
      localUnsubscribeFunctions.push(
        unsubJobCompleted,
        unsubJobFailed,
        unsubJobCancelled,
      );
    }

    const unsubscribe = (): void => {
      subscription.retire();
      this.subscriptions.delete(subscription);
      for (const unsub of localUnsubscribeFunctions) {
        unsub();
      }
    };
    unsubscribe.drain = (): Promise<void> => subscription.drain();
    return unsubscribe;
  }

  /**
   * Check if auto-trigger should run and execute if so.
   * Serializes triggers: only one in flight at a time. After a successful
   * delivery, pending notifications are re-checked so events that arrived
   * during the in-flight trigger are never stranded (#1995 slice 7).
   * @requirement REQ-ASYNC-010, REQ-ASYNC-011
   */
  private async maybeAutoTrigger(
    subscription: AsyncNoticeSubscription,
  ): Promise<void> {
    if (this.isTriggering) return;

    this.isTriggering = true;
    try {
      while (
        subscription.active &&
        !this.isAgentBusy() &&
        this.reminderService.hasPendingNotifications()
      ) {
        await this.deliverPending();
      }
    } finally {
      this.isTriggering = false;
    }
    if (!subscription.active) {
      this.scheduleAutoTriggerCheck();
    }
  }

  /**
   * Generates the notification, attempts delivery, and marks delivered IDs.
   * Extracted as a helper to keep {@link maybeAutoTrigger} within complexity
   * limits. Throws on delivery failure so the caller can skip marking.
   */
  private async deliverPending(): Promise<void> {
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
  }
}
