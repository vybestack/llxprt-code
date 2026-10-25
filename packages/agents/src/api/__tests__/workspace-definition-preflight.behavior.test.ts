import { WorkspaceDefinitionOwner } from '@vybestack/llxprt-code-core';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgent } from '../createAgent.js';
import type { ProviderActivationIntent } from '../config-types.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { openRouteBPreflight } from './helpers/route-b-preflight.js';

describe('public Agent workspace definition lifetime', () => {
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

  useFakeResponsesReplay('multi-turn-text.jsonl');
  const callerCredentials = useOwnedCredentials();

  let root: string;

  const directories: string[] = [];

  let previousHome: string | undefined;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'llxprt-public-definitions-'));
    directories.push(root);
    previousHome = process.env.LLXPRT_CONFIG_HOME;
    process.env.LLXPRT_CONFIG_HOME = join(root, 'config');
  });

  afterEach(async () => {
    if (previousHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
    else process.env.LLXPRT_CONFIG_HOME = previousHome;
  });

  afterAll(async () => {
    await Promise.all(
      directories.map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  it('transfers the owned preflight disk root into adoption and retires only its repository lifetime', async () => {
    const route = await openRouteBPreflight({
      config: { workingDir: root },
    });
    const settingsOwner = new SessionSettingsOwner(route.settings);
    settingsOwner.bindTelemetry(route.config);
    settingsOwner.initializeProviderSelection(
      route.config.getProvider(),
      route.config.getModel(),
    );
    const intent: ProviderActivationIntent = {
      provider: 'fake',
      authMode: 'auto',
      cliOverrides: { key: 'preflight-fixture-key' },
    };
    let agent: Awaited<ReturnType<typeof route.createAgent>> | undefined;
    try {
      await route.prepare({ settingsOwner });
      await mkdir(join(root, 'config/profiles'), { recursive: true });
      await writeFile(
        join(root, 'config/profiles/owned-preflight.json'),
        JSON.stringify({
          version: 1,
          provider: 'fake',
          model: 'owned-preflight-model',
          modelParams: {},
          ephemeralSettings: {},
        }),
      );
      agent = await route.createAgent(intent);
      await agent.profiles.load('owned-preflight');
      expect(agent.captureProfile().model).toBe('owned-preflight-model');
      await agent.saveProfileSnapshot('owned-adopted');
      await route.disposePreflight();
      expect(await agent.workspace.profileDefinitions.listProfiles()).toContain(
        'owned-adopted',
      );
      await agent.dispose();
      expect(() => agent?.workspace.profileDefinitions.listProfiles()).toThrow(
        'closed',
      );
      const persisted: unknown = JSON.parse(
        await readFile(
          join(root, 'config/profiles/owned-adopted.json'),
          'utf8',
        ),
      );
      expect(persisted).toMatchObject({
        version: 1,
        model: 'owned-preflight-model',
      });
      settingsOwner.assertSettingsIdentity(route.settings);
    } finally {
      await agent?.dispose();
      await route.disposePreflight();
      await route.close();
      await settingsOwner.dispose();
    }
  }, 30000);

  it('retains a caller-owned definition root after Agent disposal', async () => {
    const callerDefinitions = new WorkspaceDefinitionOwner(
      join(root, 'caller/profiles'),
      join(root, 'caller/subagents'),
    );
    const agent = await createAgent({
      provider: 'fake',
      model: 'fake-model',
      workingDir: root,
      credentialAuthority: callerCredentials().authority,
      definitionOwner: callerDefinitions,
      definitionOwnership: 'caller',
    });
    try {
      await callerDefinitions.profileWrites.saveProfile('preflight', {
        version: 1,
        provider: 'fake',
        model: 'preflight-model',
        modelParams: {},
        ephemeralSettings: {},
      });
      await agent.profiles.load('preflight');
      expect(agent.getModel()).toBe('preflight-model');
      await agent.saveProfileSnapshot('after-adoption');
      expect(await callerDefinitions.profileReads.listProfiles()).toContain(
        'after-adoption',
      );
      await agent.dispose();
      await callerDefinitions.profileWrites.saveProfile('caller-survives', {
        version: 1,
        provider: 'fake',
        model: 'fake-model',
        modelParams: {},
        ephemeralSettings: {},
      });
      expect(await callerDefinitions.profileReads.listProfiles()).toContain(
        'caller-survives',
      );
    } finally {
      await agent.dispose();
      await callerDefinitions.dispose();
    }
  }, 30000);
});
