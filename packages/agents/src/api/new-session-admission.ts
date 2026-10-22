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
      const blockers: string[] = [];
      if (tasks.getRunningTasks().length > 0)
        blockers.push(
          'running background tasks (let them finish or cancel them)',
        );
      if (shell.getRunningJobs().length > 0)
        blockers.push('running shell jobs (let them finish or cancel them)');
      if (tasks.hasPendingWork())
        blockers.push(
          'task cleanup or completion delivery (wait for it to settle)',
        );
      if (shell.hasLostOwnership())
        blockers.push('shell cleanup failed (restart the CLI)');
      else if (shell.hasPendingWork())
        blockers.push('shell cleanup (wait for owned process groups to drain)');
      if (
        tasks.getPendingNotifications().length > 0 ||
        shell.getPendingNotifications().length > 0
      )
        blockers.push(
          'completion notices (wait for delivery; if delivery failed, resume the session or restart the CLI)',
        );
      if (tools.hasPendingClientWork())
        blockers.push('client tools (finish or cancel pending client work)');
      if (blockers.length > 0) {
        throw new AgentBusyError(
          `Cannot clear while background work is pending: ${blockers.join('; ')}.`,
        );
      }
      await operation();
    });
  };
}
