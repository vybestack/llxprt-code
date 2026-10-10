/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  afterAll,
  beforeAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fromConfig, type Agent } from '../index.js';
import {
  buildCliStyleConfig,
  type BuiltCliConfig,
} from './helpers/buildCliStyleConfig.js';
import { ProfileManager, type Profile } from '@vybestack/llxprt-code-settings';
import { FakeProvider } from '@vybestack/llxprt-code-providers';
import { fileURLToPath } from 'node:url';
import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import {
  getActiveModelName,
  getActiveProviderName,
} from '@vybestack/llxprt-code-providers/runtime.js';
import type { TokenStore, OAuthToken } from '@vybestack/llxprt-code-auth';
import {
  coreEvents,
  CoreEvent,
  type ModelProfileInfoPayload,
} from '@vybestack/llxprt-code-core/utils/events.js';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve: (value: T) => void = () => {
    throw new Error('Deferred not initialized');
  };
  let reject: (error: unknown) => void = () => {
    throw new Error('Deferred not initialized');
  };
  const promise = new Promise<T>((fulfill, fail) => {
    resolve = fulfill;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function tokenReadBoundary(read: TokenStore['getToken']): TokenStore {
  const unexpected = async (): Promise<never> => {
    throw new Error('Unexpected token-store write or lock');
  };
  return {
    getToken: read,
    saveToken: unexpected,
    removeToken: unexpected,
    listProviders: unexpected,
    listBuckets: unexpected,
    getBucketStats: unexpected,
    acquireRefreshLock: unexpected,
    releaseRefreshLock: unexpected,
    acquireAuthLock: unexpected,
    releaseAuthLock: unexpected,
  };
}
import { writeProviderAliasConfig } from '@vybestack/llxprt-code-providers/composition.js';

interface Owner {
  readonly agent: Agent;
  readonly built: BuiltCliConfig;
  readonly keyfile: string;
  readonly profiles: ProfileManager;
}

function observe(owner: Owner): object {
  const { agent, built } = owner;
  return {
    provider: agent.getProvider(),
    model: agent.getModel(),
    status: agent.getProviderStatus(),
    profile: agent.getActiveProfileName(),
    snapshot: agent.captureProfile(),
    configProvider: built.config.getProvider(),
    configModel: built.config.getModel(),
    managerProvider: built.providerManager.getActiveProviderName(),
    settings: built.settingsService.exportForStateSnapshot(),
    ephemerals: built.settingsOwner.captureNamedParameters(),
    modelDefaultOwnership:
      built.settingsOwner.captureDefaultClassification().modelKeys,
    providerDefaultOwnership:
      built.settingsOwner.captureDefaultClassification().providerEntries,
  };
}

describe('public profile application ownership outside ALS', () => {
  let directory: string;
  let previousHome: string | undefined;
  let previousFake: string | undefined;
  let owners: Owner[];

  let promptRoot: string;
  let previousPromptRoot: string | undefined;
  beforeAll(async () => {
    const evidence = join(
      import.meta.dirname,
      '../../../../../tmp/session-client-owner-consolidation',
    );
    promptRoot = await mkdtemp(join(evidence, 'profile-prompts-'));
    previousPromptRoot = process.env.LLXPRT_PROMPTS_DIR;
    process.env.LLXPRT_PROMPTS_DIR = promptRoot;
  });
  afterAll(async () => {
    if (previousPromptRoot === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPromptRoot;
    await rm(promptRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    const evidence = join(tmpdir(), 'llxprt-profile-application-owner');
    await mkdir(evidence, { recursive: true });
    directory = await mkdtemp(join(evidence, 'fixture-'));
    previousHome = process.env.LLXPRT_CONFIG_HOME;
    previousFake = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_CONFIG_HOME = join(directory, 'user');
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
    owners = [];
  });

  afterEach(async () => {
    try {
      for (const owner of [...owners].reverse()) {
        await owner.agent.dispose();
        await owner.built.cleanup();
      }
    } finally {
      if (previousHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
      else process.env.LLXPRT_CONFIG_HOME = previousHome;
      if (previousFake === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
      else process.env.LLXPRT_FAKE_RESPONSES = previousFake;
      await rm(directory, { recursive: true, force: true });
    }
  });

  async function makeOwner(
    label: string,
    tokenStore?: TokenStore,
  ): Promise<Owner> {
    const workingDir = join(directory, label);
    await mkdir(workingDir, { recursive: true });
    const keyfile = join(workingDir, 'credential.txt');
    await writeFile(keyfile, `fake-${label}-credential`, { mode: 0o600 });
    const built = await buildCliStyleConfig('plain-text.jsonl', {
      model: `${label}-initial`,
      workingDir,
      sessionId: 'same-profile-owner-label',
      settings: { profileDirectory: join(workingDir, 'durable-profiles') },
    });
    const profiles = new ProfileManager(join(workingDir, 'durable-profiles'));
    let oauthManager: OAuthManager | undefined;
    if (tokenStore !== undefined) {
      const oauth = new OAuthManager(tokenStore, undefined, {
        config: built.config,
        messageBus: built.messageBus,
      });
      oauth.registerProvider({
        name: 'fake',
        initiateAuth: async () => {
          throw new Error('Unexpected interactive authentication');
        },
        getToken: async () => null,
        refreshToken: async () => null,
      });
      oauth.registerProvider({
        name: 'fake-target',
        initiateAuth: async () => {
          throw new Error('Unexpected interactive authentication');
        },
        getToken: async () => null,
        refreshToken: async () => null,
      });
      await oauth.toggleOAuthEnabled('fake');
      await oauth.toggleOAuthEnabled('fake-target');
      const target = new FakeProvider(
        fileURLToPath(new URL('./fixtures/plain-text.jsonl', import.meta.url)),
        workingDir,
      );
      target.name = 'fake-target';
      built.providerManager.registerProvider(target);
      oauthManager = oauth;
    }
    const agent = await fromConfig({
      oauthManager,
      providerFileLifecycle: built.runtime.providerFileLifecycle,
      settingsOwner: built.settingsOwner,
      settingsService: built.settingsService,
      agentClient: built.agentClient,
      providerManager: built.providerManager,
      runtimeFactoryBindings: built.runtimeFactoryBindings,
      config: built.config,
      mcpRuntime: built.mcpRuntime,
      messageBus: built.messageBus,
      sessionId: 'same-profile-owner-label',
    });

    const owner = { agent, built, keyfile, profiles };
    owners.push(owner);
    delete process.env.LLXPRT_FAKE_RESPONSES;
    built.settingsOwner.writeUserParameter(
      'context-limit',
      label === 'a' ? 8192 : 16384,
    );
    built.settingsService.setCurrentProfileName(`${label}-prior`);
    agent.setDefaultProfileName(`${label}-default`);
    await profiles.saveProfile('selected', agent.captureProfile());
    return owner;
  }

  async function createSelection(owner: Owner, model: string): Promise<void> {
    await owner.agent.profiles.create('selected', {
      name: 'selected',
      provider: 'fake',
      model,
      modelParams: { temperature: model.startsWith('a') ? 0.2 : 0.8 },
    });
  }

  it('establishes independent real configs, settings, managers and durable profile stores', async () => {
    const a = await makeOwner('a');
    const b = await makeOwner('b');
    expect(a.built.config).not.toBe(b.built.config);
    expect(a.built.settingsService).not.toBe(b.built.settingsService);
    expect(a.built.providerManager).not.toBe(b.built.providerManager);
    expect(await a.profiles.loadProfile('selected')).toMatchObject({
      model: 'a-initial',
      ephemeralSettings: { 'context-limit': 8192 },
    });
    expect(await b.profiles.loadProfile('selected')).toMatchObject({
      model: 'b-initial',
      ephemeralSettings: { 'context-limit': 16384 },
    });
    expect(a.agent.getActiveProfileName()).toBe('a-prior');
    expect(b.agent.getActiveProfileName()).toBe('b-prior');
  }, 30000);

  it('applies distinct same-name public profiles without moving the other owner model, parameters or defaults', async () => {
    const a = await makeOwner('a');
    const b = await makeOwner('b');
    await createSelection(a, 'a-selected');
    await createSelection(b, 'b-selected');
    await Promise.all([
      a.agent.profiles.apply('selected'),
      b.agent.profiles.apply('selected'),
    ]);
    for (const [owner, model, temperature, contextLimit, defaultProfile] of [
      [a, 'a-selected', 0.2, 8192, 'a-default'],
      [b, 'b-selected', 0.8, 16384, 'b-default'],
    ] satisfies Array<[Owner, string, number, number, string]>) {
      expect(owner.agent.getModel()).toBe(model);
      expect(owner.built.settingsOwner.readSelectedModel()).toBe(model);

      expect(owner.built.providerManager.getActiveProviderName()).toBe('fake');
      expect(owner.agent.captureProfile()).toMatchObject({
        model,
        modelParams: { temperature },
        ephemeralSettings: { 'context-limit': contextLimit },
      });
      expect(
        owner.built.settingsService.getProviderSettings('fake'),
      ).toMatchObject({
        model,
        temperature,
      });
      expect(owner.built.settingsService.get('defaultProfile')).toBe(
        defaultProfile,
      );
    }
    expect(a.built.settingsOwner.readNamedParameter('reasoning.enabled')).toBe(
      true,
    );
    expect(b.built.settingsOwner.readNamedParameter('reasoning.enabled')).toBe(
      false,
    );
    const beforeB = observe(b);
    await createSelection(a, 'a-next');
    await a.agent.profiles.apply('selected');
    expect(a.agent.getModel()).toBe('a-next');
    expect(getActiveModelName(a.built.settingsOwner)).toBe('a-next');
    expect(getActiveModelName(b.built.settingsOwner)).toBe('b-selected');
    expect(
      getActiveProviderName(a.built.settingsOwner, a.built.providerManager),
    ).toBe('fake');
    expect(
      getActiveProviderName(b.built.settingsOwner, b.built.providerManager),
    ).toBe('fake');
    expect(
      a.built.settingsOwner.readNamedParameter('reasoning.enabled'),
    ).toBeUndefined();
    expect(observe(b)).toStrictEqual(beforeB);
  }, 30000);

  it('rejects a missing public profile before mutation and preserves both owners', async () => {
    const a = await makeOwner('a');
    const b = await makeOwner('b');
    await createSelection(a, 'a-selected');
    await a.agent.profiles.apply('selected');
    const beforeA = observe(a);
    const beforeB = observe(b);
    await expect(a.agent.profiles.apply('missing')).rejects.toThrow(
      "Profile 'missing' not found",
    );
    expect(observe(a)).toStrictEqual(beforeA);
    expect(observe(b)).toStrictEqual(beforeB);
  }, 30000);

  it('rolls back after the owning external token store fails while another same-label owner commits', async () => {
    const reached = deferred<void>();
    const release = deferred<OAuthToken | null>();
    const failure = new Error('owner A credential storage unavailable');
    const a = await makeOwner(
      'a',
      tokenReadBoundary(async () => {
        reached.resolve();
        return release.promise;
      }),
    );
    const b = await makeOwner('b');
    await a.agent.profiles.create('selected', {
      name: 'selected',
      provider: 'fake',
      model: 'a-selected',
      authKeyFile: a.keyfile,
      baseUrl: 'https://a-original.invalid/v1',
      modelParams: { temperature: 0.2 },
    });
    await a.agent.profiles.apply('selected');
    const beforeA = observe(a);
    const providerA = a.built.providerManager.getActiveProvider();
    const replacementKey = join(directory, 'replacement-credential.txt');
    await writeFile(replacementKey, 'fake-replacement-credential', {
      mode: 0o600,
    });
    await a.profiles.saveProfile('failing', {
      version: 1,
      provider: 'fake-target',
      model: 'a-mutated',
      modelParams: { temperature: 0.6 },
      ephemeralSettings: {
        'auth-keyfile': replacementKey,
        'base-url': 'https://mutated.invalid/v1',
      },
      auth: { type: 'oauth', buckets: ['external-boundary'] },
    });
    const models: string[] = [];
    const onModel = (model: string): void => {
      models.push(model);
    };
    coreEvents.on(CoreEvent.ModelChanged, onModel);
    const publications: ModelProfileInfoPayload[] = [];
    const onPublication = (event: ModelProfileInfoPayload): void => {
      publications.push(event);
    };
    coreEvents.on(CoreEvent.ModelProfileChanged, onPublication);
    const pendingA = a.agent.profiles.load('failing');
    const rejectedA = pendingA.then(
      () => undefined,
      (error: unknown) => error,
    );
    try {
      await reached.promise;
      expect(a.built.settingsOwner.readSelectedModel()).toBe('a-mutated');
      expect(a.built.providerManager.getActiveProviderName()).toBe(
        'fake-target',
      );
      await expect(a.agent.setModel('must-not-rebase')).rejects.toMatchObject({
        code: 'busy',
      });
      expect(
        a.built.settingsService.getProviderSettings('fake-target'),
      ).toMatchObject({
        'auth-key': 'fake-replacement-credential',
        'base-url': 'https://mutated.invalid/v1',
      });
      await b.profiles.saveProfile('succeeding', {
        version: 1,
        provider: 'fake',
        model: 'b-selected',
        modelParams: { temperature: 0.7 },
        ephemeralSettings: {
          'auth-keyfile': b.keyfile,
          'base-url': 'https://b.invalid/v1',
        },
      });
      await b.agent.profiles.load('succeeding');
      const otherTurn = [];
      for await (const event of b.agent.stream(
        'owner B continues independently',
      ))
        otherTurn.push(event);
      expect(otherTurn.some((event) => event.type === 'error')).toBe(false);
      expect(otherTurn.some((event) => event.type === 'done')).toBe(true);
      const committedB = observe(b);
      release.reject(failure);
      expect(await rejectedA).toBe(failure);
      expect(observe(a)).toStrictEqual(beforeA);
      expect(a.built.providerManager.getActiveProvider()).toBe(providerA);
      expect(observe(b)).toStrictEqual(committedB);
      expect(b.agent.getModel()).toBe('b-selected');
      expect(models).toStrictEqual(['b-selected']);
      expect(publications.map((event) => event.model)).toStrictEqual([
        'b-selected',
      ]);
      await createSelection(a, 'a-next');
      await a.agent.profiles.apply('selected');
      expect(
        a.built.settingsOwner.readNamedParameter('reasoning.enabled'),
      ).toBeUndefined();
    } finally {
      coreEvents.off(CoreEvent.ModelProfileChanged, onPublication);
      coreEvents.off(CoreEvent.ModelChanged, onModel);
      release.reject(failure);
      await rejectedA;
    }
  }, 30000);

  it('serializes the same owner and captures queued input without rebasing it after rollback', async () => {
    const reached = deferred<void>();
    const release = deferred<OAuthToken | null>();
    const failure = new Error('credential read failed');
    const a = await makeOwner(
      'a',
      tokenReadBoundary(async () => {
        reached.resolve();
        return release.promise;
      }),
    );
    const first = a.agent.profiles
      .applySnapshot({
        version: 1,
        provider: 'fake',
        model: 'a-pending',
        modelParams: {},
        ephemeralSettings: { 'auth-keyfile': a.keyfile },
        auth: { type: 'oauth', buckets: ['external-boundary'] },
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    try {
      await reached.promise;
      const input: Profile = {
        version: 1,
        provider: 'fake',
        model: 'a-queued',
        modelParams: { temperature: 0.9 },
        ephemeralSettings: {},
      };
      const queued = a.agent.profiles.applySnapshot(input, {
        profileName: 'queued',
      });
      input.model = 'caller-mutated';
      input.modelParams.temperature = 0.1;
      expect(a.built.settingsOwner.readSelectedModel()).toBe('a-pending');
      release.reject(failure);
      expect(await first).toBe(failure);
      await queued;
      expect(a.agent.captureProfile()).toMatchObject({
        model: 'a-queued',
        modelParams: { temperature: 0.9 },
      });
      expect(a.agent.getActiveProfileName()).toBe('queued');
    } finally {
      release.reject(failure);
      await first;
    }
  }, 30000);

  it('loads and saves durable owner profiles outside ALS', async () => {
    const a = await makeOwner('a');
    const b = await makeOwner('b');
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
    await createSelection(a, 'a-other');
    await a.agent.profiles.apply('selected');
    await a.agent.profiles.load('roundtrip');
    expect(a.agent.getModel()).toBe('a-selected');
    expect(observe(b)).toStrictEqual(beforeB);
  }, 30000);

  it('keeps same-label profile switches and credential files with their owning Agent', async () => {
    const a = await makeOwner('a');
    const b = await makeOwner('b');
    await Promise.all([
      a.agent.profiles.create('credential-switch', {
        name: 'credential-switch',
        provider: 'fake',
        model: 'a-file-model',
        authKeyFile: a.keyfile,
        baseUrl: 'https://a.invalid/v1',
      }),
      b.agent.profiles.create('credential-switch', {
        name: 'credential-switch',
        provider: 'fake',
        model: 'b-file-model',
        authKeyFile: b.keyfile,
        baseUrl: 'https://b.invalid/v1',
      }),
    ]);
    await Promise.all([
      a.agent.profiles.apply('credential-switch'),
      b.agent.profiles.apply('credential-switch'),
    ]);
    for (const [owner, other, model, endpoint] of [
      [a, b, 'a-file-model', 'https://a.invalid/v1'],
      [b, a, 'b-file-model', 'https://b.invalid/v1'],
    ] satisfies Array<[Owner, Owner, string, string]>) {
      expect(owner.agent.getModel()).toBe(model);
      expect(owner.agent.getProviderStatus()).toMatchObject({
        keyFile: owner.keyfile,
        baseUrl: endpoint,
        authStatus: 'authenticated',
      });
      expect(owner.agent.getProviderStatus().keyFile).not.toBe(other.keyfile);
      const credential = await readFile(owner.keyfile, 'utf8');
      expect(credential).toBe(`fake-${model[0]}-credential`);
      expect(
        owner.built.settingsService.getProviderSettings('fake')['auth-key'],
      ).toBe(credential);
      expect(owner.agent.captureProfile()).toMatchObject({
        model,
        ephemeralSettings: { 'auth-keyfile': owner.keyfile },
      });
    }
  }, 30000);

  it('applies the public keyfile and endpoint with the selected model instead of leaving partial profile state', async () => {
    const a = await makeOwner('a');
    const b = await makeOwner('b');
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
    expect(a.built.settingsOwner.readSelectedModel()).toBe(
      'a-credential-model',
    );
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
