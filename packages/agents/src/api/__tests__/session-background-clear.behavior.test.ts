/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { setImmediate, setTimeout as delay } from 'node:timers/promises';
import { ApprovalMode } from '@vybestack/llxprt-code-core';
import { AgentBusyError } from '../loop/agentBusyError.js';
import { SubagentTerminateMode } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { TaskLaunchOwner } from '../../session/task-launch-owner.js';
import { ShellJobOwner } from '../../session/shell-job-owner.js';
import { type Agent, buildAgent } from './helpers/agentHarness.js';
import { deferred, deadline } from './helpers/shell-owner-gate.js';
import { collectAgentHistory } from './helpers/collect-agent-history.js';

async function awaitShellCleanup(shell: ShellJobOwner): Promise<void> {
  await deadline(
    (async () => {
      while (shell.hasPendingWork()) await delay(10);
    })(),
    'shell resource release',
  );
}

function owners(agent: Agent): {
  tasks: TaskLaunchOwner;
  shell: ShellJobOwner;
} {
  if (
    !('deps' in agent) ||
    typeof agent.deps !== 'object' ||
    agent.deps === null
  )
    throw new Error('Expected agent dependencies');
  if (
    !('taskLaunchOwner' in agent.deps) ||
    !(agent.deps.taskLaunchOwner instanceof TaskLaunchOwner)
  )
    throw new Error('Expected task owner');
  if (
    !('shellOwner' in agent.deps) ||
    !(agent.deps.shellOwner instanceof ShellJobOwner)
  )
    throw new Error('Expected shell owner');
  return { tasks: agent.deps.taskLaunchOwner, shell: agent.deps.shellOwner };
}

