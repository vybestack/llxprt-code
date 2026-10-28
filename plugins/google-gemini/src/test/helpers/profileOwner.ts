/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Live profile roots for the Gemini owner-isolation suite.
 *
 * The plugin is a release unit that sits outside the root workspace set, so it
 * must not reach into another package's internals by relative path. Each root
 * is therefore assembled from public package entries only: settings owns
 * SettingsService and ProfileManager, core owns Config and the session settings
 * owner, providers owns the manager, the fake providers and the credential
 * authority, and agents owns the profile-application assembly that writes a
 * profile snapshot into a root.
 *
 * Two roots built here share no settings, provider registry, or profile
 * directory, which is what the isolation assertions measure.
 */

import { afterEach, beforeEach } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Config,
  createProviderRuntimeContext,
} from '@vybestack/llxprt-code-core';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { configureProviderTokenizer } from '@vybestack/llxprt-code-providers/composition.js';
import {
  FakeProvider,
  ProviderManager,
} from '@vybestack/llxprt-code-providers';
import {
  ProfileManager,
  SettingsService,
  type Profile,
} from '@vybestack/llxprt-code-settings';
import {
  assembleProfileApplication,
  assembleProviderSwitch,
  type AgentProfileApplication,
} from '@vybestack/llxprt-code-agents';

/** A standard (non-load-balancer) profile carrying the given ephemerals. */
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

export interface ProfileOwner {
  directory: string;
  config: Config;
  settings: SettingsService;
  settingsOwner: SessionSettingsOwner;
  manager: ProviderManager;
  store: ProfileManager;
  application: AgentProfileApplication;
}

function createProfileOwner(
  directory: string,
  replayFile: string,
): ProfileOwner {
  const settings = new SettingsService();
  const settingsOwner = new SessionSettingsOwner(settings);
  const config = new Config({
    sessionId: 'profile-owner',
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
      runtimeId: 'profile-owner',
      runtimeKind: 'agent',
    }),
  );
  const storage = new CredentialAuthority().createProviderKeyStorage();
  manager.bindProviderKeyStorage(storage, () => storage.close());
  for (const name of ['openai', 'anthropic', 'gemini']) {
    const provider = new FakeProvider(replayFile, directory);
    provider.name = name;
    provider.baseProviderConfig = { baseURL: '' };
    manager.registerProvider(provider);
  }
  configureProviderTokenizer(manager);
  const switchProvider = assembleProviderSwitch(
    config,
    settings,
    manager,
    null,
    () => 'agent',
    async () => {},
    settingsOwner,
  );
  const store = new ProfileManager(join(directory, 'profiles'));
  return {
    directory,
    config,
    settings,
    settingsOwner,
    manager,
    store,
    application: assembleProfileApplication(
      settings,
      manager,
      null,
      switchProvider,
      settingsOwner,
      store,
    ),
  };
}

/**
 * Registers the per-test lifecycle for one root and returns a lazy accessor.
 * Each call installs its own beforeEach/afterEach pair, so a suite that calls
 * it twice gets two independent roots that live for the same test.
 */
export function useProfileOwner(): () => ProfileOwner {
  let owner: ProfileOwner | undefined;
  let previousProject: string | undefined;
  let previousLocation: string | undefined;
  beforeEach(async () => {
    previousProject = process.env.GOOGLE_CLOUD_PROJECT;
    previousLocation = process.env.GOOGLE_CLOUD_LOCATION;
    const directory = await mkdtemp(join(tmpdir(), 'gemini-profile-owner-'));
    const replayFile = join(directory, 'responses.jsonl');
    await writeFile(replayFile, '{"chunks":[]}\n');
    owner = createProfileOwner(directory, replayFile);
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
    if (!owner) throw new Error('Profile owner is not initialized');
    return owner;
  };
}
