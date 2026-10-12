/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgent, type Agent } from '@vybestack/llxprt-code-agents';
import { ProfileManager } from '@vybestack/llxprt-code-settings';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { profileCommand } from './profileCommand.js';

describe('profile commands with an explicit Agent', () => {
  it('saves and deletes the command owner outside React, ALS and runtime registration', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'profile-command-owner-'));
    const oldHome = process.env.LLXPRT_CONFIG_HOME;
    const oldFake = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_CONFIG_HOME = directory;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL(
        '../../../../agents/src/api/__tests__/fixtures/plain-text.jsonl',
        import.meta.url,
      ),
    );
    const agents: Agent[] = [];
    try {
      const first = await createAgent({
        provider: 'fake',
        model: 'command-model',
        workingDir: process.cwd(),
        sessionId: 'same-label',
      });
      agents.push(first);
      const second = await createAgent({
        provider: 'fake',
        model: 'foreground-model',
        workingDir: process.cwd(),
        sessionId: 'same-label',
      });
      agents.push(second);
      first.setModelParam('temperature', 0.2);
      second.setModelParam('temperature', 0.8);
      const foreground = second.captureProfile();
      const context = createMockCommandContext({
        services: { agent: first, settings: { setValue: () => undefined } },
      });
      const invoke = async (name: string, args: string) => {
        const action = profileCommand.subCommands?.find(
          (entry) => entry.name === name,
        )?.action;
        if (!action) throw new Error(`Missing ${name} command`);
        return action(context, args);
      };
      expect(await invoke('save', 'model from-command')).toMatchObject({
        messageType: 'info',
      });
      const store = new ProfileManager();
      expect(await store.loadProfile('from-command')).toMatchObject({
        model: 'command-model',
        modelParams: { temperature: 0.2 },
      });
      expect(await invoke('set-default', 'from-command')).toMatchObject({
        messageType: 'info',
      });
      expect(await invoke('set-default', 'none')).toMatchObject({
        messageType: 'info',
      });
      await first.setModel('changed-model');
      expect(await invoke('load', 'from-command')).toMatchObject({
        messageType: 'info',
      });
      expect(first.getModel()).toBe('command-model');
      expect(first.captureProfile().modelParams.temperature).toBe(0.2);
      expect(await invoke('delete', 'from-command')).toMatchObject({
        messageType: 'info',
      });
      expect(await store.listProfiles()).toStrictEqual([]);
      expect(second.captureProfile()).toStrictEqual(foreground);
    } finally {
      for (const agent of agents) await agent.dispose();
      if (oldHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
      else process.env.LLXPRT_CONFIG_HOME = oldHome;
      if (oldFake === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
      else process.env.LLXPRT_FAKE_RESPONSES = oldFake;
      await rm(directory, { recursive: true, force: true });
    }
  });
});
