/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import {
  resolveMaxAsyncTasks,
  resolveShellJobSettings,
} from '@vybestack/llxprt-code-core/config/asyncTaskServices.js';
import { AsyncTaskManager } from '@vybestack/llxprt-code-core/services/asyncTaskManager.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { AgentBusyError } from '../loop/agentBusyError.js';
import { AgentExecutionCoordinator } from '../agentExecutionCoordinator.js';
import { createNewSessionAdmission } from '../new-session-admission.js';
import { TaskLaunchOwner } from '../../session/task-launch-owner.js';
import { ShellJobOwner } from '../../session/shell-job-owner.js';
import { deferred } from './helpers/shell-owner-gate.js';

/**
 * The owners and the admission gate are built the way the foreground assembly
 * builds them (see `new-session-admission.owners.behavior.test.ts`). The
 * switch operation passed to the gate waits on a barrier, which is the window
 * a paused recording retirement opens in a real `startNewSession`.
 */
describe('new-session admission while a switch is in progress', () => {
  it('rejects task and shell starts until the switch completes', async () => {
    const settings = new SettingsService();
    const readMaxTasks = (): number => resolveMaxAsyncTasks(settings);
    const tasks = new TaskLaunchOwner(
      new AsyncTaskManager(readMaxTasks()),
      readMaxTasks,
    );
    const shell = new ShellJobOwner(() => resolveShellJobSettings(settings));
    const coordinator = new AgentExecutionCoordinator();
    const assertSessionAdmission = (): void => coordinator.assertNoCommit();
    tasks.bindSessionAdmission(assertSessionAdmission);
    shell.bindSessionAdmission(assertSessionAdmission);
    const admit = createNewSessionAdmission(
      tasks,
      shell,
      coordinator,
      { hasPendingClientWork: () => false },
      () => {},
    );
    const entered = deferred<void>();
    const release = deferred<void>();
    const switching = admit(async () => {
      entered.resolve();
      await release.promise;
    });
    try {
      await entered.promise;
      expect(() => tasks.start(async () => {})).toThrow(AgentBusyError);
      expect(() =>
        shell.launch({ command: 'printf forbidden', cwd: process.cwd() }),
      ).toThrow(AgentBusyError);
    } finally {
      release.resolve();
      await switching;
      shell.closeAdmission();
      tasks.closeAdmissionAndAbort();
      await Promise.allSettled([shell.dispose(), tasks.join()]);
    }
  });
});
