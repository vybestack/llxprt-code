import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  ProfileManager,
  type SettingsService,
} from '@vybestack/llxprt-code-settings';
import { mkdtemp, realpath, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeProviderAliasConfig } from '@vybestack/llxprt-code-providers/composition.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import {
  beforeAll,
  afterAll,
  describe,
  expect,
  it,
  afterEach,
  beforeEach,
} from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { usePromptFixture } from './helpers/prompt-fixture.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openRouteBPreflight } from './helpers/route-b-preflight.js';
import type { Agent } from '../agent.js';

function observe(root: {
  agent: Agent;
  config: Config;
  settings: SettingsService;
  settingsOwner: SessionSettingsOwner;
}): object {
  return {
    provider: root.agent.getProvider(),
    model: root.agent.getModel(),
    status: root.agent.getProviderStatus(),
    profile: root.agent.getActiveProfileName(),
    snapshot: root.agent.captureProfile(),
    configProvider: root.config.getProvider(),
    configModel: root.config.getModel(),
    managerProvider: root.agent.providerReads.getActiveProviderName(),
    settings: root.settings.exportForStateSnapshot(),
    ephemerals: root.settingsOwner.captureNamedParameters(),
    modelDefaultOwnership:
      root.settingsOwner.captureDefaultClassification().modelKeys,
    providerDefaultOwnership:
      root.settingsOwner.captureDefaultClassification().providerEntries,
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
  const builtCredentials = useOwnedCredentials();
  const selectReplay = useFakeResponsesReplay('plain-text.jsonl');

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

  async function openRoot(
    label: string,
    contextLimit: number,
  ): Promise<{
    agent: Agent;
    config: Config;
    settings: SettingsService;
    settingsOwner: SessionSettingsOwner;
    keyfile: string;
    profiles: ProfileManager;
  }> {
    const workingDir = join(directory, label);
    await mkdir(workingDir, { recursive: true });
    const keyfile = join(workingDir, 'credential.txt');
    await writeFile(keyfile, `fake-${label}-credential`, { mode: 0o600 });
    selectReplay('plain-text.jsonl');
    const route = await openRouteBPreflight({
      authority: builtCredentials().authority,
      config: {
        model: `${label}-initial`,
        workingDir: await realpath(workingDir),
        sessionId: 'same-profile-owner-label',
        settings: { profileDirectory: join(workingDir, 'durable-profiles') },
        interactive: true,
      },
    });
    const settingsOwner = new SessionSettingsOwner(route.settings);
    ownerCloses.push(() =>
      runCleanupSteps([() => route.close(), () => settingsOwner.dispose()]),
    );
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
    delete process.env.LLXPRT_FAKE_RESPONSES;
    settingsOwner.writeUserParameter('context-limit', contextLimit);
    route.settings.setCurrentProfileName(`${label}-prior`);
    agent.setDefaultProfileName(`${label}-default`);
    const profiles = new ProfileManager(join(workingDir, 'durable-profiles'));
    await profiles.saveProfile('selected', agent.captureProfile());
    return {
      agent,
      config: route.config,
      settings: route.settings,
      settingsOwner,
      keyfile,
      profiles,
    };
  }

  it('applies the public keyfile and endpoint with the selected model instead of leaving partial profile state', async () => {
    const a = await openRoot('a', 8192);
    const b = await openRoot('b', 16384);
    const beforeB = observe(b);
    await a.agent.profiles.create('credential-selection', {
      name: 'credential-selection',
      provider: 'fake',
      model: 'a-credential-model',
      authKeyFile: a.keyfile,
      baseUrl: 'https://a.invalid/v1',
      modelParams: { temperature: 0.3 },
    });
    await a.agent.profiles.apply('credential-selection');
    expect(observe(b)).toStrictEqual(beforeB);
    expect(a.agent.getModel()).toBe('a-credential-model');
    expect(a.settingsOwner.readSelectedModel()).toBe('a-credential-model');
    expect(a.agent.captureProfile()).toMatchObject({
      modelParams: { temperature: 0.3 },
    });
    expect(a.agent.getProviderStatus()).toMatchObject({
      keyFile: a.keyfile,
      baseUrl: 'https://a.invalid/v1',
      authStatus: 'authenticated',
    });
  }, 30000);
});
