/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { TaskLaunchOwner } from '../session/task-launch-owner.js';
import type { ShellJobOwner } from '../session/shell-job-owner.js';
import type { AgentExecutionCoordinator } from './agentExecutionCoordinator.js';
import type { ToolControl } from './control/toolControl.js';
import { AgentBusyError } from './loop/agentBusyError.js';

export function createNewSessionAdmission(
  tasks: TaskLaunchOwner,
  shell: ShellJobOwner,
  coordinator: AgentExecutionCoordinator,
  tools: Pick<ToolControl, 'hasPendingClientWork'>,
  assertProfileIdle: () => void,
): (operation: () => Promise<void>) => Promise<void> {
  return async (operation) => {
    assertProfileIdle();
    await coordinator.withIdleBoundary(async () => {
      const pending = [
        tasks.hasPendingWork(),
        tasks.getRunningTasks().length > 0,
        tasks.getPendingNotifications().length > 0,
        shell.getRunningJobs().length > 0,
        shell.getPendingNotifications().length > 0,
        tools.hasPendingClientWork(),
      ];
      if (pending.some(Boolean)) {
        throw new AgentBusyError(
          'Cannot clear while background tasks, shell jobs, client tools or completion notices are pending. Let them finish or cancel them first.',
        );
      }
      await operation();
    });
  };
}
