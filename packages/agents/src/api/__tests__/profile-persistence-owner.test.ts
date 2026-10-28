import { ProfileManager } from '@vybestack/llxprt-code-settings';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { createAgent, type Agent } from '../index.js';
import { openRouteAAgent } from './helpers/route-a-agent.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

describe('explicit profile persistence', () => {
  let promptDirectory: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'engine-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });

  useFakeResponsesReplay('plain-text.jsonl');

  it('captures and persists same-label owners outside ALS without borrowing the foreground state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'profile-owner-'));
    const oldHome = process.env.LLXPRT_CONFIG_HOME;
    process.env.LLXPRT_CONFIG_HOME = directory;
    const agents: Agent[] = [];
    let closeSecond: (() => Promise<void>) | undefined;
    try {
      const first = await createAgent({
        provider: 'fake',
        model: 'first-model',
        workingDir: process.cwd(),
        sessionId: 'same-label',
      });
      agents.push(first);
      const opened = await openRouteAAgent({
        config: { model: 'second-model', sessionId: 'same-label' },
        intent: { activation: { provider: 'fake', model: 'second-model' } },
      });
      closeSecond = opened.close;
      const { agent: second, settings } = opened;
      settings.setCurrentProfileName('adopted-current');
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
      expect(second.captureProfile()).toStrictEqual(before);
      expect(settings.get('defaultProfile')).toBe('second');
      expect(second.getActiveProfileName()).toBe('adopted-current');
    } finally {
      for (const agent of agents) await agent.dispose();
      await closeSecond?.();
      if (oldHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
      else process.env.LLXPRT_CONFIG_HOME = oldHome;
      await rm(directory, { recursive: true, force: true });
    }
  });
});
