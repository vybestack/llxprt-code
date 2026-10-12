import { CredentialAuthority } from '../../auth/proxy/credential-store-factory.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { assembleModelSelection } from '../../../../agents/src/api/model-selection.js';
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';
import { afterEach, beforeEach } from 'bun:test';
import {
  Config,
  createProviderRuntimeContext,
} from '@vybestack/llxprt-code-core';
import {
  ProfileManager,
  SettingsService,
  type Profile,
} from '@vybestack/llxprt-code-settings';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FakeProvider } from '../../fake/FakeProvider.js';
import { ProviderManager } from '../../ProviderManager.js';
import {
  applyProfileCascade,
  type ProfileApplicationResult,
} from '../../../../agents/src/api/profileApplication.js';
import { switchActiveProvider } from '../providerSwitch.js';
import type { ProviderSwitcher } from '@vybestack/llxprt-code-core';

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

interface WorkflowOwner {
  directory: string;
  config: Config;
  settings: SettingsService;
  settingsOwner: SessionSettingsOwner;
  manager: ProviderManager;
  providers: Map<string, FakeProvider>;
  store: ProfileManager;
  switchProvider: ProviderSwitcher;
  application: {
    applySnapshot(profile: Profile): Promise<ProfileApplicationResult>;
  };
}

export function workflowApplication(
  owner: Omit<WorkflowOwner, 'application'>,
  switchProvider: ProviderSwitcher = owner.switchProvider,
): WorkflowOwner['application'] {
  return {
    applySnapshot: (profile) =>
      applyProfileCascade(
        profile,
        {},
        owner.settings,
        owner.manager,
        owner.store,
        switchProvider,
        assembleModelSelection(owner.settingsOwner),
        {
          readEndpoint: () => owner.settingsOwner.readSelectedEndpoint(),
          applyParameter: (key, value) =>
            owner.settingsOwner.writeUserParameter(key, value),
        },
        (name) => owner.manager.getProviderKeys().getKey(name),
      ),
  };
}

function createWorkflowOwner(
  directory: string,
  fixture: string,
): WorkflowOwner {
  const settings = new SettingsService();
  const settingsOwner = new SessionSettingsOwner(settings);
  const config = new Config({
    sessionId: 'workflow-owner',
    targetDir: directory,
    cwd: directory,
    model: 'initial',
    debugMode: false,
  });
  const manager = new ProviderManager(
    undefined,
    undefined,
    undefined,
    undefined,
    settings,
    config,
    createProviderRuntimeContext({
      runtimeId: 'workflow-owner',
      runtimeKind: 'agent',
    }),
  );
  const storage = new CredentialAuthority().createProviderKeyStorage();
  manager.bindProviderKeyStorage(storage, () => storage.close());
  const providers = new Map<string, FakeProvider>();
  for (const name of ['openai', 'anthropic', 'gemini']) {
    const provider = new FakeProvider(fixture, directory);
    provider.name = name;
    provider.baseProviderConfig = { baseURL: '' };
    manager.registerProvider(provider);
    providers.set(name, provider);
  }
  const store = new ProfileManager(join(directory, 'profiles'));
  configureProviderRuntimeFactories(config, manager);
  const switchProvider: ProviderSwitcher = (name, options = {}) =>
    switchActiveProvider(
      name,
      options,
      config,
      settings,
      manager,
      null,
      'agent',
      async () => {},
      settingsOwner,
    );
  const runtime = {
    directory,
    config,
    settings,
    settingsOwner,
    manager,
    providers,
    store,
    switchProvider,
  };
  return { ...runtime, application: workflowApplication(runtime) };
}

export function useProfileOwner(): () => WorkflowOwner {
  let owner: WorkflowOwner | undefined;
  let previousProject: string | undefined;
  let previousLocation: string | undefined;
  beforeEach(async () => {
    previousProject = process.env.GOOGLE_CLOUD_PROJECT;
    previousLocation = process.env.GOOGLE_CLOUD_LOCATION;
    const directory = await mkdtemp(join(tmpdir(), 'provider-workflow-'));
    const fixture = join(directory, 'responses.jsonl');
    await writeFile(fixture, '{"chunks":[]}\n');
    owner = createWorkflowOwner(directory, fixture);
  });
  afterEach(async () => {
    if (owner) {
      await owner.settingsOwner.dispose();
      owner.manager.dispose();
      await owner.config.dispose();
      await rm(owner.directory, { recursive: true, force: true });
    }
    owner = undefined;
    if (previousProject === undefined) delete process.env.GOOGLE_CLOUD_PROJECT;
    else process.env.GOOGLE_CLOUD_PROJECT = previousProject;
    if (previousLocation === undefined)
      delete process.env.GOOGLE_CLOUD_LOCATION;
    else process.env.GOOGLE_CLOUD_LOCATION = previousLocation;
  });
  return () => {
    if (!owner) throw new Error('Profile workflow owner is not initialized');
    return owner;
  };
}
