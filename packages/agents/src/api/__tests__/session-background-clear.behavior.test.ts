/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { setImmediate, setTimeout as delay } from 'node:timers/promises';
import { ApprovalMode } from '@vybestack/llxprt-code-core';
import { AgentBusyError } from '../loop/agentBusyError.js';
import { deferred, deadline } from './helpers/shell-owner-gate.js';
import { collectAgentHistory } from './helpers/collect-agent-history.js';
import { type Agent, buildAgent } from './helpers/agentHarness.js';

async function startNewSessionWhenIdle(agent: Agent): Promise<void> {
  for (;;) {
    try {
      await agent.session.startNewSession();
      return;
    } catch (error) {
      if (!(error instanceof AgentBusyError)) throw error;
      await delay(10);
    }
  }
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

  it('rejects a background shell job started through the public tool until its notice is delivered', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    const shellTool = agent.tools.get('run_shell_command');
    if (!shellTool) throw new Error('Missing public shell tool');
    const messages: string[] = [];
    const delivered = deferred<void>();
    let unsubscribe:
      | ReturnType<typeof agent.tasks.subscribeNotifications>
      | undefined;
    try {
      await shellTool.buildAndExecute(
        { command: 'printf old-shell-output', is_background: true },
        new AbortController().signal,
      );
      const job = agent.tasks.list().find((item) => item.kind === 'shell');
      if (!job) throw new Error('Missing launched public shell job');
      await expect(agent.session.startNewSession()).rejects.toThrow(
        AgentBusyError,
      );
      await deadline(
        (async () => {
          while (agent.tasks.get(job.id)?.status === 'running') await delay(10);
        })(),
        'shell completion',
      );
      await expect(agent.session.startNewSession()).rejects.toThrow(
        'background',
      );
      unsubscribe = agent.tasks.subscribeNotifications(
        () => false,
        async (text) => {
          messages.push(text);
          delivered.resolve();
        },
      );
      await deadline(delivered.promise, 'shell notice delivery');
      await unsubscribe.drain();
      await deadline(startNewSessionWhenIdle(agent), 'shell resource release');
      await setImmediate();
      expect(messages).toHaveLength(1);
      expect(await collectAgentHistory(agent)).toStrictEqual([]);
    } finally {
      unsubscribe?.();
      await unsubscribe?.drain();
      await cleanup();
    }
  });
});
