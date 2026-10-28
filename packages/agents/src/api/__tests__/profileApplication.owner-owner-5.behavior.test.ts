/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { ProfileManager } from '@vybestack/llxprt-code-settings';
import { writeProviderAliasConfig } from '@vybestack/llxprt-code-providers/composition.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { type Agent } from '../index.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { usePromptFixture } from './helpers/prompt-fixture.js';
import {
  openRouteBPreflight,
  type RouteBPreflight,
} from './helpers/route-b-preflight.js';

interface Owner {
  readonly agent: Agent;
  readonly route: RouteBPreflight;
  readonly settingsOwner: SessionSettingsOwner;
  readonly profiles: ProfileManager;
  readonly keyfile: string;
}

function observe(owner: Owner): object {
  return {
    provider: owner.agent.getProvider(),
    model: owner.agent.getModel(),
    status: owner.agent.getProviderStatus(),
    profile: owner.agent.getActiveProfileName(),
    snapshot: owner.agent.captureProfile(),
    configProvider: owner.route.config.getProvider(),
    configModel: owner.route.config.getModel(),
    managerProvider: owner.route.preflight.getActiveProviderName(),
    settings: owner.route.settings.exportForStateSnapshot(),
    ephemerals: owner.settingsOwner.captureNamedParameters(),
    modelDefaultOwnership:
      owner.settingsOwner.captureDefaultClassification().modelKeys,
    providerDefaultOwnership:
      owner.settingsOwner.captureDefaultClassification().providerEntries,
  };
}

describe('public profile application ownership outside ALS', () => {
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

  let directory: string;

  let previousHome: string | undefined;

  let previousData: string | undefined;

  let ownerCloses: Array<() => Promise<void>>;

  usePromptFixture();

  beforeEach(async () => {
    const evidence = join(tmpdir(), 'llxprt-profile-application-owner');
    await mkdir(evidence, { recursive: true });
    directory = await mkdtemp(join(evidence, 'fixture-'));
    previousHome = process.env.LLXPRT_CONFIG_HOME;
    previousData = process.env.LLXPRT_DATA_HOME;
    process.env.LLXPRT_CONFIG_HOME = join(directory, 'user');
    process.env.LLXPRT_DATA_HOME = join(directory, 'data');
    writeProviderAliasConfig('fake', {
      baseProvider: 'openai',
      modelDefaults: [
        {
          pattern: '^a-selected$',
          ephemeralSettings: { 'reasoning.enabled': true },
        },
        {
          pattern: '^b-selected$',
          ephemeralSettings: { 'reasoning.enabled': false },
        },
      ],
    });
    ownerCloses = [];
  });

  afterEach(async () => {
    try {
      await runCleanupSteps([...ownerCloses].reverse());
    } finally {
      if (previousHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
      else process.env.LLXPRT_CONFIG_HOME = previousHome;
      if (previousData === undefined) delete process.env.LLXPRT_DATA_HOME;
      else process.env.LLXPRT_DATA_HOME = previousData;
      await rm(directory, { recursive: true, force: true });
    }
  });

  async function createSelection(agent: Agent, model: string): Promise<void> {
    await agent.profiles.create('selected', {
      name: 'selected',
      provider: 'fake',
      model,
      modelParams: { temperature: model.startsWith('a') ? 0.2 : 0.8 },
    });
  }

  async function openOwner(
    label: string,
    contextLimit: number,
  ): Promise<Owner> {
    const workingDir = join(directory, label);
    await mkdir(workingDir, { recursive: true });
    const keyfile = join(workingDir, 'credential.txt');
    await writeFile(keyfile, `fake-${label}-credential`, { mode: 0o600 });
    const route = await openRouteBPreflight({
      config: {
        model: `${label}-initial`,
        workingDir,
        sessionId: 'same-profile-owner-label',
        interactive: true,
        settings: { profileDirectory: join(workingDir, 'durable-profiles') },
      },
    });
    ownerCloses.push(() => route.close());
    const settingsOwner = new SessionSettingsOwner(route.settings);
    ownerCloses.push(() => settingsOwner.dispose());
    settingsOwner.initializeProviderSelection(
      route.config.getProvider(),
      route.config.getModel(),
    );
    await route.prepare({ settingsOwner });
    const agent = await route.createAgent({
      provider: route.config.getProvider(),
      model: route.config.getModel(),
    });
    ownerCloses.push(() => agent.dispose());
    const profiles = new ProfileManager(join(workingDir, 'durable-profiles'));
    settingsOwner.writeUserParameter('context-limit', contextLimit);
    route.settings.setCurrentProfileName(`${label}-prior`);
    agent.setDefaultProfileName(`${label}-default`);
    await profiles.saveProfile('selected', agent.captureProfile());
    return { agent, route, settingsOwner, profiles, keyfile };
  }

  it('loads and saves durable owner profiles outside ALS', async () => {
    const a = await openOwner('a', 8192);
    const b = await openOwner('b', 16384);
    await a.profiles.saveProfile('durable', {
      version: 1,
      provider: 'fake',
      model: 'a-selected',
      modelParams: { temperature: 0.4 },
      ephemeralSettings: {
        'auth-keyfile': a.keyfile,
        'base-url': 'https://a.invalid/v1',
      },
    });
    const beforeB = observe(b);
    await a.agent.profiles.load('durable');
    expect(a.agent.getModel()).toBe('a-selected');
    expect(a.agent.getActiveProfileName()).toBe('durable');
    expect(a.agent.getProviderStatus()).toMatchObject({
      keyFile: a.keyfile,
      baseUrl: 'https://a.invalid/v1',
      authStatus: 'authenticated',
    });
    await a.agent.saveProfileSnapshot('roundtrip');
    expect(await a.profiles.loadProfile('roundtrip')).toMatchObject({
      model: 'a-selected',
      modelParams: { temperature: 0.4 },
      ephemeralSettings: { 'auth-keyfile': a.keyfile },
    });
    await createSelection(a.agent, 'a-other');
    await a.agent.profiles.apply('selected');
    await a.agent.profiles.load('roundtrip');
    expect(a.agent.getModel()).toBe('a-selected');
    expect(observe(b)).toStrictEqual(beforeB);
  }, 30000);
});
