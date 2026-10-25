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
import { type ModelProfileInfoPayload } from '@vybestack/llxprt-code-core/utils/events.js';
import { ProfileManager } from '@vybestack/llxprt-code-settings';
import { TokenStore, OAuthToken } from '@vybestack/llxprt-code-auth';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { writeProviderAliasConfig } from '@vybestack/llxprt-code-providers/composition.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { type Agent } from '../index.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import {
  createOAuthContribution,
  enableOAuthProviders,
} from './helpers/oauth-contribution.js';
import { usePromptFixture } from './helpers/prompt-fixture.js';
import {
  openRouteBPreflight,
  type RouteBPreflight,
} from './helpers/route-b-preflight.js';

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

function authorityOverExternalTokenStore(
  external: TokenStore,
): CredentialAuthority {
  return new (class extends CredentialAuthority {
    override createTokenStore(): TokenStore {
      return external;
    }
  })();
}

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
  const selectReplay = useFakeResponsesReplay('plain-text.jsonl');
  const oauthContribution = createOAuthContribution();

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
    await mkdir(process.env.LLXPRT_CONFIG_HOME, { recursive: true });
    await enableOAuthProviders(process.env.LLXPRT_CONFIG_HOME, [
      'fake',
      'fake-target',
    ]);
    writeProviderAliasConfig('fake', {
      baseProvider: oauthContribution.providerId,
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
    writeProviderAliasConfig('fake-target', {
      baseProvider: oauthContribution.providerId,
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
    authority?: CredentialAuthority,
  ): Promise<Owner> {
    const workingDir = join(directory, label);
    await mkdir(workingDir, { recursive: true });
    const keyfile = join(workingDir, 'credential.txt');
    await writeFile(keyfile, `fake-${label}-credential`, { mode: 0o600 });
    const route = await openRouteBPreflight({
      ...(authority === undefined ? {} : { authority }),
      contributions: oauthContribution.contributions,
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

  it('rolls back after the owning external token store fails while another same-label owner commits', async () => {
    const reached = deferred<void>();
    const release = deferred<OAuthToken | null>();
    const failure = new Error('owner A credential storage unavailable');
    delete process.env.LLXPRT_FAKE_RESPONSES;
    const a = await openOwner(
      'a',
      8192,
      authorityOverExternalTokenStore(
        tokenReadBoundary(async () => {
          reached.resolve();
          return release.promise;
        }),
      ),
    );
    selectReplay('plain-text.jsonl');
    const b = await openOwner('b', 16384);
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
    const providerA = a.agent.getProvider();
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
    const publications: ModelProfileInfoPayload[] = [];
    const unsubscribe = b.settingsOwner.subscribeModelChanges((profile) => {
      if (profile === undefined) {
        const model = b.settingsOwner.readSelectedModel();
        if (model !== undefined) models.push(model);
      } else publications.push(profile);
    });
    const pendingA = a.agent.profiles.load('failing');
    const rejectedA = pendingA.then(
      () => undefined,
      (error: unknown) => error,
    );
    try {
      await reached.promise;
      expect(a.settingsOwner.readSelectedModel()).toBe('a-mutated');
      expect(a.route.preflight.getActiveProviderName()).toBe('fake-target');
      await expect(a.agent.setModel('must-not-rebase')).rejects.toMatchObject({
        code: 'busy',
      });
      expect(a.route.settings.getProviderSettings('fake-target')).toMatchObject(
        {
          'auth-key': 'fake-replacement-credential',
          'base-url': 'https://mutated.invalid/v1',
        },
      );
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
      expect(a.agent.getProvider()).toBe(providerA);
      expect(observe(b)).toStrictEqual(committedB);
      expect(b.agent.getModel()).toBe('b-selected');
      expect(models).toStrictEqual(['b-selected']);
      expect(publications.map((event) => event.model)).toStrictEqual([
        'b-selected',
      ]);
      await createSelection(a.agent, 'a-next');
      await a.agent.profiles.apply('selected');
      expect(
        a.settingsOwner.readNamedParameter('reasoning.enabled'),
      ).toBeUndefined();
    } finally {
      unsubscribe();
      release.reject(failure);
      await rejectedA;
    }
  }, 30000);
});
