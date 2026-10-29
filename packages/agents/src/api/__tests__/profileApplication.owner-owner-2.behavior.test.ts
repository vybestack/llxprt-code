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

  it('rejects a missing public profile before mutation and preserves both owners', async () => {
    const a = await openRoot('a', 8192);
    const b = await openRoot('b', 16384);
    await createSelection(a.agent, 'a-selected');
    await a.agent.profiles.apply('selected');
    const beforeA = observeSameLabelProfileRoot(a);
    const beforeB = observeSameLabelProfileRoot(b);
    await expect(a.agent.profiles.apply('missing')).rejects.toThrow(
      "Profile 'missing' not found",
    );
    expect(observeSameLabelProfileRoot(a)).toStrictEqual(beforeA);
    expect(observeSameLabelProfileRoot(b)).toStrictEqual(beforeB);
  }, 30000);
});
