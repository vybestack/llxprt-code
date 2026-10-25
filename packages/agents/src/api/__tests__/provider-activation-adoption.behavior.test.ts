/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  type Agent,
  type ProviderActivationIntent,
} from '@vybestack/llxprt-code-agents';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { fromConfig } from '../fromConfig.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { openRouteAAgent } from './helpers/route-a-agent.js';

describe('fromConfig executes the activation intent (#2374)', () => {
  useFakeResponsesReplay('plain-text.jsonl');
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

  const credentials = useOwnedCredentials();

  it('(a) fromConfig with activation intent activates the provider', async () => {
    const intent: ProviderActivationIntent = {
      provider: 'fake',
      defaultProvider: 'gemini',
      model: 'fake-model',
      authMode: 'auto',
    };
    const built = await openRouteAAgent({
      authority: credentials().authority,
      intent: { activation: intent },
    });
    try {
      const agent: Agent = built.agent;
      expect(agent.getProvider()).toBe('fake');
      expect(agent.providerReads.getActiveProviderName()).toBe('fake');
    } finally {
      await built.close();
    }
  });

  it('(d) profile-auth-ephemerals survive fromConfig (provider already active + ephemerals intact)', async () => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'caller-adoption-')),
    );
    const config = new Config(
      toConfigParameters({
        provider: 'fake',
        model: 'fake-model',
        sessionId: randomUUID(),
        workingDir: directory,
      }),
    );
    const settings = new SettingsService();
    for (const [key, value] of Object.entries(config.getInitialSettings()))
      settings.set(key, value);
    const settingsOwner = new SessionSettingsOwner(settings);
    let agent: Agent | undefined;
    try {
      // Simulate a profile-loaded provider runtime: the provider is already
      // active and profile auth ephemerals are present.
      settingsOwner.writeUserParameter('auth-keyfile', '/tmp/profile.key');
      settingsOwner.writeUserParameter(
        'base-url',
        'https://profile.example/v1',
      );

      const beforeKeyfile = settingsOwner.readNamedParameter('auth-keyfile');
      const beforeBaseUrl = settingsOwner.readNamedParameter('base-url');
      expect(beforeKeyfile).toBe('/tmp/profile.key');
      expect(beforeBaseUrl).toBe('https://profile.example/v1');

      const intent: ProviderActivationIntent = {
        provider: 'fake',
        model: 'fake-model',
        authMode: 'auto',
      };
      agent = await fromConfig(
        config,
        settings,
        { activation: intent },
        credentials().authority,
      );
      // The profile auth ephemerals MUST survive fromConfig — the provider
      // was already active WITH profile ephemerals, so fromConfig must NOT
      // re-switch / clear them (the restoreActiveProvider compensation is
      // unnecessary).
      expect(settingsOwner.readNamedParameter('auth-keyfile')).toBe(
        '/tmp/profile.key',
      );
      expect(settingsOwner.readNamedParameter('base-url')).toBe(
        'https://profile.example/v1',
      );
      expect(agent.providerReads.getActiveProviderName()).toBe('fake');
    } finally {
      await runCleanupSteps([
        () => agent?.dispose(),
        () => settingsOwner.dispose(),
        () => config.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ]);
    }
  });

  it('(f) fromConfig with authMode none skips auth refresh', async () => {
    const intent: ProviderActivationIntent = {
      provider: 'fake',
      authMode: 'none',
    };
    const built = await openRouteAAgent({
      authority: credentials().authority,
      intent: { activation: intent },
    });
    try {
      expect(built.agent.getProvider()).toBe('fake');
    } finally {
      await built.close();
    }
  });

  it('fromConfig without activation preserves backward-compatible behavior', async () => {
    const built = await openRouteAAgent({
      authority: credentials().authority,
      intent: {},
    });
    try {
      expect(built.agent.getProvider()).toBe('fake');
    } finally {
      await built.close();
    }
  });
});
