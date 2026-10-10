/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ShellJobManager } from '@vybestack/llxprt-code-core/services/shellJobManager.js';
import type { ShellNotificationSource } from '@vybestack/llxprt-code-core/services/shellNotificationSource.js';
import type { ShellJob } from '@vybestack/llxprt-code-core/services/shellJobTypes.js';

type JobEvent = 'onJobCompleted' | 'onJobFailed' | 'onJobCancelled';
type JobHandler = (job: ShellJob) => void;

export class ShellJobOwner implements ShellNotificationSource {
  private manager?: ShellJobManager;
  private closed = false;
  private exitListenerInstalled = false;
  private disposal?: Promise<void>;
  private readonly subscribers = new Map<
    JobEvent,
    Map<JobHandler, () => void>
  >();
  private readonly beforeExit = (): void => {
    const keepAlive = setInterval(() => {}, 1000);
    void this.dispose()
      .catch((error: unknown) => {
        process.stderr.write(`Shell owner shutdown failed: ${error}
`);
        if (process.exitCode === undefined || process.exitCode === 0) {
          process.exitCode = 1;
        }
      })
      .finally(() => clearInterval(keepAlive));
  };

  constructor(
    private readonly readSettings: () => {
      maxBackgroundJobs: number;
      logMaxBytes: number;
    },
  ) {}

  current(): ShellJobManager | undefined {
    return this.manager;
  }

  launch(
    input: Parameters<ShellJobManager['launch']>[0],
  ): ReturnType<ShellJobManager['launch']> {
    if (this.closed) throw new Error('Agent shell job admission is closed');
    const settings = this.readSettings();
    if (!this.manager) {
      this.manager = new ShellJobManager(settings);
      for (const [event, handlers] of this.subscribers) {
        for (const handler of handlers.keys()) {
          handlers.set(handler, this.manager[event](handler));
        }
      }
    }
    this.manager.setMaxBackgroundJobs(settings.maxBackgroundJobs);
    const job = this.manager.launch(input);
    if (!this.exitListenerInstalled) {
      process.on('beforeExit', this.beforeExit);
      this.exitListenerInstalled = true;
    }
    return job;
  }

  getPendingNotifications(): readonly ShellJob[] {
    return this.manager?.getPendingNotifications() ?? [];
  }

  getRunningJobs(): readonly ShellJob[] {
    return this.manager?.getRunningJobs() ?? [];
  }

  tailOutput(id: string): ReturnType<ShellJobManager['tailOutput']> {
    return this.manager?.tailOutput(id) ?? { id, output: '', truncated: false };
  }

  markNotified(ids: readonly string[]): void {
    this.manager?.markNotified([...ids]);
  }

  onJobCompleted(handler: JobHandler): () => void {
    return this.subscribe('onJobCompleted', handler);
  }

  onJobFailed(handler: JobHandler): () => void {
    return this.subscribe('onJobFailed', handler);
  }

  onJobCancelled(handler: JobHandler): () => void {
    return this.subscribe('onJobCancelled', handler);
  }

  private subscribe(event: JobEvent, handler: JobHandler): () => void {
    let handlers = this.subscribers.get(event);
    if (!handlers) {
      handlers = new Map();
      this.subscribers.set(event, handlers);
    }
    handlers.set(handler, this.manager?.[event](handler) ?? (() => {}));
    return () => {
      handlers.get(handler)?.();
      handlers.delete(handler);
      if (handlers.size === 0) this.subscribers.delete(event);
    };
  }

  closeAdmission(): void {
    this.closed = true;
  }

  dispose(): Promise<void> {
    this.closeAdmission();
    this.disposal ??= (this.manager?.dispose() ?? Promise.resolve()).finally(
      () => {
        if (this.exitListenerInstalled) {
          process.off('beforeExit', this.beforeExit);
          this.exitListenerInstalled = false;
        }
      },
    );
    return this.disposal;
  }
}
