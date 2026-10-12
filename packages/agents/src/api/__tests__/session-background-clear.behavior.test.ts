/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { setImmediate } from 'node:timers/promises';
import { ApprovalMode } from '@vybestack/llxprt-code-core';
import { AgentBusyError } from '../loop/agentBusyError.js';
import { SubagentTerminateMode } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { TaskLaunchOwner } from '../../session/task-launch-owner.js';
import { ShellJobOwner } from '../../session/shell-job-owner.js';
import { type Agent, buildAgent } from './helpers/agentHarness.js';
import { deferred, deadline } from './helpers/shell-owner-gate.js';
import { collectAgentHistory } from './helpers/collect-agent-history.js';

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
      await agent.session.startNewSession();
      expect(await collectAgentHistory(agent)).toStrictEqual([]);
    } finally {
      await cleanup();
    }
  });
});