describe('new sessions exclude background work', () => {
  for (const state of ['completed', 'failed']) {
    it(`recovers a busy-time ${state} notice and admits clear after delivery`, async () => {
      const { agent, cleanup } = await buildAgent('plain-text.jsonl');
      const { tasks } = owners(agent);
      const messages: string[] = [];
      const first = agent.tasks.subscribeNotifications(
        () => true,
        async (text) => {
          messages.push(text);
        },
      );
      let current = first;
      try {
        await tasks.start(async (launch, publish) => {
          tasks.manager.registerTask({
            id: 'busy-task',
            subagentName: 'worker',
            goalPrompt: 'work',
            abortController: launch.controller,
          });
          launch.register('busy-task');
          publish({ llmContent: '', returnDisplay: '' });
        });
        if (state === 'completed')
          tasks.manager.completeTask('busy-task', {
            terminate_reason: SubagentTerminateMode.GOAL,
            emitted_vars: { result: 'done' },
          });
        else tasks.manager.failTask('busy-task', 'failed work');
        await setImmediate();
        await expect(agent.session.startNewSession()).rejects.toThrow(
          /^(?!.*cancel).*completion notices/,
        );
        first();
        const delivered = deferred<void>();
        current = agent.tasks.subscribeNotifications(
          () => false,
          async (text) => {
            messages.push(text);
            delivered.resolve();
          },
        );
        await deadline(delivered.promise, 'idle notice recovery');
        await current.drain();
        await agent.session.startNewSession();
        expect(messages).toHaveLength(1);
        expect(tasks.getPendingNotifications()).toHaveLength(0);
        expect(await agent.session.getHistory()).toStrictEqual([]);
      } finally {
        current();
        await current.drain();
        await cleanup();
      }
    });
  }

  it('keeps cancelled task cleanup owned even when its history is evicted', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    const { tasks } = owners(agent);
    const release = deferred<void>();
    try {
      await tasks.start(async (launch, publish) => {
        tasks.manager.registerTask({
          id: 'disposing-child',
          subagentName: 'worker',
          goalPrompt: 'work',
          abortController: launch.controller,
        });
        launch.register('disposing-child');
        publish({ llmContent: '', returnDisplay: '' });
        await release.promise;
      });
      tasks.manager.setMaxAsyncTasks(1);
      tasks.cancelTask('disposing-child');
      for (let i = 0; i < 4; i++) {
        tasks.manager.registerTask({
          id: `history-${i}`,
          subagentName: 'worker',
          goalPrompt: 'work',
          abortController: new AbortController(),
        });
        tasks.manager.cancelTask(`history-${i}`);
      }
      expect(tasks.getTask('disposing-child')).toBeUndefined();
      await expect(agent.session.startNewSession()).rejects.toThrow('cleanup');
      release.resolve();
      await tasks.join();
      await agent.session.startNewSession();
      expect(await agent.session.getHistory()).toStrictEqual([]);
    } finally {
      release.resolve();
      await cleanup();
    }
  });

  it('blocks on acknowledged terminal shell groups until OS resources are released', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    const { shell } = owners(agent);
    const terminal = deferred<void>();
    const off = shell.onJobCompleted(() => terminal.resolve());
    try {
      const job = shell.launch({
        command: 'printf draining-shell',
        cwd: process.cwd(),
      });
      await deadline(terminal.promise, 'terminal shell record');
      if (job.pid === undefined)
        throw new Error('Expected owned shell group pid');
      shell.markNotified([job.id]);
      expect(shell.getRunningJobs()).toHaveLength(0);
      expect(shell.getPendingNotifications()).toHaveLength(0);
      const pgid = job.pid;
      expect(() => process.kill(-pgid, 0)).not.toThrow();
      await expect(agent.session.startNewSession()).rejects.toThrow(
        'shell cleanup',
      );
      await awaitShellCleanup(shell);
      expect(() => process.kill(-pgid, 0)).toThrow('ESRCH');
      await agent.session.startNewSession();
      expect(await agent.session.getHistory()).toStrictEqual([]);
    } finally {
      off();
      await cleanup();
    }
  });

  it.skipIf(process.platform === 'win32')(
    'requires restart after the OS cannot confirm a shell group drained',
    async () => {
      const { agent, cleanup } = await buildAgent('plain-text.jsonl');
      const { shell } = owners(agent);
      const terminal = deferred<void>();
      const off = shell.onJobCompleted(() => terminal.resolve());
      const originalKill = process.kill;
      try {
        const job = shell.launch({
          command: 'printf ownership-probe',
          cwd: process.cwd(),
        });
        if (job.pid === undefined)
          throw new Error('Expected shell group identity');
        const pgid = job.pid;
        process.kill = (pid, signal): true => {
          if (pid === -pgid && signal === 0)
            throw Object.assign(new Error('probe denied'), { code: 'EPERM' });
          return originalKill.call(process, pid, signal);
        };
        await deadline(terminal.promise, 'terminal shell record');
        shell.markNotified([job.id]);
        await expect(agent.session.startNewSession()).rejects.toThrow(
          'wait for owned process groups to drain',
        );
        await expect(shell.current()?.cancel(job.id)).rejects.toThrow(
          'Cannot confirm shell process group',
        );
        expect(shell.hasPendingWork()).toBe(true);
        await expect(agent.session.startNewSession()).rejects.toThrow(
          'shell cleanup failed (restart the CLI)',
        );
        process.kill = originalKill;
        await expect(shell.dispose()).rejects.toThrow(
          'Shell process group cleanup failed',
        );
        await expect(agent.session.startNewSession()).rejects.toThrow(
          'shell cleanup failed (restart the CLI)',
        );
      } finally {
        process.kill = originalKill;
        off();
        await cleanup();
      }
    },
    15000,
  );

  it('rejects client-channel tools awaiting approval even after scheduling returns', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    agent.setApprovalMode(ApprovalMode.DEFAULT);
    const channel = agent.tools.openClientChannel();
    try {
      await channel.ready;
      await channel.schedule(
        {
          callId: 'clear-channel',
          name: 'run_shell_command',
          args: { command: 'printf channel-result' },
          isClientInitiated: true,
          prompt_id: 'clear-channel',
        },
        new AbortController().signal,
      );
      await expect(agent.session.startNewSession()).rejects.toThrow(
        'client tools',
      );
      channel.cancelAll();
      await channel.release();
      await agent.session.startNewSession();
      expect(await collectAgentHistory(agent)).toStrictEqual([]);
    } finally {
      await channel.release();
      await cleanup();
    }
  });

  it('rejects a running subagent and its completed but undelivered notice', async () => {
    const oldId = crypto.randomUUID();
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      sessionId: oldId,
    });
    const { tasks } = owners(agent);
    try {
      await tasks.start(async (launch, publish) => {
        tasks.manager.registerTask({
          id: 'old-task',
          subagentName: 'worker',
          goalPrompt: 'work',
          abortController: launch.controller,
        });
        launch.register('old-task');
        publish({ llmContent: '', returnDisplay: '' });
      });
      await setImmediate();
      await expect(agent.session.startNewSession()).rejects.toThrow(
        AgentBusyError,
      );
      tasks.manager.completeTask('old-task', {
        terminate_reason: SubagentTerminateMode.GOAL,
        emitted_vars: { result: 'old-session result' },
      });
      await expect(agent.session.startNewSession()).rejects.toThrow(
        'background',
      );
      expect(agent.session.getSessionId()).toBe(oldId);
      tasks.markNotified('old-task');
      await agent.session.startNewSession();
      expect(agent.session.getSessionId()).not.toBe(oldId);
      expect(await collectAgentHistory(agent)).toStrictEqual([]);
    } finally {
      await cleanup();
    }
  });

  it('rejects an already queued delivery until the submission is consumed', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    const { tasks } = owners(agent);
    const entered = deferred<void>();
    const consumed = deferred<void>();
    const unsubscribe = agent.tasks.subscribeNotifications(
      () => false,
      async () => {
        entered.resolve();
        await consumed.promise;
      },
    );
    try {
      await tasks.start(async (launch, publish) => {
        tasks.manager.registerTask({
          id: 'queued-task',
          subagentName: 'worker',
          goalPrompt: 'work',
          abortController: launch.controller,
        });
        launch.register('queued-task');
        publish({ llmContent: '', returnDisplay: '' });
      });
      tasks.manager.completeTask('queued-task', {
        terminate_reason: SubagentTerminateMode.GOAL,
        emitted_vars: { result: 'queued output' },
      });
      await deadline(entered.promise, 'queued notice');
      tasks.markNotified('queued-task');
      await expect(agent.session.startNewSession()).rejects.toThrow(
        'background',
      );
      consumed.resolve();
      await unsubscribe.drain();
      await agent.session.startNewSession();
      expect(await collectAgentHistory(agent)).toStrictEqual([]);
    } finally {
      consumed.resolve();
      unsubscribe();
      await unsubscribe.drain();
      await cleanup();
    }
  });

  it('rejects running shell jobs and their completed but undelivered notices', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    const { shell } = owners(agent);
    try {
      const terminal = deferred<void>();
      const off = shell.onJobCompleted(() => terminal.resolve());
      const job = shell.launch({
        command: 'printf old-shell-output',
        cwd: process.cwd(),
      });
      const switchWhileShellRunning = agent.session.startNewSession();
      await expect(switchWhileShellRunning).rejects.toThrow('background');
      await deadline(terminal.promise, 'shell completion');
      off();
      const switchWithUndeliveredShellNotice = agent.session.startNewSession();
      await expect(switchWithUndeliveredShellNotice).rejects.toThrow(
        'background',
      );
      shell.markNotified([job.id]);
      await awaitShellCleanup(shell);
      await setImmediate();
      await agent.session.startNewSession();
      expect(await collectAgentHistory(agent)).toStrictEqual([]);
    } finally {
      await cleanup();
    }
  });
});
