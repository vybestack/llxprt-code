/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ToolResult } from '@vybestack/llxprt-code-tools';
import { AsyncTaskAutoTrigger } from '@vybestack/llxprt-code-core/services/asyncTaskAutoTrigger.js';
import { AsyncTaskReminderService } from '@vybestack/llxprt-code-core/services/asyncTaskReminderService.js';
import type { AsyncNoticeUnsubscribe } from '@vybestack/llxprt-code-core/services/async-notice-subscription.js';
import { ShellNotificationAdapter } from '@vybestack/llxprt-code-core/services/shellNotificationAdapter.js';
import { ShellJobManager } from '@vybestack/llxprt-code-core/services/shellJobManager.js';
import type { ShellNotificationSource } from '@vybestack/llxprt-code-core/services/shellNotificationSource.js';
import type {
  AsyncTaskManager,
  AsyncTaskInfo,
} from '@vybestack/llxprt-code-core/services/asyncTaskManager.js';

export interface TaskLaunch {
  readonly controller: AbortController;
  register(id: string): void;
}

export class TaskLaunchOwner {
  private closed = false;
  private readonly launches = new Map<TaskLaunch, Promise<void>>();
  private readonly ids = new Set<string>();
  private readonly failures: unknown[] = [];

  private readonly notices = new Set<AsyncNoticeUnsubscribe>();
  private readonly noticeDrains = new Set<Promise<void>>();
  private trigger?: AsyncTaskAutoTrigger;

  constructor(
    readonly manager: AsyncTaskManager,
    private readonly readMaxTasks?: () => number,
  ) {}

  subscribeNotifications(
    isBusy: () => boolean,
    deliver: (message: string) => Promise<void>,
    shellManager?: ShellJobManager | ShellNotificationSource,
  ): AsyncNoticeUnsubscribe {
    if (this.closed) throw new Error('Agent task admission is closed');
    if (!this.trigger) {
      const reminder = new AsyncTaskReminderService(this);
      const source =
        shellManager instanceof ShellJobManager
          ? new ShellNotificationAdapter(shellManager)
          : shellManager;
      reminder.setShellNotificationSource(source);
      this.trigger = new AsyncTaskAutoTrigger(this, reminder, isBusy, deliver);
      this.trigger.setShellNotificationSource(source);
    }
    this.trigger.updateCallbacks(isBusy, deliver);
    const subscription = this.trigger.subscribe();
    let draining: Promise<void> | undefined;
    const retire = (): void => {
      if (draining) return;
      subscription();
      this.notices.delete(retire);
      draining = subscription.drain();
      this.noticeDrains.add(draining);
      void draining.then(
        () => this.noticeDrains.delete(draining!),
        (error: unknown) => {
          this.failures.push(error);
          this.noticeDrains.delete(draining!);
        },
      );
    };
    retire.drain = (): Promise<void> => draining ?? subscription.drain();
    this.notices.add(retire);
    return retire;
  }

  getPendingNotifications(): AsyncTaskInfo[] {
    return this.manager
      .getPendingNotifications()
      .filter((task) => this.ids.has(task.id));
  }

  markNotified(id: string): void {
    if (this.ids.has(id)) this.manager.markNotified(id);
  }

  onTaskCompleted(listener: (task: AsyncTaskInfo) => void): () => void {
    return this.manager.onTaskCompleted((task) => {
      if (this.ids.has(task.id)) listener(task);
    });
  }

  onTaskFailed(listener: (task: AsyncTaskInfo) => void): () => void {
    return this.manager.onTaskFailed((task) => {
      if (this.ids.has(task.id)) listener(task);
    });
  }

  start(
    body: (
      launch: TaskLaunch,
      publish: (result: ToolResult) => void,
    ) => Promise<void>,
  ): Promise<ToolResult> {
    if (this.closed)
      return Promise.reject(new Error('Agent task admission is closed'));
    if (this.readMaxTasks) this.manager.setMaxAsyncTasks(this.readMaxTasks());
    let publish!: (result: ToolResult) => void;
    let rejectResult!: (error: unknown) => void;
    const result = new Promise<ToolResult>((resolve, reject) => {
      publish = resolve;
      rejectResult = reject;
    });
    const launch: TaskLaunch = {
      controller: new AbortController(),
      register: (id): void => {
        this.ids.add(id);
      },
    };
    const completion = Promise.resolve().then(() => {
      launch.controller.signal.throwIfAborted();
      return body(launch, publish);
    });
    this.launches.set(launch, completion);
    void completion.then(
      () => {
        this.launches.delete(launch);
      },
      (error: unknown) => {
        this.launches.delete(launch);
        if (error !== launch.controller.signal.reason)
          this.failures.push(error);
        rejectResult(error);
      },
    );
    return result;
  }

  closeAdmissionAndAbort(): void {
    this.closed = true;
    for (const retire of this.notices) {
      try {
        retire();
      } catch (error) {
        this.failures.push(error);
      }
    }
    for (const launch of this.launches.keys()) {
      try {
        launch.controller.abort(new Error('Agent disposed'));
      } catch (error) {
        this.failures.push(error);
      }
    }
    for (const task of this.getRunningTasks()) {
      try {
        this.manager.cancelTask(task.id);
      } catch (error) {
        this.failures.push(error);
      }
    }
  }

  hasPendingWork(): boolean {
    return this.launches.size > 0 || this.noticeDrains.size > 0;
  }

  async join(): Promise<void> {
    await Promise.allSettled([...this.launches.values(), ...this.noticeDrains]);
    if (this.failures.length > 0)
      throw new AggregateError(
        [...this.failures],
        'Task launch cleanup failed',
      );
  }

  getAllTasks(): AsyncTaskInfo[] {
    return this.manager.getAllTasks().filter((task) => this.ids.has(task.id));
  }

  getRunningTasks(): AsyncTaskInfo[] {
    return this.getAllTasks().filter((task) => task.status === 'running');
  }

  getTask(id: string): AsyncTaskInfo | undefined {
    return this.ids.has(id) ? this.manager.getTask(id) : undefined;
  }

  getTaskByPrefix(
    prefix: string,
  ): ReturnType<AsyncTaskManager['getTaskByPrefix']> {
    const result = this.manager.getTaskByPrefix(prefix);
    const candidates = (
      result.task ? [result.task] : (result.candidates ?? [])
    ).filter((task) => this.ids.has(task.id));
    return candidates.length === 1 ? { task: candidates[0] } : { candidates };
  }

  cancelTask(id: string): boolean {
    return this.ids.has(id) && this.manager.cancelTask(id);
  }
}
