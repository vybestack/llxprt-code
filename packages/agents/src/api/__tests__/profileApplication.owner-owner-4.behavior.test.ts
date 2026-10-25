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
import { type Profile } from '@vybestack/llxprt-code-settings';
import { TokenStore, OAuthToken } from '@vybestack/llxprt-code-auth';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { writeProviderAliasConfig } from '@vybestack/llxprt-code-providers/composition.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import {
  createOAuthContribution,
  enableOAuthProviders,
} from './helpers/oauth-contribution.js';
import { usePromptFixture } from './helpers/prompt-fixture.js';
import { openRouteBPreflight } from './helpers/route-b-preflight.js';

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
  const oauthContribution = createOAuthContribution();

  let directory: string;

  let previousHome: string | undefined;

  let previousData: string | undefined;

  let previousFake: string | undefined;

  let ownerCloses: Array<() => Promise<void>>;

  usePromptFixture();

  beforeEach(async () => {
    const evidence = join(tmpdir(), 'llxprt-profile-application-owner');
    await mkdir(evidence, { recursive: true });
    directory = await mkdtemp(join(evidence, 'fixture-'));
    previousHome = process.env.LLXPRT_CONFIG_HOME;
    previousData = process.env.LLXPRT_DATA_HOME;
    previousFake = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_CONFIG_HOME = join(directory, 'user');
    process.env.LLXPRT_DATA_HOME = join(directory, 'data');
    delete process.env.LLXPRT_FAKE_RESPONSES;
    await mkdir(process.env.LLXPRT_CONFIG_HOME, { recursive: true });
    await enableOAuthProviders(process.env.LLXPRT_CONFIG_HOME, ['fake']);
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
      if (previousFake === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
      else process.env.LLXPRT_FAKE_RESPONSES = previousFake;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('serializes the same owner and captures queued input without rebasing it after rollback', async () => {
    const reached = deferred<void>();
    const release = deferred<OAuthToken | null>();
    const failure = new Error('credential read failed');
    const a_label = 'a';
    const a_tokenStore = tokenReadBoundary(async () => {
      reached.resolve();
      return release.promise;
    });
    const a_workingDir = join(directory, a_label);
    await mkdir(a_workingDir, { recursive: true });
    const a_keyfile = join(a_workingDir, 'credential.txt');
    await writeFile(a_keyfile, `fake-${a_label}-credential`, { mode: 0o600 });
    const route = await openRouteBPreflight({
      authority: authorityOverExternalTokenStore(a_tokenStore),
      contributions: oauthContribution.contributions,
      config: {
        model: `${a_label}-initial`,
        workingDir: a_workingDir,
        sessionId: 'same-profile-owner-label',
        interactive: true,
        settings: { profileDirectory: join(a_workingDir, 'durable-profiles') },
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
    const a_agent = await route.createAgent({
      provider: route.config.getProvider(),
      model: route.config.getModel(),
    });
    ownerCloses.push(() => a_agent.dispose());
    settingsOwner.writeUserParameter('context-limit', 8192);
    route.settings.setCurrentProfileName(`${a_label}-prior`);
    a_agent.setDefaultProfileName(`${a_label}-default`);
    const first = a_agent.profiles
      .applySnapshot({
        version: 1,
        provider: 'fake',
        model: 'a-pending',
        modelParams: {},
        ephemeralSettings: { 'auth-keyfile': a_keyfile },
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
      const queued = a_agent.profiles.applySnapshot(input, {
        profileName: 'queued',
      });
      input.model = 'caller-mutated';
      input.modelParams.temperature = 0.1;
      expect(settingsOwner.readSelectedModel()).toBe('a-pending');
      release.reject(failure);
      expect(await first).toBe(failure);
      await queued;
      expect(a_agent.captureProfile()).toMatchObject({
        model: 'a-queued',
        modelParams: { temperature: 0.9 },
      });
      expect(a_agent.getActiveProfileName()).toBe('queued');
    } finally {
      release.reject(failure);
      await first;
    }
  }, 30000);
});
