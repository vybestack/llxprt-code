/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { AsyncTaskManager } from '@vybestack/llxprt-code-core/services/asyncTaskManager.js';
import type { SchedulerConstruction } from '../session/assembleSchedulerOwner.js';
import { TaskLaunchOwner } from '../session/task-launch-owner.js';
import { ShellJobOwner } from '../session/shell-job-owner.js';
import { createChildToolAssembly } from '../session/childToolAssembly.js';
import {
  resolveMaxAsyncTasks,
  resolveShellJobSettings,
} from '@vybestack/llxprt-code-core/config/asyncTaskServices.js';

export function prepareAgentShellOwner(
  settings: SettingsService,
  borrowedTasks: AsyncTaskManager | undefined,
  schedulerFactory: SchedulerConstruction,
): {
  taskLaunchOwner: TaskLaunchOwner;
  shellOwner: ShellJobOwner;
  loopHolder: ReturnType<typeof createChildToolAssembly>;
} {
  const taskLaunchOwner = assembleTaskOwner(settings, borrowedTasks);
  const shellOwner = new ShellJobOwner(() => resolveShellJobSettings(settings));
  return {
    taskLaunchOwner,
    shellOwner,
    loopHolder: createChildToolAssembly(
      schedulerFactory,
      taskLaunchOwner,
      shellOwner,
    ),
  };
}

export async function cleanupFailedShellBootstrap(
  primaryError: unknown,
  taskLaunchOwner: TaskLaunchOwner,
  shellOwner: ShellJobOwner,
): Promise<never> {
  shellOwner.closeAdmission();
  taskLaunchOwner.closeAdmissionAndAbort();
  const cleanup = await Promise.allSettled([
    shellOwner.dispose(),
    taskLaunchOwner.join(),
  ]);
  const failures = cleanup.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (failures.length > 0) {
    throw new AggregateError(
      [primaryError, ...failures],
      'Agent bootstrap cleanup failed',
    );
  }
  throw primaryError;
}

function assembleTaskOwner(
  settings: SettingsService,
  borrowed?: AsyncTaskManager,
): TaskLaunchOwner {
  const readMaxTasks = (): number => resolveMaxAsyncTasks(settings);
  return new TaskLaunchOwner(
    borrowed ?? new AsyncTaskManager(readMaxTasks()),
    readMaxTasks,
  );
}
