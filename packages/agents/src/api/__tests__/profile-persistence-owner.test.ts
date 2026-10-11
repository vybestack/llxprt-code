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
import { createAgent, fromConfig, type Agent } from '../index.js';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';
import { ProfileManager } from '@vybestack/llxprt-code-settings';

describe('explicit profile persistence', () => {
  it('captures and persists same-label owners outside ALS without borrowing the foreground state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'profile-owner-'));
    const oldHome = process.env.LLXPRT_CONFIG_HOME;
    const oldFake = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_CONFIG_HOME = directory;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('./fixtures/plain-text.jsonl', import.meta.url),
    );
    const agents: Agent[] = [];
    let cleanupAdopted: (() => Promise<void>) | undefined;
    try {
      const first = await createAgent({
        provider: 'fake',
        model: 'first-model',
        workingDir: process.cwd(),
        sessionId: 'same-label',
      });
      agents.push(first);
      const built = await buildCliStyleConfig('plain-text.jsonl', {
        model: 'second-model',
        sessionId: 'same-label',
      });
      cleanupAdopted = built.cleanup;
      const adoptedManager = built.providerManager;
      const settings = built.settingsService;
      settings.setCurrentProfileName('adopted-current');
      const second = await fromConfig({
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        config: built.config,
        mcpRuntime: built.mcpRuntime,
        messageBus: built.messageBus,
      });
      try {
        agents.push(second);
        first.setModelParam('temperature', 0.2);
        second.setModelParam('temperature', 0.8);
        first.setDefaultProfileName('first');
        second.setDefaultProfileName('second');
        first.setDefaultProfileName('first-again');
        expect(settings.get('defaultProfile')).toBe('second');
        expect(second.getActiveProfileName()).toBe('adopted-current');
        expect(second.getRuntimeDiagnosticsSnapshot()).toMatchObject({
          modelName: 'second-model',
          profileName: 'adopted-current',
          modelParams: { temperature: 0.8 },
        });
        const before = second.captureProfile();
        await first.saveProfileSnapshot('first');
        await second.saveProfileSnapshot('second');
        const manager = new ProfileManager();
        expect(await manager.loadProfile('first')).toMatchObject({
          model: 'first-model',
          modelParams: { temperature: 0.2 },
        });
        expect(await manager.loadProfile('second')).toMatchObject({
          model: 'second-model',
          modelParams: { temperature: 0.8 },
        });
        await expect(first.deleteProfileByName('missing')).rejects.toThrow(
          "Profile 'missing' not found",
        );
        expect(second.captureProfile()).toStrictEqual(before);
        await expect(first.saveProfileSnapshot('bad/name')).rejects.toThrow(
          'Invalid profile name',
        );
        expect(second.captureProfile()).toStrictEqual(before);
        await first.deleteProfileByName('first');
        expect(await manager.listProfiles()).toStrictEqual(['second']);
        await first.dispose();
        expect(built.providerManager).toBe(adoptedManager);
        expect(second.captureProfile()).toStrictEqual(before);
        expect(settings.get('defaultProfile')).toBe('second');
        expect(second.getActiveProfileName()).toBe('adopted-current');
      } finally {
        await second.dispose();
      }
    } finally {
      for (const agent of agents) await agent.dispose();
      await cleanupAdopted?.();
      if (oldHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
      else process.env.LLXPRT_CONFIG_HOME = oldHome;
      if (oldFake === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
      else process.env.LLXPRT_FAKE_RESPONSES = oldFake;
      await rm(directory, { recursive: true, force: true });
    }
  });
});
