/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { describe, expect, it } from 'bun:test';
import {
  fromConfig,
  createToolScheduler,
  type Agent,
} from '@vybestack/llxprt-code-agents';
import {
  AsyncTaskManager,
  SubagentTerminateMode,
} from '@vybestack/llxprt-code-core';
import {
  buildCliStyleConfig,
  buildFactoryLessConfig,
} from './helpers/buildCliStyleConfig.js';
import { TaskTool } from '../../tools/task.js';

function sessionTaskManager(agent: Agent): AsyncTaskManager {
  const task = agent.getToolRegistry().getTool('task');
  if (!(task instanceof TaskTool)) {
    throw new Error('Session task tool is not registered');
  }
  const manager = task.getSessionTaskManager();
  if (manager === undefined) {
    throw new Error('Session task tool has no task manager');
  }
  return manager;
}

async function waitForCount(
  items: readonly string[],
  count: number,
): Promise<void> {
  for (let attempt = 0; attempt < 20 && items.length < count; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(items).toHaveLength(count);
}

function registerTask(
  manager: AsyncTaskManager,
  id: string,
  controller = new AbortController(),
): AbortController {
  manager.registerTask({
    id,
    subagentName: 'worker',
    goalPrompt: `goal for ${id}`,
    abortController: controller,
  });
  return controller;
}

async function launchBackgroundShell(
  agent: Agent,
  command: string,
): Promise<string> {
  const shell = agent.getToolRegistry().getTool('run_shell_command');
  if (shell === undefined) {
    throw new Error('Shell tool is not registered');
  }
  const result = await shell
    .build({ command, is_background: true })
    .execute(new AbortController().signal);
  const match = /Job ID: (shell_\w+)/.exec(String(result.llmContent));
  if (match === null) {
    throw new Error('Background shell result did not include a job id');
  }
  return match[1];
}

async function shellTail(
  agent: Agent,
  id: string,
  marker: string,
): Promise<string> {
  const tool = agent.getToolRegistry().getTool('check_async_tasks');
  if (tool === undefined) {
    throw new Error('Async status tool is not registered');
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = await tool
      .build({ task_id: id })
      .execute(new AbortController().signal);
    const output = String(result.llmContent);
    if (output.includes(marker)) return output;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Shell output never contained ${marker}`);
}

function longRunningShellCommand(owner: string): string {
  return os.platform() === 'win32'
    ? `Write-Output ${owner}; Start-Sleep -Seconds 60`
    : `printf '${owner}\\n'; sleep 60`;
}

describe('session execution ownership', () => {
  it('uses the same injected scheduler factory for foreground and registered task execution', async () => {
    const built = await buildFactoryLessConfig('plain-text.jsonl');
    let creations = 0;
    const agent = await fromConfig({
      config: built.config,
      messageBus: built.messageBus,
      toolSchedulerFactory: (options) => {
        creations++;
        return createToolScheduler(options);
      },
    });
    try {
      const registeredTool = agent.getToolRegistry().getTool('task');
      if (!(registeredTool instanceof TaskTool)) {
        throw new Error('Task tool is not registered');
      }
      const taskOwner = registeredTool.getSessionSchedulerOwner();
      if (taskOwner === undefined) {
        throw new Error('Task tool has no session scheduler owner');
      }
      const owner = { label: 'same-owner' };
      const callbacks = {
        getPreferredEditor: () => undefined,
        onEditorClose: () => {},
      };
      const dependencies = {
        messageBus: built.messageBus,
        toolRegistry: built.config.getToolRegistry(),
      };
      const foreground = await agent.scheduler.acquire(
        owner,
        'session',
        callbacks,
        undefined,
        dependencies,
      );
      const task = await taskOwner.acquire(
        owner,
        'session',
        callbacks,
        undefined,
        dependencies,
      );
      expect(task).toBe(foreground);
      expect(creations).toBe(1);
      agent.scheduler.release(owner, 'session', foreground);
      agent.scheduler.release(owner, 'session', task);
    } finally {
      await agent.dispose();
      await built.cleanup();
    }
  });

  it('isolates foreground schedulers for agents with the same display label after one is disposed', async () => {
    const first = await buildCliStyleConfig('plain-text.jsonl');
    const second = await buildCliStyleConfig('plain-text.jsonl');
    let agentA: Agent | undefined;
    let agentB: Agent | undefined;
    try {
      agentA = await fromConfig({
        config: first.config,
        messageBus: first.messageBus,
        sessionId: 'same-label',
      });
      agentB = await fromConfig({
        config: second.config,
        messageBus: second.messageBus,
        sessionId: 'same-label',
      });
      const ownerA = { label: 'same-label' };
      const ownerB = { label: 'same-label' };
      const depsA = {
        messageBus: first.messageBus,
        toolRegistry: first.config.getToolRegistry(),
      };
      const depsB = {
        messageBus: second.messageBus,
        toolRegistry: second.config.getToolRegistry(),
      };
      const callbacks = {
        getPreferredEditor: () => undefined,
        onEditorClose: () => {},
      };
      const schedulerA = await agentA.scheduler.acquire(
        ownerA,
        'session',
        callbacks,
        { interactiveMode: true },
        depsA,
      );
      const schedulerB = await agentB.scheduler.acquire(
        ownerB,
        'session',
        callbacks,
        { interactiveMode: true },
        depsB,
      );
      expect(schedulerA).not.toBe(schedulerB);
      agentA.scheduler.release(ownerA, 'session', schedulerA);
      await agentA.dispose();
      await expect(
        agentA.scheduler.acquire(
          ownerA,
          'session',
          callbacks,
          undefined,
          depsA,
        ),
      ).rejects.toThrow('disposed');
      const survivor = await agentB.scheduler.acquire(
        ownerB,
        'session',
        callbacks,
        undefined,
        depsB,
      );
      expect(survivor).toBe(schedulerB);
      agentB.scheduler.release(ownerB, 'session', survivor);
      agentB.scheduler.release(ownerB, 'session', schedulerB);
    } finally {
      try {
        await Promise.all([agentA?.dispose(), agentB?.dispose()]);
      } finally {
        await Promise.all([first.cleanup(), second.cleanup()]);
      }
    }
  });

  it('isolates notifications, cancellation, and live settings across two agents and preserves the surviving subscription', async () => {
    const first = await buildCliStyleConfig('plain-text.jsonl');
    let second: Awaited<ReturnType<typeof buildCliStyleConfig>> | undefined;
    let agentA: Agent | undefined;
    let agentB: Agent | undefined;
    try {
      second = await buildCliStyleConfig('plain-text.jsonl');
      const label = 'shared-display-label';
      agentA = await fromConfig({
        config: first.config,
        messageBus: first.messageBus,
        sessionId: label,
      });
      agentB = await fromConfig({
        config: second.config,
        messageBus: second.messageBus,
        sessionId: label,
      });
      const managerA = sessionTaskManager(agentA);
      const managerB = sessionTaskManager(agentB);
      const notificationsA: string[] = [];
      const notificationsB: string[] = [];
      agentA.tasks.setupAutoTrigger(
        () => false,
        async (message) => {
          notificationsA.push(message);
        },
      );
      agentB.tasks.setupAutoTrigger(
        () => false,
        async (message) => {
          notificationsB.push(message);
        },
      );

      registerTask(managerA, 'complete-a');
      registerTask(managerB, 'complete-b');
      managerA.completeTask('complete-a', {
        emitted_vars: { owner: 'A' },
        terminate_reason: SubagentTerminateMode.GOAL,
      });
      managerB.completeTask('complete-b', {
        emitted_vars: { owner: 'B' },
        terminate_reason: SubagentTerminateMode.GOAL,
      });
      await Promise.all([
        waitForCount(notificationsA, 1),
        waitForCount(notificationsB, 1),
      ]);
      expect(notificationsA[0]).toContain('complete-a');
      expect(notificationsA[0]).not.toContain('complete-b');
      expect(notificationsB[0]).toContain('complete-b');
      expect(notificationsB[0]).not.toContain('complete-a');

      first.config.setEphemeralSetting('task-max-async', 1);
      second.config.setEphemeralSetting('task-max-async', 3);
      expect(managerA.getMaxAsyncTasks()).toBe(1);
      expect(managerB.getMaxAsyncTasks()).toBe(3);

      const abortA = registerTask(managerA, 'cancel-a');
      const abortB = registerTask(managerB, 'cancel-b');
      expect(await agentA.tasks.cancel('cancel-a')).toBe(true);
      expect(abortA.signal.aborted).toBe(true);
      expect(abortB.signal.aborted).toBe(false);
      expect(managerB.getTask('cancel-b')?.status).toBe('running');

      await agentA.dispose();
      first.config.setEphemeralSetting('adopted-config-probe', 'usable');
      expect(first.config.getEphemeralSetting('adopted-config-probe')).toBe(
        'usable',
      );
      second.config.setEphemeralSetting('task-max-async', 4);
      expect(managerA.canLaunchAsync().allowed).toBe(false);
      expect(managerB.getMaxAsyncTasks()).toBe(4);

      managerB.cancelTask('cancel-b');
      registerTask(managerB, 'after-a-disposal');
      managerB.completeTask('after-a-disposal', {
        emitted_vars: { survivor: 'true' },
        terminate_reason: SubagentTerminateMode.GOAL,
      });
      await waitForCount(notificationsB, 2);
      expect(notificationsB[1]).toContain('after-a-disposal');
      expect(notificationsA).toHaveLength(1);
    } finally {
      try {
        await Promise.all([agentA?.dispose(), agentB?.dispose()]);
      } finally {
        await Promise.all([second?.cleanup(), first.cleanup()]);
      }
    }
  });

  it('isolates shell launch, tail, cancellation, and disposal for agents with the same label', async () => {
    const first = await buildCliStyleConfig('plain-text.jsonl');
    const second = await buildCliStyleConfig('plain-text.jsonl');
    let agentA: Agent | undefined;
    let agentB: Agent | undefined;
    try {
      agentA = await fromConfig({
        config: first.config,
        messageBus: first.messageBus,
        sessionId: 'shared-shell-label',
      });
      agentB = await fromConfig({
        config: second.config,
        messageBus: second.messageBus,
        sessionId: 'shared-shell-label',
      });

      first.config.setEphemeralSetting('shell-max-background-jobs', 1);
      second.config.setEphemeralSetting('shell-max-background-jobs', 2);
      const commandA = longRunningShellCommand('owner-a');
      const commandB = longRunningShellCommand('owner-b');
      const jobA = await launchBackgroundShell(agentA, commandA);
      const jobB = await launchBackgroundShell(agentB, commandB);
      const extraB = await launchBackgroundShell(
        agentB,
        longRunningShellCommand('owner-b-extra'),
      );
      await expect(
        launchBackgroundShell(
          agentA,
          longRunningShellCommand('owner-a-over-budget'),
        ),
      ).rejects.toThrow('Background job budget exhausted (max 1)');

      expect(agentA.tasks.get(jobA)).toMatchObject({
        kind: 'shell',
        command: commandA,
        status: 'running',
      });
      expect(agentA.tasks.get(jobB)).toBeUndefined();
      expect(agentB.tasks.get(jobB)).toMatchObject({
        kind: 'shell',
        command: commandB,
        status: 'running',
      });
      expect(agentB.tasks.get(jobA)).toBeUndefined();

      const tailA = await shellTail(agentA, jobA, 'owner-a');
      const tailB = await shellTail(agentB, jobB, 'owner-b');
      expect(tailA).not.toContain('owner-b');
      expect(tailB).not.toContain('owner-a');

      expect(await agentA.tasks.cancel(jobA)).toBe(true);
      expect(agentA.tasks.get(jobA)?.status).toBe('cancelled');
      expect(agentB.tasks.get(jobB)?.status).toBe('running');

      const replacementA = await launchBackgroundShell(
        agentA,
        longRunningShellCommand('owner-a-dispose'),
      );
      await agentA.dispose();
      expect(agentA.tasks.get(replacementA)).toBeUndefined();
      expect(agentB.tasks.get(jobB)?.status).toBe('running');
      expect(await agentB.tasks.cancel(extraB)).toBe(true);

      first.config.setEphemeralSetting('adopted-shell-config-probe', 'usable');
      expect(
        first.config.getEphemeralSetting('adopted-shell-config-probe'),
      ).toBe('usable');

      const survivor = await launchBackgroundShell(
        agentB,
        longRunningShellCommand('owner-b-survivor'),
      );
      expect(agentB.tasks.get(survivor)?.status).toBe('running');
      expect(await agentB.tasks.cancel(jobB)).toBe(true);
      expect(await agentB.tasks.cancel(survivor)).toBe(true);
    } finally {
      try {
        await Promise.all([agentA?.dispose(), agentB?.dispose()]);
      } finally {
        await Promise.all([first.cleanup(), second.cleanup()]);
      }
    }
  }, 30000);

  it('keeps an adopted Config usable for a fresh task runtime and turn after disposal', async () => {
    const built = await buildCliStyleConfig('multi-turn-text.jsonl');
    let first: Agent | undefined;
    let second: Agent | undefined;
    try {
      first = await fromConfig({
        config: built.config,
        messageBus: built.messageBus,
        sessionId: `first-${randomUUID()}`,
      });
      const firstManager = sessionTaskManager(first);
      registerTask(firstManager, 'first-task');
      const firstJob = await launchBackgroundShell(
        first,
        longRunningShellCommand('first-generation'),
      );
      await first.dispose();
      expect(firstManager.canLaunchAsync().allowed).toBe(false);
      expect(first.tasks.get(firstJob)).toBeUndefined();

      second = await fromConfig({
        config: built.config,
        messageBus: built.messageBus,
        sessionId: `second-${randomUUID()}`,
      });
      const secondManager = sessionTaskManager(second);
      expect(secondManager).not.toBe(firstManager);
      const secondJob = await launchBackgroundShell(
        second,
        longRunningShellCommand('second-generation'),
      );
      expect(second.tasks.get(firstJob)).toBeUndefined();
      expect(
        await shellTail(second, secondJob, 'second-generation'),
      ).not.toContain('first-generation');
      expect(await second.tasks.cancel(secondJob)).toBe(true);
      const notifications: string[] = [];
      second.tasks.setupAutoTrigger(
        () => false,
        async (message) => {
          notifications.push(message);
        },
      );
      registerTask(secondManager, 'second-task');
      secondManager.completeTask('second-task', {
        emitted_vars: { generation: '2' },
        terminate_reason: SubagentTerminateMode.GOAL,
      });
      await waitForCount(notifications, 1);
      const result = await second.chat('hello');
      expect(result.error).toBeUndefined();
      expect(result.text).toContain('turn one reply');
    } finally {
      try {
        await Promise.all([first?.dispose(), second?.dispose()]);
      } finally {
        await built.cleanup();
      }
    }
  });
});

describe('registered task tool ownership', () => {
  it('uses the exact session manager exposed through Agent.tasks', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    let agent: Agent | undefined;
    try {
      built.config.getSettingsService().set('task-max-async', 1);
      agent = await fromConfig({
        config: built.config,
        messageBus: built.messageBus,
        sessionId: `task-owner-${randomUUID()}`,
      });
      const manager = sessionTaskManager(agent);
      registerTask(manager, 'owned-slot');
      expect(agent.tasks.listRunning().map((entry) => entry.id)).toStrictEqual([
        'owned-slot',
      ]);
      const task = agent.getToolRegistry().getTool('task');
      expect(task).toBeDefined();
      const result = await task!
        .build({
          subagent_name: 'missing-worker',
          goal_prompt: 'Try another session-owned launch',
          async: true,
        })
        .execute(new AbortController().signal);
      expect(result.llmContent).toContain('Max async tasks (1) reached');
    } finally {
      await agent?.dispose();
      await built.cleanup();
    }
  });
});
