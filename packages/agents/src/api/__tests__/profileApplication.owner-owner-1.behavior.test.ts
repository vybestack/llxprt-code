import { mkdtemp, rm, mkdir } from 'node:fs/promises';
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
import { type Agent } from '../index.js';
import { usePromptFixture } from './helpers/prompt-fixture.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import {
  observeSameLabelProfileRoot,
  openSameLabelProfileRoot,
} from './helpers/same-label-profile-root.js';

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

  async function openRoot(label: string, contextLimit: number) {
    const root = await openSameLabelProfileRoot(
      directory,
      label,
      contextLimit,
      builtCredentials().authority,
    );
    ownerCloses.push(root.close);
    return root;
  }

  it('applies distinct same-name public profiles without moving the other owner model, parameters or defaults', async () => {
    const a = await openRoot('a', 8192);
    const b = await openRoot('b', 16384);
    await createSelection(a.agent, 'a-selected');
    await createSelection(b.agent, 'b-selected');
    await Promise.all([
      a.agent.profiles.apply('selected'),
      b.agent.profiles.apply('selected'),
    ]);
    for (const [owner, model, temperature, contextLimit, defaultProfile] of [
      [a, 'a-selected', 0.2, 8192, 'a-default'],
      [b, 'b-selected', 0.8, 16384, 'b-default'],
    ] as const) {
      expect(owner.agent.getModel()).toBe(model);
      expect(owner.agent.providerReads.getActiveModelName()).toBe(model);

      expect(owner.agent.providerReads.getActiveProviderName()).toBe('fake');
      expect(owner.agent.captureProfile()).toMatchObject({
        model,
        modelParams: { temperature },
        ephemeralSettings: { 'context-limit': contextLimit },
      });
      expect(owner.settings.getProviderSettings('fake')).toMatchObject({
        model,
        temperature,
      });
      expect(owner.settings.get('defaultProfile')).toBe(defaultProfile);
    }
    expect(a.agent.getEphemeralSetting('reasoning.enabled')).toBe(true);
    expect(b.agent.getEphemeralSetting('reasoning.enabled')).toBe(false);
    const beforeB = observeSameLabelProfileRoot(b);
    await createSelection(a.agent, 'a-next');
    await a.agent.profiles.apply('selected');
    expect(a.agent.getModel()).toBe('a-next');
    expect(a.agent.providerReads.getActiveModelName()).toBe('a-next');
    expect(b.agent.providerReads.getActiveModelName()).toBe('b-selected');
    expect(a.agent.providerReads.getActiveProviderName()).toBe('fake');
    expect(b.agent.providerReads.getActiveProviderName()).toBe('fake');
    expect(a.agent.getEphemeralSetting('reasoning.enabled')).toBeUndefined();
    expect(observeSameLabelProfileRoot(b)).toStrictEqual(beforeB);
  }, 30000);
});
