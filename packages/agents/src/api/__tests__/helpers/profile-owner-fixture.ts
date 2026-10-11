/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach } from 'bun:test';
import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type { TokenStore } from '@vybestack/llxprt-code-auth';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type Profile,
  type SettingsService,
} from '@vybestack/llxprt-code-settings';
import type {
  RuntimeProviderManager,
  ProfileDefinitionReads,
  ProfileDefinitionWrites,
} from '@vybestack/llxprt-code-core';
import type { ProviderSwitcher } from '@vybestack/llxprt-code-providers/runtime/providerSwitch.js';
import { FakeProvider } from '../../../../../providers/src/fake/FakeProvider.js';
import {
  buildCliStyleConfig,
  type BuiltCliConfig,
} from './buildCliStyleConfig.js';
import {
  assembleProfileApplication,
  type AgentProfileApplication,
} from '../../profileApplicationAssembly.js';
import { assembleProviderSwitch } from '../../providerSwitchAssembly.js';

import { LoadBalancingProvider } from '../../../../../providers/src/LoadBalancingProvider.js';
import { LoggingProviderWrapper } from '../../../../../providers/src/LoggingProviderWrapper.js';
import { RetryOrchestrator } from '../../../../../providers/src/RetryOrchestrator.js';

export function loadBalancer(
  owner: ProfileOwnerFixture,
): LoadBalancingProvider {
  let provider = owner.manager.getProviderByName('load-balancer');
  while (
    provider instanceof LoggingProviderWrapper ||
    provider instanceof RetryOrchestrator
  ) {
    provider = provider.wrappedProvider;
  }
  if (!(provider instanceof LoadBalancingProvider))
    throw new Error('Expected real load balancer');
  return provider;
}

export function standardProfile(
  ephemeralSettings: Record<string, unknown> = {},
): Profile {
  return {
    version: 1,
    provider: 'anthropic',
    model: 'selected-model',
    modelParams: {},
    ephemeralSettings,
  };
}

function emptyTokenStore(): TokenStore {
  const unexpected = async (): Promise<never> => {
    throw new Error('Unexpected token store mutation');
  };
  return {
    getToken: async () => null,
    saveToken: unexpected,
    removeToken: unexpected,
    listProviders: async () => [],
    listBuckets: async () => [],
    getBucketStats: unexpected,
    acquireRefreshLock: unexpected,
    releaseRefreshLock: unexpected,
    acquireAuthLock: unexpected,
    releaseAuthLock: unexpected,
  };
}

async function createProfileOwner(
  directory: string,
): Promise<ProfileOwnerFixture> {
  const built = await buildCliStyleConfig('plain-text.jsonl', {
    workingDir: directory,
  });
  delete process.env.LLXPRT_FAKE_RESPONSES;
  const config = built.config;
  const settings = built.settingsService;
  const manager = built.providerManager;

  const providers = new Map<string, FakeProvider>();
  for (const name of ['openai', 'anthropic', 'gemini', 'zai', 'openrouter']) {
    const provider = new FakeProvider(
      fileURLToPath(new URL('../fixtures/plain-text.jsonl', import.meta.url)),
      directory,
    );
    provider.name = name;
    provider.baseProviderConfig = { baseURL: '' };
    manager.registerProvider(provider);
    providers.set(name, provider);
  }
  const store = {
    ...built.mcpRuntime.profileDefinitions,
    ...built.mcpRuntime.profileWrites,
  };
  const oauth = new OAuthManager(emptyTokenStore(), undefined, {
    config,
    messageBus: built.messageBus,
  });
  const authenticationRequests: string[] = [];
  for (const name of providers.keys()) {
    oauth.registerProvider({
      name,
      initiateAuth: async () => {
        authenticationRequests.push(name);
        throw new Error('Unexpected interactive authentication');
      },
      getToken: async () => null,
      refreshToken: async () => null,
    });
  }
  const switchProvider = assembleProviderSwitch(
    config,
    settings,
    manager,
    oauth,
    () => undefined,
    () => built.sessionClient.refreshAuth(),
    built.settingsOwner,
  );
  const application = assembleProfileApplication(
    config,
    settings,
    manager,
    oauth,
    switchProvider,
    built.settingsOwner,
    store,
  );
  return {
    ...built,
    get agentClient() {
      return built.agentClient;
    },
    settings,
    manager,
    providers,
    store,
    application,
    directory,
    switchProvider,
    oauth,
    authenticationRequests,
  };
}

export interface ProfileOwnerFixture extends BuiltCliConfig {
  readonly settings: SettingsService;
  readonly manager: RuntimeProviderManager;
  readonly providers: ReadonlyMap<string, FakeProvider>;
  readonly store: ProfileDefinitionReads & ProfileDefinitionWrites;
  readonly application: AgentProfileApplication;
  readonly directory: string;
  readonly switchProvider: ProviderSwitcher;
  readonly oauth: OAuthManager;
  readonly authenticationRequests: readonly string[];
}

export function useProfileOwner(): () => ProfileOwnerFixture {
  let owner: ProfileOwnerFixture;
  let directory: string;
  let environment: Record<string, string | undefined>;
  beforeEach(async () => {
    environment = Object.fromEntries(
      [
        'LLXPRT_CONFIG_HOME',
        'LLXPRT_DATA_HOME',
        'LLXPRT_FAKE_RESPONSES',
        'GOOGLE_CLOUD_PROJECT',
        'GOOGLE_CLOUD_LOCATION',
      ].map((key) => [key, process.env[key]]),
    );
    const root = join(tmpdir(), 'llxprt-profile-tests-owner-migration');
    await mkdir(root, { recursive: true });
    directory = await mkdtemp(join(root, 'fixture-'));
    process.env.LLXPRT_CONFIG_HOME = join(directory, 'home');
    process.env.LLXPRT_DATA_HOME = join(directory, 'data');
    owner = await createProfileOwner(directory);
  });
  afterEach(async () => {
    try {
      await owner.cleanup();
    } finally {
      for (const [key, value] of Object.entries(environment)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await rm(directory, { recursive: true, force: true });
    }
  });
  return () => owner;
}
